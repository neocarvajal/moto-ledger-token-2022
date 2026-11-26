import { createPublicKey, verify } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const REGISTRO_PROGRAM_ID = "64dHKqRTBciEidqLJqCvTWEGWkR1QqyYDZgomMt9AWCj";
const CONCESIONARIO_DISCRIMINATOR = Buffer.from([
  218, 52, 45, 199, 219, 127, 159, 179,
]);
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type Cluster = "devnet" | "mainnet-beta";

function decodeBase58(value: string): Buffer {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = 0n;
  for (const char of value) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error("Dirección base58 inválida.");
    number = number * 58n + BigInt(digit);
  }

  const bytes: number[] = [];
  while (number > 0n) {
    bytes.unshift(Number(number & 255n));
    number >>= 8n;
  }
  for (let i = 0; i < value.length && value[i] === "1"; i++) {
    bytes.unshift(0);
  }
  return Buffer.from(bytes);
}

function verifyWalletSignature({
  wallet,
  dealership,
  cluster,
  timestamp,
  nonce,
  signature,
}: {
  wallet: string;
  dealership: string;
  cluster: Cluster;
  timestamp: number;
  nonce: string;
  signature: string;
}) {
  const message = [
    "MotoLedger IPFS metadata upload",
    `wallet:${wallet}`,
    `dealership:${dealership}`,
    `cluster:${cluster}`,
    `timestamp:${timestamp}`,
    `nonce:${nonce}`,
  ].join("\n");

  const publicKeyBytes = decodeBase58(wallet);
  const signatureBytes = Buffer.from(signature, "base64");
  if (publicKeyBytes.length !== 32 || signatureBytes.length !== 64) return false;

  const publicKey = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, publicKeyBytes]),
    format: "der",
    type: "spki",
  });

  return verify(null, Buffer.from(message, "utf8"), publicKey, signatureBytes);
}

async function verifyDealershipOwner(
  dealership: string,
  wallet: string,
  cluster: Cluster
) {
  const rpcUrl =
    cluster === "mainnet-beta"
      ? "https://api.mainnet-beta.solana.com"
      : "https://api.devnet.solana.com";

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "mot-ledger-owner-check",
      method: "getAccountInfo",
      params: [dealership, { encoding: "base64", commitment: "confirmed" }],
    }),
    cache: "no-store",
  });

  if (!response.ok) throw new Error("No se pudo consultar Solana.");
  const payload = (await response.json()) as {
    result?: { value?: { owner?: string; data?: [string, string] } | null };
    error?: { message?: string };
  };
  if (payload.error) throw new Error("La consulta de propiedad en Solana falló.");

  const account = payload.result?.value;
  if (!account || account.owner !== REGISTRO_PROGRAM_ID || !account.data?.[0]) {
    return false;
  }

  const data = Buffer.from(account.data[0], "base64");
  if (data.length < 40) return false;

  const discriminatorMatches = data
    .subarray(0, 8)
    .equals(CONCESIONARIO_DISCRIMINATOR);
  const ownerMatches = data.subarray(8, 40).equals(decodeBase58(wallet));
  return discriminatorMatches && ownerMatches;
}

async function pinataRequest(path: string, body: BodyInit, contentType?: string) {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error("PINATA_JWT no está configurado en el servidor.");

  const headers = new Headers({ Authorization: `Bearer ${jwt}` });
  if (contentType) headers.set("Content-Type", contentType);

  const response = await fetch(`https://api.pinata.cloud/pinning/${path}`, {
    method: "POST",
    headers,
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    console.error("Pinata upload failed:", response.status);
    throw new Error("Pinata no pudo almacenar el contenido.");
  }

  return (await response.json()) as { IpfsHash?: string };
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("image");
    const name = String(form.get("name") ?? "").trim();
    const symbol = String(form.get("symbol") ?? "").trim().toUpperCase();
    const description = String(form.get("description") ?? "").trim();
    const wallet = String(form.get("wallet") ?? "");
    const dealership = String(form.get("dealership") ?? "");
    const clusterValue = String(form.get("cluster") ?? "");
    const timestampValue = Number(form.get("timestamp"));
    const nonce = String(form.get("nonce") ?? "");
    const signature = String(form.get("signature") ?? "");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Debes seleccionar una imagen." }, { status: 400 });
    }
    if (!ALLOWED_IMAGE_TYPES.has(file.type) || file.size === 0 || file.size > MAX_IMAGE_SIZE) {
      return NextResponse.json(
        { error: "La imagen debe ser PNG, JPG o WEBP y pesar máximo 5 MB." },
        { status: 400 }
      );
    }
    if (name.length < 3 || name.length > 64 || symbol.length < 2 || symbol.length > 10 || description.length > 500) {
      return NextResponse.json({ error: "Revisa el nombre, símbolo y descripción de la metadata." }, { status: 400 });
    }
    if (
      !["devnet", "mainnet-beta"].includes(clusterValue) ||
      !Number.isSafeInteger(timestampValue) ||
      Math.abs(Date.now() - timestampValue) > 5 * 60 * 1000 ||
      !/^[a-f0-9]{32,64}$/i.test(nonce) ||
      !signature
    ) {
      return NextResponse.json({ error: "La autorización de la wallet no es válida o ha expirado." }, { status: 401 });
    }

    const cluster = clusterValue as Cluster;
    let signatureValid = false;
    try {
      signatureValid = verifyWalletSignature({
        wallet,
        dealership,
        cluster,
        timestamp: timestampValue,
        nonce,
        signature,
      });
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) {
      return NextResponse.json({ error: "La firma de la wallet no es válida." }, { status: 401 });
    }

    let ownerValid = false;
    try {
      ownerValid = await verifyDealershipOwner(dealership, wallet, cluster);
    } catch {
      return NextResponse.json({ error: "No se pudo verificar el concesionario en Solana." }, { status: 502 });
    }
    if (!ownerValid) {
      return NextResponse.json({ error: "La wallet firmante no es propietaria de este concesionario." }, { status: 403 });
    }

    const imageForm = new FormData();
    imageForm.append("file", file, file.name || "loyalty-image");
    imageForm.append("pinataMetadata", JSON.stringify({ name: `${symbol}-loyalty-image` }));
    const imageResult = await pinataRequest("pinFileToIPFS", imageForm);
    if (!imageResult.IpfsHash) throw new Error("Pinata no devolvió el CID de la imagen.");

    const imageUri = `ipfs://${imageResult.IpfsHash}`;
    const metadata = {
      name,
      symbol,
      description,
      image: imageUri,
    };
    const metadataResult = await pinataRequest(
      "pinJSONToIPFS",
      JSON.stringify(metadata),
      "application/json"
    );
    if (!metadataResult.IpfsHash) throw new Error("Pinata no devolvió el CID de la metadata.");

    return NextResponse.json({
      imageUri,
      metadataUri: `ipfs://${metadataResult.IpfsHash}`,
      imageCid: imageResult.IpfsHash,
      metadataCid: metadataResult.IpfsHash,
    });
  } catch (error) {
    console.error("IPFS metadata upload error:", error);
    const message =
      error instanceof Error && error.message.includes("PINATA_JWT")
        ? "El servicio IPFS no está configurado en el servidor."
        : "No se pudo subir la metadata a IPFS.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
