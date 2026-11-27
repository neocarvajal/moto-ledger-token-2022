import { NextResponse } from "next/server";
import { getServiceRedemptionSession, updateServiceRedemptionSession } from "../../../../lib/service-redemption-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const body = (await request.json()) as { signature?: unknown; receipt?: unknown };
    if (
      typeof body.signature !== "string" || body.signature.length < 64 || body.signature.length > 100 ||
      typeof body.receipt !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(body.receipt)
    ) {
      return NextResponse.json({ error: "La confirmación del recibo no es válida." }, { status: 400 });
    }

    const current = await getServiceRedemptionSession(token);
    if (!current || current.status !== "signed") {
      return NextResponse.json({ error: "La solicitud no está lista para confirmarse." }, { status: 409 });
    }

    const updated = await updateServiceRedemptionSession(token, (session) => ({
      ...session,
      status: "completed",
    }));
    if (!updated) return NextResponse.json({ error: "La solicitud expiró." }, { status: 404 });

    return NextResponse.json({ status: updated.status, signature: body.signature, receipt: body.receipt }, {
      headers: { "Cache-Control": "no-store, private, max-age=0", Pragma: "no-cache" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo confirmar el canje." }, { status: 409 });
  }
}
