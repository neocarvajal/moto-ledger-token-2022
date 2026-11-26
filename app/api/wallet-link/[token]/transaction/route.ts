import { NextResponse } from "next/server";
import { updateWalletLinkSession } from "../../../../../lib/wallet-link-store";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const body = (await request.json()) as { transaction?: unknown };
    if (
      typeof body.transaction !== "string" ||
      body.transaction.length < 100 ||
      body.transaction.length > 12_000 ||
      !/^[A-Za-z0-9+/]+=*$/.test(body.transaction)
    ) {
      return NextResponse.json({ error: "Transacción serializada inválida." }, { status: 400 });
    }

    const session = await updateWalletLinkSession(token, (current) => {
      if (current.status !== "waiting_transaction" || !current.walletAddress || current.transaction) {
        throw new Error("La solicitud no está esperando una transacción.");
      }
      return {
        ...current,
        transaction: body.transaction as string,
        status: "waiting_customer_signature",
      };
    });

    if (!session) return NextResponse.json({ error: "La solicitud expiró." }, { status: 404 });
    return NextResponse.json({ status: session.status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo preparar la transacción." },
      { status: 409 }
    );
  }
}
