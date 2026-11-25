import {
  getAddressEncoder,
  getProgramDerivedAddress,
  getU32Encoder,
  getU64Encoder,
  getUtf8Encoder,
  type Address,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { REGISTRO_PROGRAM_ADDRESS } from "./src/generated/programs";

const utf8 = getUtf8Encoder();
const addressEncoder = getAddressEncoder();

const seed = (value: string) => utf8.encode(value);
const key = (value: Address) => addressEncoder.encode(value);

export async function deriveRegistroGlobalPda() {
  return getProgramDerivedAddress({
    programAddress: REGISTRO_PROGRAM_ADDRESS,
    seeds: [seed("registro_global")],
  });
}

export async function deriveConcesionarioPda(
  nombreConcesionario: string,
  owner: Address
) {
  return getProgramDerivedAddress({
    programAddress: REGISTRO_PROGRAM_ADDRESS,
    seeds: [
      seed("concesionario"),
      seed(nombreConcesionario),
      key(owner),
    ],
  });
}

export async function deriveMotoPda(serial: string, concesionario: Address) {
  return getProgramDerivedAddress({
    programAddress: REGISTRO_PROGRAM_ADDRESS,
    seeds: [seed("registro_moto"), seed(serial), key(concesionario)],
  });
}

export async function deriveClientePda(owner: Address, cedulaCliente: number) {
  return getProgramDerivedAddress({
    programAddress: REGISTRO_PROGRAM_ADDRESS,
    seeds: [seed("cliente"), key(owner), getU32Encoder().encode(cedulaCliente)],
  });
}

export async function deriveVentaPda(moto: Address) {
  return getProgramDerivedAddress({
    programAddress: REGISTRO_PROGRAM_ADDRESS,
    seeds: [seed("venta"), key(moto)],
  });
}

export async function deriveGarantiaPda(serial: string) {
  return getProgramDerivedAddress({
    programAddress: REGISTRO_PROGRAM_ADDRESS,
    seeds: [seed("garantia"), seed(serial)],
  });
}

export async function deriveServicioPda(moto: Address, currentServices: bigint) {
  return getProgramDerivedAddress({
    programAddress: REGISTRO_PROGRAM_ADDRESS,
    seeds: [
      seed("servicio"),
      key(moto),
      getU64Encoder().encode(currentServices),
    ],
  });
}

/** PDA that stores the loyalty configuration for a dealership. */
export async function deriveProgramaFidelidadPda(concesionario: Address) {
  return getProgramDerivedAddress({
    programAddress: REGISTRO_PROGRAM_ADDRESS,
    seeds: [seed("programa_fidelidad"), key(concesionario)],
  });
}

/** Mint authority PDA used to sign Token-2022 MintTo CPIs. */
export async function deriveAutoridadFidelidadPda(concesionario: Address) {
  return getProgramDerivedAddress({
    programAddress: REGISTRO_PROGRAM_ADDRESS,
    seeds: [seed("autoridad_fidelidad"), key(concesionario)],
  });
}

/** One customer-to-wallet association per MotoLedger customer account. */
export async function deriveWalletClientePda(cliente: Address) {
  return getProgramDerivedAddress({
    programAddress: REGISTRO_PROGRAM_ADDRESS,
    seeds: [seed("wallet_cliente"), key(cliente)],
  });
}

/** One issuance record per sale, preventing duplicate loyalty rewards. */
export async function derivePuntosVentaPda(venta: Address) {
  return getProgramDerivedAddress({
    programAddress: REGISTRO_PROGRAM_ADDRESS,
    seeds: [seed("puntos_venta"), key(venta)],
  });
}

/**
 * Derive the buyer's ATA using Token-2022. The token program is part of the
 * associated-token address seeds, so the base SPL Token address is incorrect.
 */
export async function deriveToken2022Ata(owner: Address, mint: Address) {
  return findAssociatedTokenPda({
    owner,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });
}
