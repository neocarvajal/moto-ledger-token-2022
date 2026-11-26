import { NextResponse } from "next/server";
import {
  createWalletLinkSession,
  createWalletLinkToken,
  isSolanaAddress,
  type WalletLinkCluster,
} from "../../../lib/wallet-link-store";

export const runtime = "nodejs";

const CLUSTERS: WalletLinkCluster[] = ["devnet", "testnet", "mainnet", "localnet"];

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (
      !isSolanaAddress(body.owner) ||
      !isSolanaAddress(body.cliente) ||
      !isSolanaAddress(body.concesionario) ||
      typeof body.cluster !== "string" ||
      !CLUSTERS.includes(body.cluster as WalletLinkCluster)
    ) {
      return NextResponse.json({ error: "Datos de solicitud inválidos." }, { status: 400 });
    }

    const token = createWalletLinkToken();
    const session = await createWalletLinkSession(token, {
      owner: body.owner,
      cliente: body.cliente,
      concesionario: body.concesionario,
      cluster: body.cluster as WalletLinkCluster,
    });

    return NextResponse.json({
      token,
      expiresAt: session.expiresAt,
      status: session.status,
    });
  } catch (error) {
    console.error("wallet-link create:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo crear la solicitud." },
      { status: 503 }
    );
  }
}
