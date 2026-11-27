"use client";

import { useState, type FormEvent } from "react";
import { address, getBase64Encoder, getBase58Decoder, type Base58EncodedBytes } from "@solana/kit";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import { toast } from "sonner";
import { useAppClient } from "../../lib/client-provider";
import { notifyTransactionSuccess } from "../../lib/transaction-toast";
import { REGISTRO_PROGRAM_ADDRESS } from "../../lib/moto-ledger/src/generated/programs";
import { getMotoDecoder, getMotoDiscriminatorBytes } from "../../lib/moto-ledger/src/generated/accounts/moto";
import { getDemoMotorcycles, normalizeMotorcycleModel } from "../../lib/moto-ledger/demo-motorcycles";
import {
  deriveGarantiaPda,
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

      const demoMotorcycles = getDemoMotorcycles();

      // Inspect the complete on-chain inventory. The demo set is shared globally:
      // once a model belongs to another dealership, it must not be auto-created here.
      const discriminator = getBase58Decoder().decode(getMotoDiscriminatorBytes()) as Base58EncodedBytes;
      const onChainMotos = await client.rpc.getProgramAccounts(REGISTRO_PROGRAM_ADDRESS, {
        encoding: "base64",
        filters: [{ memcmp: { offset: 0n, bytes: discriminator, encoding: "base58" } }],
      }).send();
      const existingModels = new Map<string, string>();
      for (const item of onChainMotos) {
        const moto = getMotoDecoder().decode(getBase64Encoder().encode(item.account.data[0]));
        existingModels.set(normalizeMotorcycleModel(moto.marca, moto.modelo), moto.concesionario);
      }

      const alreadyUsedElsewhere = demoMotorcycles.filter((item) => {
        const registeredDealer = existingModels.get(normalizeMotorcycleModel(item.marca, item.modelo));
        return registeredDealer && registeredDealer !== dealerAddress;
      });
      if (alreadyUsedElsewhere.length > 0) {
        const models = alreadyUsedElsewhere.map((item) => `${item.marca} ${item.modelo}`).join(", ");
        throw new Error(
          `El catálogo de demostración ya fue utilizado en otro concesionario (${models}). Para cargar motos en este concesionario, regístralas manualmente.`
        );
      }

      for (const [index, item] of demoMotorcycles.entries()) {
        const modelKey = normalizeMotorcycleModel(item.marca, item.modelo);
        if (existingModels.get(modelKey) === dealerAddress) { skipped += 1; continue; }

        // Stable model-specific serials make repeated runs idempotent.
        const serial = `ML${item.code}${concesionario.slice(0, 11)}01`;
        const placa = `D${concesionario.slice(-4).toUpperCase()}${String(index + 1).padStart(2, "0")}`;
        const [moto] = await deriveMotoPda(serial, dealerAddress);
        const [garantia] = await deriveGarantiaPda(serial);
        const existing = await client.registro.accounts.moto.fetch(moto).catch(() => null);
        if (existing) {
          if (existing.data.concesionario !== dealerAddress) {
            failed += 1;
            toast.error(`El identificador de ${item.marca} ${item.modelo} ya está ocupado por otro concesionario.`);
          } else { skipped += 1; existingModels.add(modelKey); }
          continue;
        }

        try {
          const instruction = client.registro.instructions.registrarMoto({
            owner: connected.signer, concesionario: dealerAddress, garantia, moto, serial, placa,
            marca: item.marca, modelo: item.modelo, color: item.color,
          });
          const result = await instruction.sendTransaction();
          created += 1;
          existingModels.add(modelKey);
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
      const instruction = client.registro.instructions.registrarMoto({
        owner: connected.signer,
        concesionario: dealerAddress,
        garantia,
        moto,
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
          <p className="mt-1 text-[9px] leading-relaxed text-[#858d96]">Precarga un único catálogo de 3 motos de demostración, independiente de la marca del concesionario. Solo puede utilizarse una vez en toda la aplicación; para otros concesionarios, registra las motos manualmente.</p>
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
