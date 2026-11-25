"use client";

import { useCallback, useEffect, useState } from "react";
import {
  address,
  getBase64Encoder,
  getBase58Decoder,
  type Address,
  type Base58EncodedBytes,
} from "@solana/kit";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import { toast } from "sonner";
import { useAppClient } from "../../lib/client-provider";
import { REGISTRO_PROGRAM_ADDRESS } from "../../lib/moto-ledger/generated/src/generated/programs";
import { notifyTransactionSuccess } from "../../lib/transaction-toast";
import { deriveGarantiaPda } from "../../lib/moto-ledger/pdas";
import {
  getMotoDecoder,
  getMotoDiscriminatorBytes,
  type Moto,
} from "../../lib/moto-ledger/generated/src/generated/accounts/moto";

type MotorcycleRecord = { address: Address; data: Moto };

export function MotorcycleCatalog({
  concesionario,
  nombreConcesionario,
  onDeleted,
  refreshKey,
}: {
  concesionario: string;
  nombreConcesionario: string;
  onDeleted: () => Promise<void>;
  refreshKey: number;
}) {
  const client = useAppClient();
  const connected = useConnectedWallet(client);
  const [motorcycles, setMotorcycles] = useState<MotorcycleRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [motorcycleToDelete, setMotorcycleToDelete] = useState<MotorcycleRecord | null>(null);

  const loadMotorcycles = useCallback(async () => {
    setLoading(true);
    try {
      const discriminator = getBase58Decoder().decode(
        getMotoDiscriminatorBytes()
      ) as Base58EncodedBytes;
      const results = await client.rpc
        .getProgramAccounts(
          REGISTRO_PROGRAM_ADDRESS,
          {
            encoding: "base64",
            filters: [
              {
                memcmp: {
                  offset: 0n,
                  bytes: discriminator,
                  encoding: "base58",
                },
              },
            ],
          }
        )
        .send();

      const records = results
        .map((item) => ({
          address: address(item.pubkey),
          data: getMotoDecoder().decode(
            getBase64Encoder().encode(item.account.data[0])
          ),
        }))
        .filter((item) => item.data.concesionario === concesionario)
        .sort((a, b) => a.data.serial.localeCompare(b.data.serial));

      setMotorcycles(records);
    } catch (error) {
      console.error("No se pudo cargar el catálogo:", error);
      toast.error("No se pudo consultar el catálogo de motos.");
    } finally {
      setLoading(false);
    }
  }, [client, concesionario]);

  useEffect(() => {
    void loadMotorcycles();
  }, [loadMotorcycles, refreshKey]);

  const handleDelete = async (motorcycle: MotorcycleRecord) => {
    if (!connected?.signer) {
      toast.error("Conecta una wallet con capacidad de firma.");
      return;
    }

    if (
      motorcycle.data.vendida ||
      motorcycle.data.servicios > 0n ||
      motorcycle.data.totalReclamaciones > 0n
    ) {
      toast.error("Esta moto tiene un historial que debe conservarse.");
      return;
    }

    setDeleting(motorcycle.address);
    try {
      const [garantia] = await deriveGarantiaPda(motorcycle.data.serial);
      const latestMoto = await client.registro.accounts.moto.fetch(
        motorcycle.address
      );

      if (
        latestMoto.data.concesionario !== concesionario ||
        latestMoto.data.vendida ||
        latestMoto.data.servicios > 0n ||
        latestMoto.data.totalReclamaciones > 0n
      ) {
        throw new Error(
          "La moto cambió de estado y ya no cumple las condiciones para eliminarse."
        );
      }

      const instruction = client.registro.instructions.eliminarMoto({
        owner: connected.signer,
        concesionario: address(concesionario),
        moto: motorcycle.address,
        garantia,
        nombreConcesionario,
        serial: latestMoto.data.serial,
      });
      const result = await instruction.sendTransaction();

      notifyTransactionSuccess(
        "Moto y garantía eliminadas del catálogo.",
        result.context.signature
      );

      // Retira la unidad de la vista inmediatamente después de confirmar la transacción.
      setMotorcycles((current) =>
        current.filter((item) => item.address !== motorcycle.address)
      );
      setMotorcycleToDelete(null);

      // Sincroniza el catálogo y los contadores con el estado actualizado en Solana.
      await Promise.all([loadMotorcycles(), onDeleted()]);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo eliminar la moto."
      );
    } finally {
      setDeleting(null);
    }
  };

  const eligibleCount = motorcycles.filter(
    ({ data }) =>
      !data.vendida &&
      data.servicios === 0n &&
      data.totalReclamaciones === 0n
  ).length;

  return (
    <>
      <section className="rounded-xl border border-[#e9ebee] bg-white p-6 shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">
            CATÁLOGO DEL CONCESIONARIO
          </p>
          <h2 className="mt-2 text-[15px] font-bold text-[#252a30]">
            Inventario de motos
          </h2>
          <p className="mt-1 text-[10px] text-[#858d96]">
            Consulta las unidades registradas y elimina únicamente las que no tengan historial.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadMotorcycles()}
          disabled={loading || deleting !== null}
          className="rounded-lg border border-[#e2e5e8] px-3 py-2 text-[10px] font-semibold text-[#555e68] hover:bg-[#f7f8fa] disabled:opacity-50"
        >
          {loading ? "Actualizando…" : "Actualizar catálogo"}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-[9px]">
        <span className="rounded-md bg-[#f4f5f6] px-2.5 py-1.5 font-semibold text-[#68717b]">
          {motorcycles.length} unidad(es)
        </span>
        <span className="rounded-md bg-[#edf8f2] px-2.5 py-1.5 font-semibold text-[#168451]">
          {eligibleCount} elegible(s) para eliminar
        </span>
      </div>

      {loading && motorcycles.length === 0 ? (
        <p className="mt-5 rounded-lg bg-[#f7f8fa] p-5 text-center text-[11px] text-[#858d96]">
          Consultando inventario en Solana…
        </p>
      ) : motorcycles.length === 0 ? (
        <p className="mt-5 rounded-lg bg-[#f7f8fa] p-5 text-center text-[11px] text-[#858d96]">
          Este concesionario todavía no tiene motos registradas.
        </p>
      ) : (
        <div className="mt-4 divide-y divide-[#eff0f2]">
          {motorcycles.map((motorcycle) => {
            const { data } = motorcycle;
            const canDelete =
              !data.vendida &&
              data.servicios === 0n &&
              data.totalReclamaciones === 0n;
            const reason = data.vendida
              ? "Vendida · registro protegido"
              : data.servicios > 0n || data.totalReclamaciones > 0n
                ? "Tiene historial de posventa"
                : "Disponible para eliminación";

            return (
              <div
                key={motorcycle.address}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[11px] font-bold text-[#30363d]">
                      {data.marca} {data.modelo}
                    </p>
                    <span
                      className={`rounded px-2 py-0.5 text-[8px] font-bold ${canDelete ? "bg-[#edf8f2] text-[#168451]" : "bg-[#f4f5f6] text-[#737b84]"}`}
                    >
                      {reason}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[9px] text-[#858d96]">
                    {data.serial} · {data.placa} · {data.color}
                  </p>
                  <p className="mt-1 text-[9px] text-[#a0a6ad]">
                    {data.servicios.toString()} servicio(s) · {data.totalReclamaciones.toString()} reclamación(es)
                  </p>
                  <a
                    href={`https://explorer.solana.com/address/${motorcycle.address}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex max-w-full flex-wrap items-center gap-1 font-mono text-[9px] text-[#68717b] underline decoration-dotted underline-offset-2 transition hover:text-[#e60012]"
                    title="Ver cuenta de la moto en Solana Explorer (Devnet)"
                  >
                    <span className="font-sans font-semibold no-underline">PDA:</span>
                    <span className="break-all">{motorcycle.address}</span>
                    <span aria-hidden="true">↗</span>
                  </a>
                </div>
                <button
                  type="button"
                  onClick={() => setMotorcycleToDelete(motorcycle)}
                  disabled={!canDelete || deleting !== null}
                  className="shrink-0 rounded-lg border border-[#f0c8cc] px-3 py-2 text-[10px] font-semibold text-[#d90011] transition hover:bg-[#fff0f1] disabled:cursor-not-allowed disabled:border-[#e9ebee] disabled:text-[#b0b5bb] disabled:hover:bg-white"
                >
                  {deleting === motorcycle.address
                    ? "Eliminando…"
                    : "Eliminar moto"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-3 border-t border-[#eff0f2] pt-3 text-[9px] leading-relaxed text-[#9aa1a9]">
        Las motos vendidas o con servicios/reclamaciones no se pueden eliminar. El programa también valida estas condiciones on-chain y devuelve al owner los fondos de renta de las cuentas cerradas.
      </p>
    </section>

      {motorcycleToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#171b20]/55 p-4 backdrop-blur-[2px]"
          onClick={() => deleting === null && setMotorcycleToDelete(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-motorcycle-title"
            onClick={(event) => event.stopPropagation()}
            className="my-auto w-full max-w-md overflow-hidden rounded-2xl border border-[#e9ebee] bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-[#eff0f2] px-6 py-5">
              <div>
                <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">GESTIÓN DE INVENTARIO</p>
                <h2 id="delete-motorcycle-title" className="mt-1 text-[17px] font-bold text-[#252a30]">Eliminar moto</h2>
                <p className="mt-1 text-[10px] text-[#858d96]">Confirma que deseas retirar esta unidad del catálogo.</p>
              </div>
              <button type="button" onClick={() => setMotorcycleToDelete(null)} disabled={deleting !== null} aria-label="Cerrar confirmación" className="rounded-lg border border-[#e2e5e8] px-3 py-1.5 text-[12px] text-[#68717b] hover:bg-[#f7f8fa] disabled:opacity-40">✕</button>
            </div>
            <div className="space-y-4 p-6">
              <div className="rounded-xl border border-[#f2d5d7] bg-[#fff8f8] p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#fdebed] text-[17px] text-[#d90011]">!</span>
                  <div className="min-w-0">
                    <p className="text-[12px] font-bold text-[#30363d]">{motorcycleToDelete.data.marca} {motorcycleToDelete.data.modelo}</p>
                    <p className="mt-1 font-mono text-[10px] text-[#68717b]">{motorcycleToDelete.data.serial}</p>
                    <p className="mt-0.5 text-[10px] text-[#858d96]">Placa: <strong className="text-[#424950]">{motorcycleToDelete.data.placa}</strong><span className="mx-2">·</span>Color: <strong className="text-[#424950]">{motorcycleToDelete.data.color}</strong></p>
                  </div>
                </div>
              </div>
              <div className="space-y-2 text-[10px] leading-relaxed text-[#68717b]">
                <p>Se cerrarán las cuentas on-chain de la moto y su garantía.</p>
                <p className="font-semibold text-[#a33d45]">Esta operación no se puede deshacer. Los fondos recuperables de las cuentas cerradas se devolverán al propietario.</p>
              </div>
              <div className="flex flex-col-reverse gap-2 border-t border-[#eff0f2] pt-4 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setMotorcycleToDelete(null)} disabled={deleting !== null} className="rounded-lg border border-[#e2e5e8] px-4 py-2.5 text-[10px] font-semibold text-[#555e68] transition hover:bg-[#f7f8fa] disabled:opacity-50">Cancelar</button>
                <button type="button" onClick={() => { const selected = motorcycleToDelete; setMotorcycleToDelete(null); if (selected) void handleDelete(selected); }} disabled={deleting !== null} className="rounded-lg bg-[#e60012] px-4 py-2.5 text-[10px] font-semibold text-white transition hover:bg-[#c90010] disabled:cursor-not-allowed disabled:opacity-50">{deleting ? "Eliminando…" : "Sí, eliminar moto"}</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
