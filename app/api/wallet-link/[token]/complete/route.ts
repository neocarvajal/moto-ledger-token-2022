import { NextResponse } from "next/server";
import {
  getBase64Encoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
} from "@solana/kit";
import {
  getWalletLinkSession,
  updateWalletLinkSession,
  type WalletLinkCluster,
} from "../../../../lib/wallet-link-store";

export const runtime = "nodejs";

const RPC_URLS: Record<Exclude<WalletLinkCluster, "localnet">, string> = {
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
};

export async function POST(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const current = await getWalletLinkSession(token);
    if (!current || current.status !== "signed" || !current.signedTransaction || current.cluster === "localnet") {
      return NextResponse.json({ error: "La transacción firmada no está disponible." }, { status: 409 });
    }

    const bytes = getBase64Encoder().encode(current.signedTransaction);
    const transaction = getTransactionDecoder().decode(bytes);
    const signature = getSignatureFromTransaction(transaction);
    const rpcResponse = await fetch(RPC_URLS[current.cluster], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "wallet-link-confirmation",
        method: "getSignatureStatuses",
        params: [[signature], { searchTransactionHistory: true }],
      }),
      cache: "no-store",
    });
    if (!rpcResponse.ok) throw new Error("No se pudo verificar la confirmación en Solana.");
    const rpcPayload = (await rpcResponse.json()) as {
      result?: { value?: Array<{ confirmationStatus?: string; err?: unknown } | null> };
    };
    const status = rpcPayload.result?.value?.[0];
    if (!status || status.err || !["confirmed", "finalized"].includes(status.confirmationStatus ?? "")) {
      return NextResponse.json({ error: "La transacción todavía no está confirmada en Solana." }, { status: 409 });
    }

    const session = await updateWalletLinkSession(token, (latest) => {
      if (latest.status === "completed") return latest;
      if (latest.status !== "signed") throw new Error("La solicitud ya no está lista para completarse.");
      return { ...latest, status: "completed" };
    });
    if (!session) return NextResponse.json({ error: "La solicitud expiró." }, { status: 404 });
    return NextResponse.json({ status: session.status, signature });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo cerrar la solicitud." },
      { status: 409 }
    );
  }
}
