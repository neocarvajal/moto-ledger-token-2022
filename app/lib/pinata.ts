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

  console.info("[Pinata] Buscando grupo:", groupName);

  const existing = await pinata.groups.public
    .list()
    .name(groupName)
    .limit(100);

  const exactMatch = existing.groups.find(
    (group) => group.name === groupName
  );

  if (exactMatch) {
    console.info("[Pinata] Grupo encontrado:", exactMatch.id);
    return exactMatch;
  }

  console.info("[Pinata] Creando grupo:", groupName);

  const created = await pinata.groups.public.create({
    name: groupName,
    isPublic: true,
  });

  console.info("[Pinata] Grupo creado:", created.id);

  return created;
}
