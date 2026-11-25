import { beforeAll, describe, expect, it } from "vitest";
import { deriveRegistroGlobalPda } from "../../app/lib/moto-ledger/pdas";
import {
  getRegistroGlobalDecoder,
  getRegistroGlobalDiscriminatorBytes,
} from "../../app/lib/moto-ledger/src/generated/accounts/registroGlobal"


import { REGISTRO_PROGRAM_ADDRESS } from "../../app/lib/moto-ledger/src/generated/programs";

const rpcUrl = process.env.MOTO_LEDGER_DEVNET_RPC_URL;
const timeout = 30_000;

type RpcAccountInfo = {
  owner: string;
  executable: boolean;
  lamports: number;
  data: [string, "base64"];
};

type RpcResponse<T> = {
  result: { context: { slot: number }; value: T };
  error?: { code: number; message: string };
};

async function getAccountInfo(
  address: string
): Promise<{ account: RpcAccountInfo | null; slot: number }> {
  if (!rpcUrl) {
    throw new Error("MOTO_LEDGER_DEVNET_RPC_URL is not configured");
  }

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: address,
      method: "getAccountInfo",
      params: [address, { encoding: "base64", commitment: "confirmed" }],
    }),
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    throw new Error(`Devnet RPC returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as RpcResponse<RpcAccountInfo | null>;
  if (payload.error) {
    throw new Error(
      `Devnet RPC ${payload.error.code}: ${payload.error.message}`
    );
  }

  return {
    account: payload.result.value,
    slot: payload.result.context.slot,
  };
}

describe.skipIf(!rpcUrl)("MotoLedger Devnet integration (read-only)", () => {
  let registryAddress: string;

  beforeAll(async () => {
    [registryAddress] = await deriveRegistroGlobalPda();
  });

  it(
    "finds the deployed MotoLedger program as an executable account",
    async () => {
      const { account, slot } = await getAccountInfo(REGISTRO_PROGRAM_ADDRESS);

      expect(account, "Program account must exist on Devnet").not.toBeNull();
      expect(account?.executable).toBe(true);
      expect(account?.lamports).toBeGreaterThan(0);
      expect(slot).toBeGreaterThan(0);
    },
    timeout
  );

  it(
    "fetches and decodes the real global registry PDA owned by the program",
    async () => {
      const { account, slot } = await getAccountInfo(registryAddress);

      expect(
        account,
        `Registry PDA ${registryAddress} must exist on Devnet`
      ).not.toBeNull();
      expect(account?.owner).toBe(REGISTRO_PROGRAM_ADDRESS);
      expect(account?.executable).toBe(false);
      expect(slot).toBeGreaterThan(0);

      const encodedData = Buffer.from(account!.data[0], "base64");
      const decoded = getRegistroGlobalDecoder().decode(
        new Uint8Array(encodedData)
      );

      expect([...decoded.discriminator]).toEqual([
        ...getRegistroGlobalDiscriminatorBytes(),
      ]);
      expect(decoded.totalConcesionarios).toBeGreaterThanOrEqual(0);
    },
    timeout
  );
});
