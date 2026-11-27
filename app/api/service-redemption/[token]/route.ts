import { NextResponse } from "next/server";
import { getServiceRedemptionSession, updateServiceRedemptionSession } from "../../../../lib/service-redemption-store";

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

export async function DELETE(_request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const updated = await updateServiceRedemptionSession(token, (session) => {
      if (session.status === "signed" || session.status === "completed") {
        throw new Error("El cliente ya firmó. No se puede cancelar desde el QR.");
      }
      if (session.status === "cancelled") return session;
      return { ...session, status: "cancelled" };
    });
    if (!updated) return NextResponse.json({ error: "La solicitud expiró." }, { status: 404 });
    return NextResponse.json({ status: updated.status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cancelar la solicitud." }, { status: 409 });
  }
}
