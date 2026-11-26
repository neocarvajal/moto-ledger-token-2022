import "server-only";

import { PinataSDK } from "pinata";

let client: PinataSDK | undefined;

export function getPinataClient() {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    throw new Error("PINATA_JWT no está configurado en el servidor.");
  }

  if (!client) {
    client = new PinataSDK({
      pinataJwt: jwt,
      pinataGateway: process.env.NEXT_PUBLIC_GATEWAY_URL,
    });
  }

  return client;
}

export async function getOrCreateDealershipGroup(dealership: string) {
  const pinata = getPinataClient();
  const groupName = `MotoLedger-${dealership}`;
  let stage = "consulta del grupo";

  try {
    console.info("[Pinata] 1. Consultando grupo:", groupName);

    const existing = await pinata.groups.public
      .list()
      .name(groupName)
      .limit(100);

    const exactMatch = existing.groups.find(
      (group) => group.name === groupName
    );

    if (exactMatch) {
      console.info("[Pinata] 2. Grupo existente:", exactMatch.id);
      return exactMatch;
    }

    stage = "creación del grupo";
    console.info("[Pinata] 3. Creando grupo:", groupName);

    const created = await pinata.groups.public.create({
      name: groupName,
    });

    console.info("[Pinata] 4. Grupo creado:", created.id);
    return created;
  } catch (error) {
    console.error(`[Pinata] Error durante ${stage}:`, error);
    throw error;
  }
}
