import { address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  deriveClientePda,
  deriveConcesionarioPda,
  deriveGarantiaPda,
  deriveMotoPda,
  deriveProgramaFidelidadPda,
  deriveAutoridadFidelidadPda,
  deriveWalletClientePda,
  derivePuntosVentaPda,
  deriveToken2022Ata,
  deriveRegistroGlobalPda,
  deriveServicioPda,
  deriveVentaPda,
} from "../../app/lib/moto-ledger/pdas";
import { REGISTRO_PROGRAM_ADDRESS } from "../../app/lib/moto-ledger/src/generated/programs";

// Fixtures deterministas. Las direcciones esperadas son vectores conocidos
// calculados independientemente de las funciones derive* que se prueban.
const owner = address("CCF4CnM99mXSxz2sFffxT4A4CZxpWNsKNPbwueJThGMo");
const anotherOwner = address("11111111111111111111111111111111");
const dealership = address("7n7tA4N999UpXc6vfV7odSVek4JydyMEfUZNdGsbsc7o");
const motorcycle = address("247Qs9cEC8Lyn9z76sHC9EBPCWNtiQULvDkYt2p58mer");

describe("MotoLedger PDA derivation", () => {
  it("uses the expected deployed program address", () => {
    expect(REGISTRO_PROGRAM_ADDRESS).toBe(
      "64dHKqRTBciEidqLJqCvTWEGWkR1QqyYDZgomMt9AWCj"
    );
  });

  it("derives the global registry PDA from the Rust seed", async () => {
    await expect(deriveRegistroGlobalPda()).resolves.toEqual([
      "6bJpY3vCPb8giM8WwhfsiDgKbaY77AASzy4PxScTLhAo",
      254,
    ]);
  });

  it("derives the dealership PDA from name and owner seeds", async () => {
    await expect(deriveConcesionarioPda("BERA MOTORS", owner)).resolves.toEqual([
      "7n7tA4N999UpXc6vfV7odSVek4JydyMEfUZNdGsbsc7o",
      255,
    ]);
    await expect(
      deriveConcesionarioPda("BERA MOTORS", anotherOwner)
    ).resolves.not.toEqual([
      "7n7tA4N999UpXc6vfV7odSVek4JydyMEfUZNdGsbsc7o",
      255,
    ]);
  });

  it("derives the motorcycle PDA from the serial and dealership", async () => {
    await expect(
      deriveMotoPda("BER0DT1500BM00003", dealership)
    ).resolves.toEqual([
      "247Qs9cEC8Lyn9z76sHC9EBPCWNtiQULvDkYt2p58mer",
      253,
    ]);
  });

  it("derives the customer PDA using a little-endian u32 identity seed", async () => {
    await expect(deriveClientePda(owner, 12345678)).resolves.toEqual([
      "Bkqenztc4YScJr1GNLEnUQxsHZE6pwhfH1ScKZCwiGte",
      254,
    ]);
  });

  it("derives the sale PDA from the motorcycle address", async () => {
    await expect(deriveVentaPda(motorcycle)).resolves.toEqual([
      "AdfybrUm7UX2ZTkJRo9NQLGWooGywtf9RKEegaMwAWp",
      252,
    ]);
  });

  it("derives the warranty PDA from the serial", async () => {
    await expect(deriveGarantiaPda("BER0DT1500BM00003")).resolves.toEqual([
      "ArixyEXxhaePfLFw8XxvsY5wUYPGLZUSKpH4SsZuBKHP",
      253,
    ]);
  });

  it("derives sequential service PDAs using a little-endian u64 counter", async () => {
    await expect(deriveServicioPda(motorcycle, 0n)).resolves.toEqual([
      "66VbHcx43C94XVASUtzM6mxy2nwbpPMdwBBLejZ9uNEt",
      254,
    ]);
    await expect(deriveServicioPda(motorcycle, 1n)).resolves.toEqual([
      "LU16b9JNWweojQfLUmNEJNrYvFY8tVnMYRscG1SZxJs",
      255,
    ]);
  });

  it("derives loyalty configuration and mint authority PDAs from Rust seeds", async () => {
    const [programaFidelidad] = await deriveProgramaFidelidadPda(dealership);
    const [autoridadFidelidad] = await deriveAutoridadFidelidadPda(dealership);

    expect(programaFidelidad).toBeTruthy();
    expect(autoridadFidelidad).toBeTruthy();
    expect(programaFidelidad).not.toBe(autoridadFidelidad);
    await expect(deriveProgramaFidelidadPda(dealership)).resolves.toEqual([
      programaFidelidad,
      expect.any(Number),
    ]);
  });

  it("derives customer wallet and per-sale reward PDAs", async () => {
    const [walletCliente] = await deriveWalletClientePda(owner);
    const [puntosVenta] = await derivePuntosVentaPda(motorcycle);

    expect(walletCliente).toBeTruthy();
    expect(puntosVenta).toBeTruthy();
    expect(walletCliente).not.toBe(puntosVenta);
  });

  it("derives the loyalty ATA with the Token-2022 program", async () => {
    const mint = address("So11111111111111111111111111111111111111112");
    const first = await deriveToken2022Ata(owner, mint);
    const second = await deriveToken2022Ata(owner, mint);

    expect(first).toEqual(second);
    expect(first[0]).toBeTruthy();
  });

});
