"use client";

import { useState, type FormEvent } from "react";
import { address, getBase64Encoder, getBase58Decoder, type Base58EncodedBytes } from "@solana/kit";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import { toast } from "sonner";
import { useAppClient } from "../../lib/client-provider";
import { notifyTransactionSuccess } from "../../lib/transaction-toast";
import { REGISTRO_PROGRAM_ADDRESS } from "../../lib/moto-ledger/src/generated/programs";
import { getMotoDecoder, getMotoDiscriminatorBytes } from "../../lib/moto-ledger/src/generated/accounts/moto";
import { getDemoMotorcycleGroups } from "../../lib/moto-ledger/demo-motorcycles";
import {
  deriveGarantiaPda,
  deriveKilometrajeMotoPda,
  deriveMotoPda,
} from "../../lib/moto-ledger/pdas";

export function MotorcycleRegistration({
  concesionario,
  nombreConcesionario,
  onRegistered,
}: {
  concesionario: string;
  nombreConcesionario: string;
  onRegistered: () => Promise<void>;
}) {
  const client = useAppClient();
  const connected = useConnectedWallet(client);
  const [serial, setSerial] = useState("");
  const [placa, setPlaca] = useState("");
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [color, setColor] = useState("");
  const [busy, setBusy] = useState(false);
  const [preloading, setPreloading] = useState(false);

  const handlePreloadDemoMotorcycles = async () => {
    if (!connected?.signer) {
      toast.error("Conecta una wallet con capacidad de firma.");
      return;
    }
    if (busy || preloading) return;

    setPreloading(true);
    let created = 0;
    let skipped = 0;
    let failed = 0;

    try {
      const dealerAddress = address(concesionario);
      const dealer = await client.registro.accounts.concesionario.fetch(dealerAddress);
      if (
        Number(dealer.data.duracionGarantiaDias) <= 0 ||
        Number(dealer.data.kilometrajeMaximo) <= 0
      ) {
        throw new Error("Configura primero la duración y el kilometraje de la garantía del concesionario.");
      }

      const demoGroups = getDemoMotorcycleGroups();
      const demoGroupByCode = new Map<string, number>();
      demoGroups.forEach((group, groupIndex) => {
        group.forEach((item) => demoGroupByCode.set(item.code, groupIndex));
      });

      // Detect every demo model on Devnet by its reserved serial prefix.
      // Other Devnet owners never consume a group for this wallet.
      const discriminator = getBase58Decoder().decode(getMotoDiscriminatorBytes()) as Base58EncodedBytes;
      const onChainMotos = await client.rpc.getProgramAccounts(REGISTRO_PROGRAM_ADDRESS, {
        encoding: "base64",
        filters: [{ memcmp: { offset: 0n, bytes: discriminator, encoding: "base58" } }],
      }).send();
      const decodedMotos = onChainMotos.map((item) =>
        getMotoDecoder().decode(getBase64Encoder().encode(item.account.data[0]))
      );
      const demoSerialPrefixes = [...demoGroupByCode.keys()].map((code) => `ML${code}`);
      const demoMotos = decodedMotos.filter((moto) =>
        demoSerialPrefixes.some((prefix) => moto.serial.startsWith(prefix))
      );

      const otherDemoDealerships = [...new Set(
        demoMotos
          .map((moto) => moto.concesionario)
          .filter((registeredDealer) => registeredDealer !== dealerAddress)
      )];
      const ownedDealerships = new Set<string>([dealerAddress]);
      await Promise.all(
        otherDemoDealerships.map(async (registeredDealer) => {
          try {
            const account = await client.registro.accounts.concesionario.fetch(address(registeredDealer));
            if (account.data.owner === connected.account.address) {
              ownedDealerships.add(registeredDealer);
            }
          } catch {
            // Ignore unrelated or no-longer-readable dealership records.
          }
        })
      );

      const usedGroups = new Set<number>();
      const currentDealerGroups = new Set<number>();
      for (const moto of demoMotos) {
        const code = [...demoGroupByCode.keys()].find((candidate) =>
          moto.serial.startsWith(`ML${candidate}`)
        );
        if (!code) continue;
        const groupIndex = demoGroupByCode.get(code);
        if (groupIndex === undefined) continue;
        if (moto.concesionario === dealerAddress) {
          currentDealerGroups.add(groupIndex);
        } else if (ownedDealerships.has(moto.concesionario)) {
          usedGroups.add(groupIndex);
        }
      }

      if (currentDealerGroups.size > 1) {
        throw new Error("Este concesionario contiene motos de varios grupos de demostración. Revisa el inventario antes de volver a precargar.");
      }

      const selectedGroupIndex = currentDealerGroups.size === 1
        ? [...currentDealerGroups][0]
        : demoGroups.findIndex((_, groupIndex) => !usedGroups.has(groupIndex));

      if (selectedGroupIndex < 0) {
        throw new Error("Ya se utilizaron los cuatro grupos de demostración en otros concesionarios de esta wallet. Registra las motos manualmente.");
      }

      const selectedGroup = demoGroups[selectedGroupIndex];
      toast.info(`Grupo de demostración ${selectedGroupIndex + 1} de ${demoGroups.length}: ${selectedGroup.map((item) => item.marca + " " + item.modelo).join(", ")}.`);

      for (const [index, item] of selectedGroup.entries()) {
        // Stable model-specific serials make repeated runs idempotent.
        const serial = `ML${item.code}${concesionario.slice(0, 10)}01`;
        if (new TextEncoder().encode(serial).length !== 17) {
          throw new Error(`El serial de demostración para ${item.marca} ${item.modelo} no tiene exactamente 17 bytes.`);
        }
        const placa = `D${concesionario.slice(-4).toUpperCase()}${String(index + 1).padStart(2, "0")}`;
        const [moto] = await deriveMotoPda(serial, dealerAddress);
        const [garantia] = await deriveGarantiaPda(serial);
        const [kilometrajeMoto] = await deriveKilometrajeMotoPda(moto);
        const existing = await client.registro.accounts.moto.fetch(moto).catch(() => null);
        if (existing) {
          if (
            existing.data.concesionario === dealerAddress &&
            existing.data.serial === serial
          ) {
            skipped += 1;
          } else {
            failed += 1;
            toast.error(`La PDA calculada para ${item.marca} ${item.modelo} ya está ocupada por un registro distinto. No se omitirá silenciosamente.`);
          }
          continue;
        }

        try {
          const instruction = client.registro.instructions.registrarMoto({
            owner: connected.signer, concesionario: dealerAddress, garantia, moto, kilometrajeMoto, serial, placa,
            marca: item.marca, modelo: item.modelo, color: item.color,
          });
          const result = await instruction.sendTransaction();
          created += 1;
          notifyTransactionSuccess(`${item.marca} ${item.modelo} precargada (${item.transmision.toLowerCase()}).`, result.context.signature);
        } catch (error) {
          failed += 1;
          console.error(`No se pudo precargar ${item.marca} ${item.modelo}:`, error);
          toast.error(`No se pudo registrar ${item.marca} ${item.modelo}. Puedes reintentar; las unidades ya creadas se omitirán.`);
        }
      }
      await onRegistered();
      if (failed === 0) {
        toast.success(`Precarga finalizada: ${created} creada(s), ${skipped} ya existente(s).`);
      } else {
        toast.warning(`Precarga parcial: ${created} creada(s), ${skipped} existente(s), ${failed} con error.`);
      }
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "No se pudo precargar el inventario.");
    } finally {
      setPreloading(false);
    }
  };


  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!connected?.signer) {
      toast.error("Conecta una wallet con capacidad de firma.");
      return;
    }
    if (serial.trim().length !== 17) {
      toast.error("El serial N.I.V. debe tener exactamente 17 caracteres.");
      return;
    }
    if (placa.trim().length !== 7) {
      toast.error("La placa debe tener exactamente 7 caracteres.");
      return;
    }

    setBusy(true);
    try {
      const dealerAddress = address(concesionario);
      const [moto] = await deriveMotoPda(serial.trim(), dealerAddress);
      const [garantia] = await deriveGarantiaPda(serial.trim());
      const [kilometrajeMoto] = await deriveKilometrajeMotoPda(moto);
      const instruction = client.registro.instructions.registrarMoto({
        owner: connected.signer,
        concesionario: dealerAddress,
        garantia,
        moto,
        kilometrajeMoto,
        serial: serial.trim(),
        placa: placa.trim().toUpperCase(),
        marca: marca.trim(),
        modelo: modelo.trim(),
        color: color.trim(),
      });
      const result = await instruction.sendTransaction();
      notifyTransactionSuccess(
        "Moto y garantía creadas en una sola transacción.",
        result.context.signature
      );
      await onRegistered();
      setSerial("");
      setPlaca("");
      setMarca("");
      setModelo("");
      setColor("");
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo registrar la moto."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-[#e9ebee] bg-white p-6 shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">INVENTARIO</p>
          <h2 className="mt-2 text-[15px] font-bold text-[#252a30]">Registrar moto</h2>
          <p className="mt-1 text-[10px] text-[#858d96]">Cada unidad tendrá una cuenta propia y su garantía asociada.</p>
        </div>
        <span className="rounded-md bg-[#f4f5f6] px-2 py-1 text-[9px] font-bold text-[#737b84]">N.I.V. + PDA</span>
      </div>

      <div className="mt-4 flex flex-col gap-2 rounded-lg border border-dashed border-[#e2e5e8] bg-[#fafbfc] p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold text-[#424950]">¿Necesitas inventario de prueba?</p>
          <p className="mt-1 text-[9px] leading-relaxed text-[#858d96]">Hay 4 grupos de demostración con 3 motos cada uno. Cada concesionario de la misma wallet recibe automáticamente un grupo distinto; los registros de otros usuarios de Devnet no afectan la asignación.</p>
        </div>
        <button
          type="button"
          onClick={() => void handlePreloadDemoMotorcycles()}
          disabled={busy || preloading}
          className="shrink-0 rounded-lg border border-[#e60012] bg-white px-3 py-2 text-[10px] font-semibold text-[#d90011] transition hover:bg-[#fff0f1] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {preloading ? "Precargando inventario…" : "Precargar 3 motos"}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <label className="sm:col-span-2 xl:col-span-3">
          <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Serial N.I.V. (17 caracteres)</span>
          <input value={serial} onChange={(e) => setSerial(e.target.value.toUpperCase())} minLength={17} maxLength={17} required placeholder="1HGBH41JXMN109186" className="w-full rounded-lg border border-[#e2e5e8] px-3 py-2.5 font-mono text-[11px] uppercase tracking-wide outline-none focus:border-[#e60012]" />
        </label>
        <label>
          <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Placa (7 caracteres)</span>
          <input value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} minLength={7} maxLength={7} required placeholder="AB123CD" className="w-full rounded-lg border border-[#e2e5e8] px-3 py-2.5 text-[11px] uppercase outline-none focus:border-[#e60012]" />
        </label>
        <label>
          <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Marca</span>
          <input value={marca} onChange={(e) => setMarca(e.target.value)} required placeholder="Honda" className="w-full rounded-lg border border-[#e2e5e8] px-3 py-2.5 text-[11px] outline-none focus:border-[#e60012]" />
        </label>
        <label>
          <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Modelo</span>
          <input value={modelo} onChange={(e) => setModelo(e.target.value)} required placeholder="XR 150L" className="w-full rounded-lg border border-[#e2e5e8] px-3 py-2.5 text-[11px] outline-none focus:border-[#e60012]" />
        </label>
        <label>
          <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Color</span>
          <input value={color} onChange={(e) => setColor(e.target.value)} required placeholder="Rojo" className="w-full rounded-lg border border-[#e2e5e8] px-3 py-2.5 text-[11px] outline-none focus:border-[#e60012]" />
        </label>
        <div className="flex items-end sm:col-span-2 xl:col-span-3">
          <button type="submit" disabled={busy || preloading} className="w-full rounded-lg bg-[#e60012] px-4 py-2.5 text-[11px] font-semibold text-white transition hover:bg-[#c90010] disabled:opacity-50 sm:w-auto">
            {busy ? "Registrando moto en Solana…" : "Registrar moto"}
          </button>
        </div>
      </form>
      <p className="mt-3 text-[9px] leading-relaxed text-[#9aa1a9]">La transacción inicializa la cuenta de la moto y la cuenta de garantía con la duración y kilometraje configurados actualmente para este concesionario.</p>
    </section>
  );
}
