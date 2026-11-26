import { NextResponse } from "next/server";
import {
  isSolanaAddress,
  updateWalletLinkSession,
} from "../../../../../lib/wallet-link-store";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const body = (await request.json()) as { walletAddress?: unknown };
    if (!isSolanaAddress(body.walletAddress)) {
      return NextResponse.json({ error: "La dirección de wallet no es válida." }, { status: 400 });
    }

    const session = await updateWalletLinkSession(token, (current) => {
      if (current.status !== "waiting_wallet") {
        throw new Error("Esta solicitud ya fue utilizada o está en curso.");
      }
      return {
        ...current,
        walletAddress: body.walletAddress as string,
        status: "waiting_transaction",
      };
    });

    if (!session) return NextResponse.json({ error: "La solicitud expiró." }, { status: 404 });
    return NextResponse.json({ status: session.status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo registrar la wallet." },
      { status: 409 }
    );
  }
}
