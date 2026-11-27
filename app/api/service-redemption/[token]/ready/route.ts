import { NextResponse } from "next/server";
import { getServiceRedemptionSession, updateServiceRedemptionSession } from "../../../../lib/service-redemption-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const body = await request.json() as { walletAddress?: unknown };
    const session = await getServiceRedemptionSession(token);
    if (!session) return NextResponse.json({ error: "La solicitud expiró." }, { status: 404 });
    if (body.walletAddress !== session.walletAddress) {
      return NextResponse.json({ error: "La wallet conectada no corresponde al cliente de esta solicitud." }, { status: 403 });
    }
    const updated = await updateServiceRedemptionSession(token, (current) => {
      if (current.status === "ready_to_prepare" || current.status === "waiting_customer_signature") return current;
      if (current.status !== "waiting_customer_ready") throw new Error("La solicitud ya no está esperando al cliente.");
      return { ...current, status: "ready_to_prepare" };
    });
    if (!updated) return NextResponse.json({ error: "La solicitud expiró." }, { status: 404 });
    return NextResponse.json({ status: updated.status }, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", Pragma: "no-cache" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo confirmar la wallet del cliente." }, { status: 409 });
  }
}
