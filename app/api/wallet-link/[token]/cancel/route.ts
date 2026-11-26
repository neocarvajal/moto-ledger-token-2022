import { NextResponse } from "next/server";
import { updateWalletLinkSession } from "../../../../../lib/wallet-link-store";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const session = await updateWalletLinkSession(token, (current) => {
      if (current.status === "completed") return current;
      return { ...current, status: "cancelled" };
    });
    if (!session) return NextResponse.json({ error: "La solicitud expiró." }, { status: 404 });
    return NextResponse.json({ status: session.status });
  } catch {
    return NextResponse.json({ error: "No se pudo cancelar la solicitud." }, { status: 400 });
  }
}
