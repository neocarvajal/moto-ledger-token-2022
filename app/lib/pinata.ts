import "server-only";

import { PinataSDK } from "pinata";

let client: PinataSDK | undefined;

export function getPinataClient() {
  console.log(`pinataGateway: ${process.env.NEXT_PUBLIC_GATEWAY_URL}`);
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
