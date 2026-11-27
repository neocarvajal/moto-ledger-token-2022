import { NextResponse } from "next/server";
import { address, getBase64Encoder, getTransactionDecoder } from "@solana/kit";
import { claimServiceRedemptionValue, getServiceRedemptionSession, updateServiceRedemptionSession } from "../../../../lib/service-redemption-store";

export const runtime = "nodejs";

function sameBytes(left: ArrayLike<number>, right: ArrayLike<number>) {
  return left.length === right.length && Array.from(left).every((byte, index) => byte === right[index]);
}
function hasSignature(value: Uint8Array | null | undefined) {
  return Boolean(value && value.some((byte) => byte !== 0));
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const body = (await request.json()) as { transaction?: unknown };
    if (typeof body.transaction !== "string" || body.transaction.length < 100 ||
        body.transaction.length > 20_000 || !/^[A-Za-z0-9+/]+=*$/.test(body.transaction)) {
      return NextResponse.json({ error: "Transacción firmada inválida." }, { status: 400 });
    }

    const current = await getServiceRedemptionSession(token);
    if (!current || current.status !== "waiting_customer_signature" || !current.transaction) {
      return NextResponse.json({ error: "La solicitud no está esperando la firma del cliente." }, { status: 409 });
    }

    const decoder = getTransactionDecoder();
    const encoder = getBase64Encoder();
    const original = decoder.decode(encoder.encode(current.transaction));
    const submitted = decoder.decode(encoder.encode(body.transaction));
    if (!sameBytes(original.messageBytes, submitted.messageBytes)) {
      return NextResponse.json({ error: "La transacción firmada no coincide con la que autorizó el concesionario." }, { status: 400 });
    }
    if (!hasSignature(original.signatures[address(current.owner)]) ||
        !sameBytes(original.signatures[address(current.owner)]!, submitted.signatures[address(current.owner)] ?? []) ||
        !hasSignature(submitted.signatures[address(current.walletAddress)])) {
      return NextResponse.json({ error: "Faltan las firmas del concesionario o del cliente." }, { status: 400 });
    }

    const claimed = await claimServiceRedemptionValue(token, "signed", body.transaction);
    if (!claimed) return NextResponse.json({ error: "Ya se recibió una firma para esta solicitud." }, { status: 409 });

    const updated = await updateServiceRedemptionSession(token, (latest) => {
      if (latest.status !== "waiting_customer_signature" || latest.signedTransaction) {
        throw new Error("Esta solicitud ya recibió una firma.");
      }
      return { ...latest, signedTransaction: body.transaction as string, status: "signed" };
    });
    if (!updated) return NextResponse.json({ error: "La solicitud expiró." }, { status: 404 });
    return NextResponse.json({ status: updated.status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo guardar la firma del cliente." }, { status: 409 });
  }
}
