import { NextResponse } from "next/server";

export const runtime = "nodejs";

const CID_PATTERN = /^(?:b[a-z2-7]{20,}|Qm[1-9A-HJ-NP-Za-km-z]{44})$/;

export async function GET(request: Request) {
  const cid = new URL(request.url).searchParams.get("cid")?.trim();

  if (!cid || !CID_PATTERN.test(cid)) {
    return NextResponse.json({ error: "CID IPFS inválido." }, { status: 400 });
  }

  const gateway = process.env.NEXT_PUBLIC_GATEWAY_URL
    ?.trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");

  if (!gateway || !/^[a-z0-9.-]+(?::\d+)?$/i.test(gateway)) {
    return NextResponse.json(
      { error: "El gateway IPFS no está configurado correctamente." },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(`https://${gateway}/ipfs/${cid}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "No se pudo recuperar la metadata desde IPFS." },
        { status: response.status === 404 ? 404 : 502 }
      );
    }

    const metadata: unknown = await response.json();
    if (
      typeof metadata !== "object" ||
      metadata === null ||
      !("image" in metadata) ||
      typeof metadata.image !== "string"
    ) {
      return NextResponse.json(
        { error: "El JSON IPFS no contiene un campo image válido." },
        { status: 422 }
      );
    }

    return NextResponse.json(metadata, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("No se pudo recuperar metadata IPFS:", error);
    return NextResponse.json(
      { error: "No se pudo consultar el gateway IPFS." },
      { status: 502 }
    );
  }
}
