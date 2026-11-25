"use client";

import { useEffect, useState, type FormEvent } from "react";
import { address } from "@solana/kit";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import { toast } from "sonner";
import { useAppClient } from "../../lib/client-provider";
import { notifyTransactionSuccess } from "../../lib/transaction-toast";
import type { Concesionario } from "../../lib/moto-ledger/generated/src/generated/accounts/concesionario";

const U64_MAX = 18_446_744_073_709_551_615n;

export function SettingsManagement({
  concesionario,
  data,
  onUpdated,
}: {
  concesionario: string;
  data: Concesionario;
  onUpdated: () => Promise<void>;
}) {
  const client = useAppClient();
  const connected = useConnectedWallet(client);
  const [duration, setDuration] = useState(String(data.duracionGarantiaDias));
  const [maxMileage, setMaxMileage] = useState(data.kilometrajeMaximo.toString());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDuration(String(data.duracionGarantiaDias));
    setMaxMileage(data.kilometrajeMaximo.toString());
  }, [concesionario, data.duracionGarantiaDias, data.kilometrajeMaximo]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!connected?.signer) {
      toast.error("Conecta una wallet con capacidad de firma.");
      return;
    }

    const days = Number(duration);
    let mileage: bigint;
    try {
      if (!Number.isInteger(days) || days < 1 || days > 65_535) {
        throw new Error("La duración debe ser un número entero entre 1 y 65.535 días.");
      }
      if (!/^\d+$/.test(maxMileage.trim())) {
        throw new Error("El kilometraje máximo debe ser un entero positivo.");
      }
      mileage = BigInt(maxMileage);
      if (mileage < 1n || mileage > U64_MAX) {
        throw new Error("El kilometraje máximo debe estar entre 1 y el límite u64.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Revisa los valores de garantía.");
      return;
    }

    if (
      days === data.duracionGarantiaDias &&
      mileage === data.kilometrajeMaximo
    ) {
      toast.info("No hay cambios para guardar.");
      return;
    }

    setBusy(true);
    try {
      const latest = await client.registro.accounts.concesionario.fetch(
        address(concesionario)
      );
      if (latest.data.owner !== connected.account.address) {
        throw new Error("La wallet conectada no es propietaria de este concesionario.");
      }

      const instruction = client.registro.instructions.configurarGarantia({
        owner: connected.signer,
        concesionario: address(concesionario),
        nombreConcesionario: latest.data.nombreConcesionario,
        duracionGarantiaDias: days,
        kilometrajeMaximo: mileage,
      });
      const result = await instruction.sendTransaction();
      notifyTransactionSuccess(
        "Política de garantía actualizada en Solana.",
        result.context.signature
      );
      await onUpdated();
    } catch (error) {
      console.error("No se pudo actualizar la configuración:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar la política de garantía."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[#e9ebee] bg-white p-6 shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">SISTEMA / CONFIGURACIÓN</p>
            <h2 className="mt-2 text-[15px] font-bold text-[#252a30]">Datos del concesionario</h2>
            <p className="mt-1 text-[10px] text-[#858d96]">Identidad y parámetros almacenados en la cuenta on-chain.</p>
          </div>
          <span className="rounded-md bg-[#edf8f2] px-2.5 py-1.5 text-[9px] font-bold text-[#168451]">SINCRONIZADO</span>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[#eff0f2] p-4">
            <p className="text-[9px] font-bold tracking-wide text-[#9299a1]">NOMBRE COMERCIAL</p>
            <p className="mt-2 text-[13px] font-bold text-[#252a30]">{data.nombreConcesionario}</p>
          </div>
          <div className="rounded-lg border border-[#eff0f2] p-4">
            <p className="text-[9px] font-bold tracking-wide text-[#9299a1]">RIF</p>
            <p className="mt-2 text-[13px] font-bold text-[#252a30]">{data.rifConcesionario}</p>
          </div>
          <div className="rounded-lg border border-[#eff0f2] p-4 sm:col-span-2">
            <p className="text-[9px] font-bold tracking-wide text-[#9299a1]">PROPIETARIO (WALLET)</p>
            <a href={`https://explorer.solana.com/address/${data.owner}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="mt-2 block break-all font-mono text-[10px] text-[#68717b] underline decoration-dotted underline-offset-2 hover:text-[#e60012]">{data.owner} ↗</a>
          </div>
          <div className="rounded-lg border border-[#eff0f2] p-4 sm:col-span-2">
            <p className="text-[9px] font-bold tracking-wide text-[#9299a1]">CUENTA DEL CONCESIONARIO (PDA)</p>
            <a href={`https://explorer.solana.com/address/${concesionario}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="mt-2 block break-all font-mono text-[10px] text-[#68717b] underline decoration-dotted underline-offset-2 hover:text-[#e60012]">{concesionario} ↗</a>
          </div>
        </div>
        <p className="mt-4 text-[9px] leading-relaxed text-[#9299a1]">El nombre, el RIF y el propietario se muestran como datos de identidad. El programa actual no incluye una instrucción para modificarlos desde el dashboard.</p>
      </section>

      <section className="rounded-xl border border-[#e9ebee] bg-white p-6 shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
        <div>
          <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">POLÍTICA DE POSVENTA</p>
          <h2 className="mt-2 text-[15px] font-bold text-[#252a30]">Configuración de garantía</h2>
          <p className="mt-1 text-[10px] text-[#858d96]">Define la cobertura que se aplicará a las próximas motos que registres.</p>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Duración de garantía</span>
              <div className="relative">
                <input type="number" min={1} max={65535} step={1} value={duration} onChange={(event) => setDuration(event.target.value)} disabled={busy} required className="w-full rounded-lg border border-[#e2e5e8] px-3 py-3 pr-16 text-[12px] outline-none focus:border-[#e60012] disabled:bg-[#f7f8fa]" />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#9299a1]">días</span>
              </div>
              <span className="mt-1 block text-[9px] text-[#a0a6ad]">Entero entre 1 y 65.535 días.</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Kilometraje máximo cubierto</span>
              <div className="relative">
                <input type="number" min={1} step={1} value={maxMileage} onChange={(event) => setMaxMileage(event.target.value)} disabled={busy} required className="w-full rounded-lg border border-[#e2e5e8] px-3 py-3 pr-14 text-[12px] outline-none focus:border-[#e60012] disabled:bg-[#f7f8fa]" />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#9299a1]">km</span>
              </div>
              <span className="mt-1 block text-[9px] text-[#a0a6ad]">Número entero positivo, sin decimales.</span>
            </label>
          </div>

          <div className="rounded-lg border border-[#f1dfe0] bg-[#fff9f9] p-4">
            <p className="text-[10px] font-bold text-[#8e343b]">Importante sobre las garantías existentes</p>
            <p className="mt-1 text-[9px] leading-relaxed text-[#95666a]">Esta configuración actualiza los parámetros del concesionario. No modifica retroactivamente las cuentas de garantía que ya fueron creadas para motos registradas anteriormente.</p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#eff0f2] pt-4">
            <p className="text-[9px] text-[#9299a1]">Los cambios requieren firma y confirmación on-chain.</p>
            <button type="submit" disabled={busy} className="rounded-lg bg-[#e60012] px-4 py-2.5 text-[10px] font-semibold text-white transition hover:bg-[#c90010] disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Actualizando en Solana…" : "Guardar configuración"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
