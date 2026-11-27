import {
  getBase58Decoder,
  getBase64Encoder,
  type Address,
  type Base58EncodedBytes,
} from "@solana/kit";
import type { AppClient } from "../solana-client";
import { REGISTRO_PROGRAM_ADDRESS } from "./src/generated/programs";
import { deriveKilometrajeMotoPda } from "./pdas";
import {
  getServicioDecoder,
  getServicioDiscriminatorBytes,
} from "./src/generated/accounts/servicio";
import {
  getReclamacionDecoder,
  getReclamacionDiscriminatorBytes,
} from "./src/generated/accounts/reclamacion";
import {
  getCanjeServicioDecoder,
  getCanjeServicioDiscriminatorBytes,
} from "./src/generated/accounts/canjeServicio";

function discriminatorFilter(value: Uint8Array) {
  return getBase58Decoder().decode(value) as Base58EncodedBytes;
}

/**
 * Returns the highest odometer value already present in historical service,
 * warranty-claim, and loyalty-redemption records for this motorcycle.
 * This is used to establish a safe baseline when migrating legacy motorcycles
 * that predate the dedicated KilometrajeMoto PDA.
 */
export async function fetchHistoricalMotorcycleMileage(
  client: AppClient,
  moto: Address,
  concesionario: Address
): Promise<bigint> {
  const dealerFilter = concesionario as Base58EncodedBytes;
  const [serviceAccounts, claimAccounts, redemptionAccounts] = await Promise.all([
    client.rpc.getProgramAccounts(REGISTRO_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [
        { memcmp: { offset: 0n, bytes: discriminatorFilter(getServicioDiscriminatorBytes()), encoding: "base58" } },
        { memcmp: { offset: 8n, bytes: dealerFilter, encoding: "base58" } },
      ],
    }).send(),
    client.rpc.getProgramAccounts(REGISTRO_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [
        { memcmp: { offset: 0n, bytes: discriminatorFilter(getReclamacionDiscriminatorBytes()), encoding: "base58" } },
        { memcmp: { offset: 8n, bytes: dealerFilter, encoding: "base58" } },
      ],
    }).send(),
    client.rpc.getProgramAccounts(REGISTRO_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [
        { memcmp: { offset: 0n, bytes: discriminatorFilter(getCanjeServicioDiscriminatorBytes()), encoding: "base58" } },
        { memcmp: { offset: 8n, bytes: dealerFilter, encoding: "base58" } },
      ],
    }).send(),
  ]);

  const encoder = getBase64Encoder();
  let latest = 0n;

  for (const account of serviceAccounts) {
    const record = getServicioDecoder().decode(encoder.encode(account.account.data[0]));
    if (record.moto === moto && record.kilometraje > latest) latest = record.kilometraje;
  }
  for (const account of claimAccounts) {
    const record = getReclamacionDecoder().decode(encoder.encode(account.account.data[0]));
    if (record.moto === moto && record.kilometraje > latest) latest = record.kilometraje;
  }
  for (const account of redemptionAccounts) {
    const record = getCanjeServicioDecoder().decode(encoder.encode(account.account.data[0]));
    if (record.moto === moto && record.kilometrajeActual > latest) latest = record.kilometrajeActual;
  }

  return latest;
}


/**
 * Reads the shared on-chain odometer first. Historical scans are only needed
 * for motorcycles created before the KilometrajeMoto PDA was introduced.
 */
export async function fetchLatestMotorcycleMileage(
  client: AppClient,
  moto: Address,
  concesionario: Address
): Promise<bigint> {
  const [mileagePda] = await deriveKilometrajeMotoPda(moto);
  const info = await client.rpc.getAccountInfo(mileagePda, { encoding: "base64" }).send();

  if (!info.value) {
    return fetchHistoricalMotorcycleMileage(client, moto, concesionario);
  }

  const record = await client.registro.accounts.kilometrajeMoto.fetch(mileagePda);
  if (record.data.moto !== moto || record.data.concesionario !== concesionario) {
    throw new Error("El registro de kilometraje no corresponde a esta moto o concesionario.");
  }

  return record.data.kilometrajeActual;
}
