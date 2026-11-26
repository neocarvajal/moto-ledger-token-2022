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
      if (current.status !== "signed") throw new Error("La solicitud no está lista para completarse.");
      return { ...current, status: "completed" };
    });
    if (!session) return NextResponse.json({ error: "La solicitud expiró." }, { status: 404 });
    return NextResponse.json({ status: session.status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo cerrar la solicitud." },
      { status: 409 }
    );
  }
}
