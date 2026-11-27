import { NextResponse } from "next/server";
import { address, getBase64Encoder, getTransactionDecoder } from "@solana/kit";
import { claimServiceRedemptionValue, getServiceRedemptionSession, updateServiceRedemptionSession } from "../../../../lib/service-redemption-store";

export const runtime = "nodejs";

function hasSignature(value: Uint8Array | null | undefined) {
  return Boolean(value && value.some((byte) => byte !== 0));
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const body = (await request.json()) as { transaction?: unknown; lastValidBlockHeight?: unknown };
    if (typeof body.transaction !== "string" || body.transaction.length < 100 ||
        body.transaction.length > 20_000 || !/^[A-Za-z0-9+/]+=*$/.test(body.transaction) ||
        typeof body.lastValidBlockHeight !== "string" || !/^\d+$/.test(body.lastValidBlockHeight)) {
      return NextResponse.json({ error: "Transacción preparada inválida." }, { status: 400 });
    }

    const session = await getServiceRedemptionSession(token);
    if (!session || session.status !== "ready_to_prepare") {
      return NextResponse.json({ error: "La solicitud ya no acepta una transacción." }, { status: 409 });
    }

    const transaction = getTransactionDecoder().decode(getBase64Encoder().encode(body.transaction));
    if (!hasSignature(transaction.signatures[address(session.owner)]) ||
        hasSignature(transaction.signatures[address(session.walletAddress)])) {
      return NextResponse.json({ error: "La transacción debe estar firmada por el concesionario y pendiente de la firma del cliente." }, { status: 400 });
    }

    const claimed = await claimServiceRedemptionValue(token, "transaction", body.transaction);
    if (!claimed) return NextResponse.json({ error: "Ya se publicó una transacción para esta solicitud." }, { status: 409 });

    const updated = await updateServiceRedemptionSession(token, (current) => ({
      ...current,
      transaction: body.transaction as string,
      lastValidBlockHeight: body.lastValidBlockHeight as string,
      status: "waiting_customer_signature",
    }));
    if (!updated) return NextResponse.json({ error: "La solicitud expiró." }, { status: 404 });
    return NextResponse.json({ status: updated.status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo publicar la transacción." }, { status: 409 });
  }
}
