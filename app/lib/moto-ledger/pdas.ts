import {
  getAddressEncoder,
  getProgramDerivedAddress,
  getU32Encoder,
  getU64Encoder,
  getUtf8Encoder,
  type Address,
} from "@solana/kit";
import { REGISTRO_PROGRAM_ADDRESS } from "./generated/src/generated/programs";

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