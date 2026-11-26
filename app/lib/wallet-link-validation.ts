import type { WalletLinkCluster } from "./wallet-link-store";

const PROGRAM_ADDRESS = "64dHKqRTBciEidqLJqCvTWEGWkR1QqyYDZgomMt9AWCj";
const WALLET_CLIENTE_DISCRIMINATOR = Buffer.from([206, 39, 69, 88, 47, 244, 46, 203]);
const RPC_URLS: Record<Exclude<WalletLinkCluster, "localnet">, string> = {
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
};

type RpcAccount = {
  pubkey: string;
  account: { data: [string, string] };
};

function encodeBase58(bytes: Uint8Array) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    encoded = alphabet[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = "1" + encoded;
  }
  return encoded || "1";
}

function decodeBase58(value: string) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = 0n;
  for (const char of value) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error("Dirección Solana inválida.");
    number = number * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (number > 0n) {
    bytes.unshift(Number(number & 255n));
    number >>= 8n;
  }
  for (const char of value) {
    if (char !== "1") break;
    bytes.unshift(0);
  }
  return Buffer.from(bytes);
}

async function rpc<T>(cluster: Exclude<WalletLinkCluster, "localnet">, method: string, params: unknown[]) {
  const response = await fetch(RPC_URLS[cluster], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "moto-ledger-wallet-uniqueness", method, params }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("No se pudo consultar Solana para validar la wallet.");
  const payload = (await response.json()) as { result?: T; error?: { message?: string } };
  if (payload.error || payload.result === undefined) {
    throw new Error("La consulta de validación de wallet en Solana falló.");
  }
  return payload.result;
}

/**
 * A wallet may be shared by customers at different dealerships, but not by
 * two customers who have sales recorded at the same dealership.
 */
export async function assertWalletAvailableForDealership({
  wallet,
  cliente,
  concesionario,
  cluster,
}: {
  wallet: string;
  cliente: string;
  concesionario: string;
  cluster: WalletLinkCluster;
}) {
  if (cluster === "localnet") {
    throw new Error("La validación de wallet no está disponible para localnet.");
  }

  const linkedAccounts = await rpc<RpcAccount[]>(cluster, "getProgramAccounts", [
    PROGRAM_ADDRESS,
    {
      encoding: "base64",
      commitment: "confirmed",
      filters: [{ memcmp: { offset: 40, bytes: wallet } }],
    },
  ]);

  const dealershipBytes = decodeBase58(concesionario);
  for (const linkedAccount of linkedAccounts) {
    const data = Buffer.from(linkedAccount.account.data[0], "base64");
    if (data.length < 73 || !data.subarray(0, 8).equals(WALLET_CLIENTE_DISCRIMINATOR)) {
      continue;
    }

    const linkedCustomer = encodeBase58(data.subarray(8, 40));
    if (linkedCustomer === cliente) continue;

    const sales = await rpc<Array<{ pubkey: string; account: { data: [string, string] } }>>(
      cluster,
      "getProgramAccounts",
      [
        PROGRAM_ADDRESS,
        {
          encoding: "base64",
          commitment: "confirmed",
          filters: [{ memcmp: { offset: 40, bytes: linkedCustomer } }],
          dataSlice: { offset: 8, length: 32 },
        },
      ]
    );

    const belongsToSameDealership = sales.some((sale) => {
      const saleDealership = Buffer.from(sale.account.data[0], "base64");
      return saleDealership.length === 32 && saleDealership.equals(dealershipBytes);
    });

    if (belongsToSameDealership) {
      throw new Error("Esta wallet ya está vinculada a otro cliente de este concesionario. Cada cliente debe utilizar una wallet diferente.");
    }
  }
}
