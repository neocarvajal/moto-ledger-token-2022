import { createHash, randomBytes } from "node:crypto";

export type RedemptionCluster = "devnet" | "testnet" | "mainnet" | "localnet";

export type ServiceRedemptionSession = {
  owner: string;
  concesionario: string;
  cliente: string;
  clienteNombre: string;
  clienteCedula: string;
  walletAddress: string;
  mint: string;
  servicioId: number;
  servicioNombre: string;
  puntos: string;
  kilometrajeActual: string;
  idCanje: string;
  cluster: RedemptionCluster;
  transaction: string | null;
  signedTransaction: string | null;
  status: "waiting_transaction" | "waiting_customer_signature" | "signed" | "completed" | "cancelled";
  createdAt: number;
  expiresAt: number;
};

const SESSION_TTL_SECONDS = 300;
const KEY_PREFIX = "moto-ledger:service-redemption:";
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

  const payload = (await response.json()) as { result?: T; error?: string };
  if (!response.ok || payload.error) {
    console.error("Upstash Redis response:", { status: response.status, error: payload.error });
    throw new Error("Upstash Redis rechazó la operación.");
  }
  return payload.result as T;
}

function redisKey(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Solicitud de canje inválida.");
  return KEY_PREFIX + createHash("sha256").update(token).digest("hex");
}

export function isRedemptionAddress(value: unknown): value is string {
  return typeof value === "string" && ADDRESS_PATTERN.test(value);
}

export function createServiceRedemptionToken() {
  return randomBytes(32).toString("hex");
}

export async function createServiceRedemptionSession(
  token: string,
  input: Omit<ServiceRedemptionSession, "transaction" | "signedTransaction" | "status" | "createdAt" | "expiresAt">
) {
  if (!Number.isInteger(input.servicioId) || input.servicioId < 0 || input.servicioId > 255) {
    throw new Error("El servicio seleccionado no es válido.");
  }
  if (!/^\d+$/.test(input.puntos) || BigInt(input.puntos) <= 0n) {
    throw new Error("La cantidad de puntos no es válida.");
  }
  if (!/^\d+$/.test(input.kilometrajeActual) || !/^\d+$/.test(input.idCanje)) {
    throw new Error("Los datos del canje no son válidos.");
  }
  for (const value of [input.owner, input.concesionario, input.cliente, input.walletAddress, input.mint]) {
    if (!isRedemptionAddress(value)) throw new Error("La solicitud contiene una dirección inválida.");
  }

  const now = Date.now();
  const session: ServiceRedemptionSession = {
    ...input,
    transaction: null,
    signedTransaction: null,
    status: "waiting_transaction",
    createdAt: now,
    expiresAt: now + SESSION_TTL_SECONDS * 1000,
  };
  const result = await redisCommand<string>(
    "SET", redisKey(token), JSON.stringify(session), "EX", String(SESSION_TTL_SECONDS), "NX"
  );
  if (result !== "OK") throw new Error("No se pudo crear la solicitud temporal de canje.");
  return session;
}

export async function getServiceRedemptionSession(token: string) {
  const raw = await redisCommand<string | null>("GET", redisKey(token));
  if (!raw) return null;
  const session = JSON.parse(raw) as ServiceRedemptionSession;
  if (session.expiresAt <= Date.now()) return null;
  return session;
}

export async function updateServiceRedemptionSession(
  token: string,
  update: (session: ServiceRedemptionSession) => ServiceRedemptionSession
) {
  const key = redisKey(token);
  const current = await getServiceRedemptionSession(token);
  if (!current) return null;
  const next = update(current);
  const immutableFields: (keyof ServiceRedemptionSession)[] = [
    "owner", "concesionario", "cliente", "clienteNombre", "clienteCedula",
    "walletAddress", "mint", "servicioId", "servicioNombre", "puntos",
    "kilometrajeActual", "idCanje", "cluster", "createdAt", "expiresAt",
  ];
  if (immutableFields.some((field) => next[field] !== current[field])) {
    throw new Error("No se puede modificar la intención original del canje.");
  }

  const allowedTransitions: Record<ServiceRedemptionSession["status"], ServiceRedemptionSession["status"][]> = {
    waiting_transaction: ["waiting_customer_signature", "cancelled"],
    waiting_customer_signature: ["signed", "cancelled"],
    signed: ["completed", "cancelled"],
    completed: [],
    cancelled: [],
  };
  if (next.status !== current.status && !allowedTransitions[current.status].includes(next.status)) {
    throw new Error("Transición de estado de canje no permitida.");
  }
  if (current.status !== "waiting_transaction" && next.transaction !== current.transaction) {
    throw new Error("La transacción preparada no puede sustituirse.");
  }
  if (current.status !== "waiting_customer_signature" && next.signedTransaction !== current.signedTransaction) {
    throw new Error("La firma del cliente no puede sustituirse.");
  }
  const remainingSeconds = Math.max(1, Math.ceil((next.expiresAt - Date.now()) / 1000));
  await redisCommand("SET", key, JSON.stringify(next), "EX", remainingSeconds);
  return next;
}

export const serviceRedemptionSessionTtlSeconds = SESSION_TTL_SECONDS;
