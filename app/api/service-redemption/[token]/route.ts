import { NextResponse } from "next/server";
import { getServiceRedemptionSession } from "../../../../lib/service-redemption-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const session = await getServiceRedemptionSession(token);
    if (!session) return NextResponse.json({ error: "La solicitud expiró o ya no existe." }, { status: 404 });
    return NextResponse.json(session, { headers: { "Cache-Control": "no-store, private, max-age=0", Pragma: "no-cache" } });
  } catch {
    return NextResponse.json({ error: "Solicitud de canje inválida." }, { status: 400 });
  }
}
