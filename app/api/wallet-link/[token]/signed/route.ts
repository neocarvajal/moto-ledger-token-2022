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
      return NextResponse.json({ error: "Transacción firmada inválida." }, { status: 400 });
    }

    const session = await updateWalletLinkSession(token, (current) => {
      if (current.status !== "waiting_customer_signature" || !current.transaction || current.signedTransaction) {
        throw new Error("La solicitud no está esperando la firma del comprador.");
      }
      return {
        ...current,
        signedTransaction: body.transaction as string,
        status: "signed",
      };
    });

    if (!session) return NextResponse.json({ error: "La solicitud expiró." }, { status: 404 });
    return NextResponse.json({ status: session.status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo guardar la firma." },
      { status: 409 }
    );
  }
}
