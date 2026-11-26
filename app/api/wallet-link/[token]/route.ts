import { NextResponse } from "next/server";
import { getWalletLinkSession } from "../../../../lib/wallet-link-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const session = await getWalletLinkSession(token);
    if (!session) {
      return NextResponse.json({ error: "La solicitud expiró o ya no existe." }, { status: 404 });
    }
    return NextResponse.json(session, {
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }
}
