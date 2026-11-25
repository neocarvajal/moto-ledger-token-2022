import { createHash } from "node:crypto";
import { address, createNoopSigner } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  getConfigurarGarantiaInstruction,
  getConfigurarGarantiaInstructionDataDecoder,
  getEliminarMotoInstruction,
  getEliminarMotoInstructionDataDecoder,
  getReclamarGarantiaInstruction,
  getReclamarGarantiaInstructionDataDecoder,
  getRegistrarClienteInstruction,
  getRegistrarClienteInstructionDataDecoder,
  getRegistrarConcesionarioInstruction,
  getRegistrarConcesionarioInstructionDataDecoder,
  getRegistrarMotoInstruction,
  getRegistrarMotoInstructionDataDecoder,
  getRegistrarServicioInstruction,
  getRegistrarServicioInstructionDataDecoder,
  getRegistrarVentaInstruction,
  getRegistrarVentaInstructionDataDecoder,
} from "../../app/lib/moto-ledger/generated/src/generated";
import { REGISTRO_PROGRAM_ADDRESS } from "../../app/lib/moto-ledger/generated/src/generated/programs";
import { TipoServicio } from "../../app/lib/moto-ledger/generated/src/generated/types";

const ownerAddress = address(
  "CCF4CnM99mXSxz2sFffxT4A4CZxpWNsKNPbwueJThGMo"
);
const owner = createNoopSigner(ownerAddress);
const registroGlobal = address(
  "6bJpY3vCPb8giM8WwhfsiDgKbaY77AASzy4PxScTLhAo"
);
const concesionario = address(
  "7n7tA4N999UpXc6vfV7odSVek4JydyMEfUZNdGsbsc7o"
);
const moto = address("247Qs9cEC8Lyn9z76sHC9EBPCWNtiQULvDkYt2p58mer");
const garantia = address("ArixyEXxhaePfLFw8XxvsY5wUYPGLZUSKpH4SsZuBKHP");
const cliente = address("Bkqenztc4YScJr1GNLEnUQxsHZE6pwhfH1ScKZCwiGte");
const venta = address("AdfybrUm7UX2ZTkJRo9NQLGWooGywtf9RKEegaMwAWp");
const servicio = address("66VbHcx43C94XVASUtzM6mxy2nwbpPMdwBBLejZ9uNEt");
const reclamacion = address("LU16b9JNWweojQfLUmNEJNrYvFY8tVnMYRscG1SZxJs");
const systemProgram = address("11111111111111111111111111111111");

function expectInstruction(
  instruction: {
    programAddress: string;
    data: ArrayLike<number>;
    accounts: readonly { address: string; role: number }[];
  },
  instructionName: string,
  expectedAccounts: string[],
  expectedRoles: number[]
) {
  const expectedDiscriminator = createHash("sha256")
    .update(`global:${instructionName}`)
    .digest()
    .subarray(0, 8);

  expect(instruction.programAddress).toBe(REGISTRO_PROGRAM_ADDRESS);
  expect(Array.from(instruction.data).slice(0, 8)).toEqual(
    Array.from(expectedDiscriminator)
  );
  expect(instruction.accounts.map((account) => account.address)).toEqual(
    expectedAccounts
  );
  // Solana AccountRole: readonly=0, writable=1, readonly signer=2,
  // writable signer=3.
  expect(instruction.accounts.map((account) => account.role)).toEqual(
    expectedRoles
  );
}

describe("MotoLedger Codama instructions", () => {
  it("serializes registrarConcesionario with the expected data and account metas", () => {
    const ix = getRegistrarConcesionarioInstruction({
      owner,
      registroGlobal,
      concesionario,
      nombreConcesionario: "BERA MOTORS",
      rifConcesionario: "J123456789",
    });

    expectInstruction(
      ix,
      "registrar_concesionario",
      [ownerAddress, registroGlobal, concesionario, systemProgram],
      [3, 1, 1, 0]
    );
    expect(getRegistrarConcesionarioInstructionDataDecoder().decode(ix.data))
      .toMatchObject({
        nombreConcesionario: "BERA MOTORS",
        rifConcesionario: "J123456789",
      });
  });

  it("serializes configurarGarantia with u16 and u64 values", () => {
    const ix = getConfigurarGarantiaInstruction({
      owner,
      concesionario,
      nombreConcesionario: "BERA MOTORS",
      duracionGarantiaDias: 365,
      kilometrajeMaximo: 12000n,
    });

    expectInstruction(ix, "configurar_garantia", [ownerAddress, concesionario], [3, 1]);
    expect(getConfigurarGarantiaInstructionDataDecoder().decode(ix.data))
      .toMatchObject({
        nombreConcesionario: "BERA MOTORS",
        duracionGarantiaDias: 365,
        kilometrajeMaximo: 12000n,
      });
  });

  it("serializes registrarMoto and preserves the account order", () => {
    const ix = getRegistrarMotoInstruction({
      owner,
      concesionario,
      garantia,
      moto,
      serial: "BER0DT1500BM00003",
      placa: "AB123CD",
      marca: "Bera",
      modelo: "DT150",
      color: "Negro",
    });

    expectInstruction(
      ix,
      "registrar_moto",
      [ownerAddress, concesionario, garantia, moto, systemProgram],
      [3, 1, 1, 1, 0]
    );
    expect(getRegistrarMotoInstructionDataDecoder().decode(ix.data))
      .toMatchObject({
        serial: "BER0DT1500BM00003",
        placa: "AB123CD",
        marca: "Bera",
        modelo: "DT150",
        color: "Negro",
      });
  });

  it("serializes registrarCliente with its u32 identity", () => {
    const ix = getRegistrarClienteInstruction({
      owner,
      concesionario,
      cliente,
      nombreConcesionario: "BERA MOTORS",
      cedulaCliente: 12345678,
      nombreCliente: "Ana Pérez",
    });

    expectInstruction(
      ix,
      "registrar_cliente",
      [ownerAddress, concesionario, cliente, systemProgram],
      [3, 1, 1, 0]
    );
    expect(getRegistrarClienteInstructionDataDecoder().decode(ix.data))
      .toMatchObject({
        nombreConcesionario: "BERA MOTORS",
        cedulaCliente: 12345678,
        nombreCliente: "Ana Pérez",
      });
  });

  it("serializes registrarVenta with the u64 sale amount", () => {
    const ix = getRegistrarVentaInstruction({
      owner,
      concesionario,
      cliente,
      moto,
      venta,
      nombreConcesionario: "BERA MOTORS",
      serial: "BER0DT1500BM00003",
      cedulaCliente: 12345678,
      precioVenta: 8500000n,
    });

    expectInstruction(
      ix,
      "registrar_venta",
      [ownerAddress, concesionario, cliente, moto, venta, systemProgram],
      [3, 1, 1, 1, 1, 0]
    );
    expect(getRegistrarVentaInstructionDataDecoder().decode(ix.data))
      .toMatchObject({
        nombreConcesionario: "BERA MOTORS",
        serial: "BER0DT1500BM00003",
        cedulaCliente: 12345678,
        precioVenta: 8500000n,
      });
  });

  it("serializes registrarServicio and keeps warranty readonly", () => {
    const ix = getRegistrarServicioInstruction({
      owner,
      concesionario,
      moto,
      garantia,
      servicio,
      nombreConcesionario: "BERA MOTORS",
      serial: "BER0DT1500BM00003",
      kilometraje: 1250n,
      descripcion: "Mantenimiento preventivo",
      costo: 250000n,
      tipo: TipoServicio.Mantenimiento,
    });

    expectInstruction(
      ix,
      "registrar_servicio",
      [ownerAddress, concesionario, moto, garantia, servicio, systemProgram],
      [3, 1, 1, 0, 1, 0]
    );
    expect(getRegistrarServicioInstructionDataDecoder().decode(ix.data))
      .toMatchObject({
        nombreConcesionario: "BERA MOTORS",
        serial: "BER0DT1500BM00003",
        kilometraje: 1250n,
        descripcion: "Mantenimiento preventivo",
        costo: 250000n,
        tipo: TipoServicio.Mantenimiento,
      });
  });

  it("serializes reclamarGarantia and keeps warranty readonly", () => {
    const ix = getReclamarGarantiaInstruction({
      owner,
      concesionario,
      moto,
      garantia,
      reclamacion,
      nombreConcesionario: "BERA MOTORS",
      serial: "BER0DT1500BM00003",
      kilometraje: 1800n,
      descripcion: "Falla en el sistema eléctrico",
    });

    expectInstruction(
      ix,
      "reclamar_garantia",
      [ownerAddress, concesionario, moto, garantia, reclamacion, systemProgram],
      [3, 1, 1, 0, 1, 0]
    );
    expect(getReclamarGarantiaInstructionDataDecoder().decode(ix.data))
      .toMatchObject({
        nombreConcesionario: "BERA MOTORS",
        serial: "BER0DT1500BM00003",
        kilometraje: 1800n,
        descripcion: "Falla en el sistema eléctrico",
      });
  });

  it("serializes eliminarMoto with the expected writable accounts", () => {
    const ix = getEliminarMotoInstruction({
      owner,
      concesionario,
      moto,
      garantia,
      nombreConcesionario: "BERA MOTORS",
      serial: "BER0DT1500BM00003",
    });

    expectInstruction(
      ix,
      "eliminar_moto",
      [ownerAddress, concesionario, moto, garantia, systemProgram],
      [3, 1, 1, 1, 0]
    );
    expect(getEliminarMotoInstructionDataDecoder().decode(ix.data))
      .toMatchObject({
        nombreConcesionario: "BERA MOTORS",
        serial: "BER0DT1500BM00003",
      });
  });
});
