import { NextResponse } from "next/server";
import { address, getBase64Encoder, getTransactionDecoder } from "@solana/kit";
import { claimWalletLinkValue, getWalletLinkSession, updateWalletLinkSession } from "../../../../lib/wallet-link-store";

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

    const current = await getWalletLinkSession(token);
    if (!current || current.status !== "waiting_transaction" || !current.walletAddress || current.transaction) {
      return NextResponse.json({ error: "La solicitud no está esperando una transacción." }, { status: 409 });
    }
    const transaction = getTransactionDecoder().decode(getBase64Encoder().encode(body.transaction));
    const ownerSignature = transaction.signatures[address(current.owner)];
    const buyerSignature = transaction.signatures[address(current.walletAddress)];
    if (
      !ownerSignature ||
      ownerSignature.every((byte) => byte === 0) ||
      (buyerSignature && buyerSignature.some((byte) => byte !== 0))
    ) {
      return NextResponse.json({ error: "La transacción debe incluir la firma del concesionario y dejar pendiente la firma del comprador." }, { status: 400 });
    }

    const claimed = await claimWalletLinkValue(token, "transaction", body.transaction);
    if (!claimed) return NextResponse.json({ error: "Ya se preparó otra transacción para esta solicitud." }, { status: 409 });
    const session = await updateWalletLinkSession(token, (latest) => {
      if (latest.transaction === body.transaction) return latest;
      if (latest.status !== "waiting_transaction" || latest.walletAddress !== current.walletAddress || latest.transaction) {
        throw new Error("La solicitud ya no está esperando una transacción.");
      }
      return {
        ...latest,
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
