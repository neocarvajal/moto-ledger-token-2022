import { NextResponse } from "next/server";
import {
  createServiceRedemptionSession,
  createServiceRedemptionToken,
  isRedemptionAddress,
  type RedemptionCluster,
} from "../../lib/service-redemption-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLUSTERS: RedemptionCluster[] = ["devnet", "testnet", "mainnet"];

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (
      !isRedemptionAddress(body.owner) ||
      !isRedemptionAddress(body.concesionario) ||
      !isRedemptionAddress(body.cliente) ||
      !isRedemptionAddress(body.walletAddress) ||
      !isRedemptionAddress(body.mint) ||
      typeof body.clienteNombre !== "string" || !body.clienteNombre.trim() || body.clienteNombre.length > 120 ||
      typeof body.clienteCedula !== "string" || !body.clienteCedula.trim() || body.clienteCedula.length > 32 ||
      typeof body.servicioNombre !== "string" || !body.servicioNombre.trim() || body.servicioNombre.length > 100 ||
      typeof body.puntos !== "string" || !/^\d+$/.test(body.puntos) ||
      typeof body.kilometrajeActual !== "string" || !/^\d+$/.test(body.kilometrajeActual) ||
      typeof body.idCanje !== "string" || !/^\d+$/.test(body.idCanje) ||
      typeof body.servicioId !== "number" || !Number.isInteger(body.servicioId) ||
      typeof body.cluster !== "string" || !CLUSTERS.includes(body.cluster as RedemptionCluster)
    ) {
      return NextResponse.json({ error: "Los datos de la solicitud de canje no son válidos." }, { status: 400 });
    }

    const token = createServiceRedemptionToken();
    const session = await createServiceRedemptionSession(token, {
      owner: body.owner,
      concesionario: body.concesionario,
      cliente: body.cliente,
      clienteNombre: body.clienteNombre.trim(),
      clienteCedula: body.clienteCedula.trim(),
      walletAddress: body.walletAddress,
      mint: body.mint,
      servicioId: body.servicioId,
      servicioNombre: body.servicioNombre.trim(),
      puntos: body.puntos,
      kilometrajeActual: body.kilometrajeActual,
      idCanje: body.idCanje,
      cluster: body.cluster as RedemptionCluster,
    });

    return NextResponse.json({ token, expiresAt: session.expiresAt, status: session.status }, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", Pragma: "no-cache" },
    });
  } catch (error) {
    console.error("service-redemption create:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo iniciar el canje." }, { status: 503 });
  }
}
