import { createHash, randomBytes } from "node:crypto";

export type WalletLinkCluster = "devnet" | "testnet" | "mainnet" | "localnet";

export type WalletLinkSession = {
  owner: string;
  cliente: string;
  clienteNombre: string;
  clienteCedula: string;
  concesionario: string;
  cluster: WalletLinkCluster;
  walletAddress: string | null;
  transaction: string | null;
  signedTransaction: string | null;
  status: "waiting_wallet" | "waiting_transaction" | "waiting_customer_signature" | "signed" | "completed" | "cancelled";
  createdAt: number;
  expiresAt: number;
};

const SESSION_TTL_SECONDS = 300;
const KEY_PREFIX = "moto-ledger:wallet-link:";
const ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error("El almacenamiento temporal no está configurado. Define UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN.");
  }
  return { url, token };
}


async function redisCommand<T>(...command: (string | number)[]): Promise<T> {
  const { url, token } = redisConfig();

  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
      cache: "no-store",
    });
  } catch (error) {
    console.error("Upstash connection error:", error);
    throw new Error("No se pudo conectar con Upstash Redis.");
  }

  const payload = (await response.json()) as {
    result?: T;
    error?: string;
  };

  if (!response.ok || payload.error) {
    console.error("Upstash Redis response:", {
      status: response.status,
      error: payload.error,
    });
    throw new Error("Upstash Redis rechazó la operación.");
  }

  return payload.result as T;
}


function redisKey(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Solicitud de vinculación inválida.");
  const digest = createHash("sha256").update(token).digest("hex");
  return KEY_PREFIX + digest;
}

export function isSolanaAddress(value: unknown): value is string {
  return typeof value === "string" && ADDRESS_PATTERN.test(value);
}

export function createWalletLinkToken() {
  return randomBytes(32).toString("hex");
}

export async function createWalletLinkSession(
  token: string,
  input: Pick<WalletLinkSession, "owner" | "cliente" | "clienteNombre" | "clienteCedula" | "concesionario" | "cluster">
) {
  const now = Date.now();
  const session: WalletLinkSession = {
    ...input,
    walletAddress: null,
    transaction: null,
    signedTransaction: null,
    status: "waiting_wallet",
    createdAt: now,
    expiresAt: now + SESSION_TTL_SECONDS * 1000,
  };
  const result = await redisCommand<string>("SET", redisKey(token), JSON.stringify(session), "EX", String(SESSION_TTL_SECONDS), "NX");
  if (result !== "OK") throw new Error("No se pudo crear la solicitud temporal.");
  return session;
}

export async function getWalletLinkSession(token: string) {
  const raw = await redisCommand<string | null>("GET", redisKey(token));
  if (!raw) return null;
  const session = JSON.parse(raw) as WalletLinkSession;
  if (session.expiresAt <= Date.now()) return null;
  return session;
}


export async function claimWalletLinkValue(
  token: string,
  step: "wallet" | "transaction" | "signed",
  value: string
) {
  const session = await getWalletLinkSession(token);
  if (!session) return false;
  const key = redisKey(token) + ":" + step;
  const ttl = Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1000));
  const result = await redisCommand<string>("SET", key, value, "EX", String(ttl), "NX");
  if (result === "OK") return true;
  const existing = await redisCommand<string | null>("GET", key);
  return existing === value;
}

export async function updateWalletLinkSession(
  token: string,
  update: (session: WalletLinkSession) => WalletLinkSession
) {
  const key = redisKey(token);
  const current = await getWalletLinkSession(token);
  if (!current) return null;
  const next = update(current);
  const remainingSeconds = Math.max(1, Math.ceil((next.expiresAt - Date.now()) / 1000));
  await redisCommand("SET", key, JSON.stringify(next), "EX", remainingSeconds);
  return next;
}

export const walletLinkSessionTtlSeconds = SESSION_TTL_SECONDS;
