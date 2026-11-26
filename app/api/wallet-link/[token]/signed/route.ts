import { NextResponse } from "next/server";
import {
  getBase64Encoder,
  getTransactionDecoder,
} from "@solana/kit";
import {
  claimWalletLinkValue,
  getWalletLinkSession,
  updateWalletLinkSession,
} from "../../../../../lib/wallet-link-store";

export const runtime = "nodejs";

function sameBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

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

    const current = await getWalletLinkSession(token);
    if (!current || current.status !== "waiting_customer_signature" || !current.transaction || !current.walletAddress) {
      return NextResponse.json({ error: "La solicitud no está esperando la firma del comprador." }, { status: 409 });
    }

    const decoder = getTransactionDecoder();
    const encoder = getBase64Encoder();
    const original = decoder.decode(encoder.encode(current.transaction));
    const submitted = decoder.decode(encoder.encode(body.transaction));

    if (!sameBytes(original.messageBytes, submitted.messageBytes)) {
      return NextResponse.json({ error: "La transacción firmada no coincide con la que autorizó el concesionario." }, { status: 400 });
    }

    const ownerSignature = original.signatures[current.owner];
    const submittedOwnerSignature = submitted.signatures[current.owner];
    const customerSignature = submitted.signatures[current.walletAddress];

    if (
      !ownerSignature ||
      !submittedOwnerSignature ||
      !sameBytes(ownerSignature, submittedOwnerSignature) ||
      !customerSignature ||
      customerSignature.every((byte) => byte === 0)
    ) {
      return NextResponse.json({ error: "Faltan las firmas requeridas para esta vinculación." }, { status: 400 });
    }

    const claimed = await claimWalletLinkValue(token, "signed", body.transaction);
    if (!claimed) return NextResponse.json({ error: "Ya se recibió otra firma para esta solicitud." }, { status: 409 });

    const session = await updateWalletLinkSession(token, (latest) => {
      if (latest.signedTransaction === body.transaction) return latest;
      if (latest.status !== "waiting_customer_signature" || latest.signedTransaction) {
        throw new Error("La solicitud ya fue utilizada.");
      }
      return {
        ...latest,
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
