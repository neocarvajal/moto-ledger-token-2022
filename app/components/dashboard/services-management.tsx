"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  address,
  getBase58Decoder,
  getBase64Encoder,
  type Base58EncodedBytes,
} from "@solana/kit";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import { toast } from "sonner";
import { useAppClient } from "../../lib/client-provider";
import { notifyTransactionSuccess } from "../../lib/transaction-toast";
import {
  deriveGarantiaPda,
  deriveServicioPda,
} from "../../lib/moto-ledger/pdas";
import { REGISTRO_PROGRAM_ADDRESS } from "../../lib/moto-ledger/src/generated/programs";
import {
  getMotoDecoder,
  getMotoDiscriminatorBytes,
  type Moto,
} from "../../lib/moto-ledger/src/generated/accounts/moto";
import {
  getServicioDecoder,
  getServicioDiscriminatorBytes,
  type Servicio,
} from "../../lib/moto-ledger/src/generated/accounts/servicio";
import { TipoServicio } from "../../lib/moto-ledger/src/generated/types/tipoServicio";
import { EstadoGarantia } from "../../lib/moto-ledger/src/generated/types/estadoGarantia";

type MotorcycleRecord = { address: string; data: Moto };
type ServiceRecord = { address: string; data: Servicio; motorcycle?: Moto };

const serviceLabels: Record<TipoServicio, string> = {
  [TipoServicio.Mantenimiento]: "Mantenimiento",
  [TipoServicio.Reparacion]: "Reparación",
  [TipoServicio.Garantia]: "Garantía",
};

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-5)}`;
}

function formatAmount(value: bigint) {
  return value.toLocaleString("es-VE");
}

function parseUnsigned(value: string, label: string, allowZero = true) {
  const normalized = value.trim();
  if (!/^[0-9]+$/.test(normalized)) throw new Error(`Introduce un valor válido para ${label.toLowerCase()}.`);
  const parsed = BigInt(normalized);
  if (!allowZero && parsed === 0n) throw new Error(`${label} debe ser mayor que cero.`);
  if (parsed > 18446744073709551615n) throw new Error(`${label} supera el máximo permitido.`);
  return parsed;
}

export function ServicesManagement({
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
  const [motorcycles, setMotorcycles] = useState<MotorcycleRecord[]>([]);
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [selectedMoto, setSelectedMoto] = useState("");
  const [mileage, setMileage] = useState("");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("");
  const [serviceType, setServiceType] = useState<TipoServicio | "">("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<ServiceRecord | null>(null);

  const soldMotorcycles = useMemo(
    () => motorcycles.filter((item) => item.data.vendida),
    [motorcycles]
  );

  const selectedMotorcycle = useMemo(
    () => soldMotorcycles.find((item) => item.address === selectedMoto) ?? null,
    [soldMotorcycles, selectedMoto]
  );

  const loadData = useCallback(async () => {
    if (!concesionario) return;
    setLoading(true);
    try {
      const dealerAddress = address(concesionario);
      const motoDiscriminator = getBase58Decoder().decode(
        getMotoDiscriminatorBytes()
      ) as Base58EncodedBytes;
      const serviceDiscriminator = getBase58Decoder().decode(
        getServicioDiscriminatorBytes()
      ) as Base58EncodedBytes;

      const [motoResults, serviceResults] = await Promise.all([
        client.rpc.getProgramAccounts(REGISTRO_PROGRAM_ADDRESS, {
          encoding: "base64",
          filters: [
            { memcmp: { offset: 0n, bytes: motoDiscriminator, encoding: "base58" } },
          ],
        }).send(),
        client.rpc.getProgramAccounts(REGISTRO_PROGRAM_ADDRESS, {
          encoding: "base64",
          filters: [
            { memcmp: { offset: 0n, bytes: serviceDiscriminator, encoding: "base58" } },
            { memcmp: { offset: 8n, bytes: dealerAddress as Base58EncodedBytes, encoding: "base58" } },
          ],
        }).send(),
      ]);

      const motoRecords: MotorcycleRecord[] = motoResults
        .map((item) => ({
          address: item.pubkey,
          data: getMotoDecoder().decode(getBase64Encoder().encode(item.account.data[0])),
        }))
        .filter((item) => item.data.concesionario === concesionario)
        .sort((a, b) => a.data.serial.localeCompare(b.data.serial));

      const motoByAddress = new Map(motoRecords.map((item) => [item.address, item.data]));
      const serviceRecords: ServiceRecord[] = serviceResults
        .map((item) => ({
          address: item.pubkey,
          data: getServicioDecoder().decode(getBase64Encoder().encode(item.account.data[0])),
        }))
        .map((item) => ({ ...item, motorcycle: motoByAddress.get(item.data.moto) }))
        .sort((a, b) => Number(b.data.fechaServicio - a.data.fechaServicio));

      setMotorcycles(motoRecords);
      setServices(serviceRecords);
      setSelectedMoto((current) =>
        motoRecords.some((item) => item.address === current && item.data.vendida) ? current : ""
      );
    } catch (error) {
      console.error("No se pudieron cargar los servicios:", error);
      toast.error("No se pudo consultar el inventario y los servicios en Solana.");
    } finally {
      setLoading(false);
    }
  }, [client, concesionario]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!connected?.signer) {
      toast.error("Conecta una wallet con capacidad de firma.");
      return;
    }
    if (!selectedMotorcycle) {
      toast.error("Selecciona una moto registrada.");
      return;
    }
    if (serviceType === "") {
      toast.error("Selecciona el tipo de servicio.");
      return;
    }
    const normalizedDescription = description.trim();
    if (!normalizedDescription) {
      toast.error("La descripción del servicio es obligatoria.");
      return;
    }
    if (new TextEncoder().encode(normalizedDescription).length > 100) {
      toast.error("La descripción no puede superar 100 bytes UTF-8.");
      return;
    }

    let mileageValue: bigint;
    let costValue: bigint;
    try {
      mileageValue = parseUnsigned(mileage, "Kilometraje");
      costValue = parseUnsigned(cost, "Costo");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Revisa los valores introducidos.");
      return;
    }

    setBusy(true);
    try {
      const motoAddress = address(selectedMotorcycle.address);
      const latestMoto = await client.registro.accounts.moto.fetch(motoAddress);
      if (latestMoto.data.concesionario !== concesionario) {
        throw new Error("La moto ya no pertenece al concesionario seleccionado.");
      }
      if (!latestMoto.data.vendida) {
        throw new Error("Solo se pueden registrar servicios para motos que ya fueron vendidas.");
      }

      const [garantia] = await deriveGarantiaPda(latestMoto.data.serial);
      const warrantyAccount = await client.registro.accounts.garantia.fetch(garantia);
      if (serviceType === TipoServicio.Garantia) {
        const warranty = warrantyAccount.data;
        const now = BigInt(Math.floor(Date.now() / 1000));
        if (warranty.estado !== EstadoGarantia.Activa) {
          throw new Error("La garantía de esta moto no está activa.");
        }
        if (now > warranty.fechaVencimiento) {
          throw new Error("La garantía de esta moto está vencida.");
        }
        if (mileageValue > warranty.kilometrajeMaximo) {
          throw new Error(`El kilometraje supera el máximo cubierto de ${warranty.kilometrajeMaximo.toString()} km.`);
        }
      }

      const [servicio] = await deriveServicioPda(motoAddress, latestMoto.data.servicios);
      const instruction = client.registro.instructions.registrarServicio({
        owner: connected.signer,
        concesionario: address(concesionario),
        moto: motoAddress,
        garantia,
        servicio,
        nombreConcesionario,
        serial: latestMoto.data.serial,
        kilometraje: mileageValue,
        descripcion: normalizedDescription,
        costo: costValue,
        tipo: serviceType,
      });
      const result = await instruction.sendTransaction();
      notifyTransactionSuccess("Servicio registrado correctamente en Solana.", result.context.signature);
      setMileage("");
      setDescription("");
      setCost("");
      await Promise.all([loadData(), onRegistered()]);
    } catch (error) {
      console.error("No se pudo registrar el servicio:", error);
      toast.error(error instanceof Error ? error.message : "No se pudo registrar el servicio.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[#e9ebee] bg-white p-6 shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">POSVENTA / TALLER</p>
            <h2 className="mt-2 text-[15px] font-bold text-[#252a30]">Registrar servicio</h2>
            <p className="mt-1 text-[10px] text-[#858d96]">Registra mantenimientos, reparaciones y trabajos de garantía asociados a una moto.</p>
          </div>
          <button type="button" onClick={() => void loadData()} disabled={loading} className="rounded-lg border border-[#e2e5e8] px-3 py-2 text-[10px] font-semibold text-[#555e68] hover:bg-[#f7f8fa] disabled:opacity-50">{loading ? "Actualizando…" : "Actualizar datos"}</button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Moto vendida</span>
              <select value={selectedMoto} onChange={(event) => setSelectedMoto(event.target.value)} required disabled={soldMotorcycles.length === 0 || busy} className="w-full rounded-lg border border-[#e2e5e8] bg-white px-3 py-2.5 text-[11px] outline-none focus:border-[#e60012] disabled:bg-[#f7f8fa]">
                {soldMotorcycles.length === 0 ? <option value="">No hay motos vendidas</option> : <><option value="">Selecciona una moto vendida</option>{soldMotorcycles.map((item) => <option key={item.address} value={item.address}>{item.data.marca} {item.data.modelo} · {item.data.serial}</option>)}</>}
              </select>
            </label>

            {selectedMotorcycle && (
              <div className="rounded-lg bg-[#f7f8fa] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[10px] font-bold text-[#252a30]">{selectedMotorcycle.data.marca} {selectedMotorcycle.data.modelo}</p>
                  <span className={`rounded-md px-2 py-1 text-[9px] font-bold ${selectedMotorcycle.data.vendida ? "bg-[#fff4e5] text-[#a96b16]" : "bg-[#eaf8f1] text-[#16865a]"}`}>{selectedMotorcycle.data.vendida ? "VENDIDA" : "EN INVENTARIO"}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[9px] text-[#737b84]">
                  <p>Serial: <strong className="font-mono text-[#424950]">{selectedMotorcycle.data.serial}</strong></p>
                  <p>Placa: <strong className="font-mono text-[#424950]">{selectedMotorcycle.data.placa}</strong></p>
                  <p>Color: <strong className="text-[#424950]">{selectedMotorcycle.data.color}</strong></p>
                  <p>Servicios previos: <strong className="text-[#424950]">{selectedMotorcycle.data.servicios.toString()}</strong></p>
                </div>
                <div className="mt-3 border-t border-[#e9ebee] pt-3">
                  <p className="text-[9px] font-bold tracking-wide text-[#9299a1]">MOTO PDA</p>
                  <a
                    href={`https://explorer.solana.com/address/${selectedMotorcycle.address}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={selectedMotorcycle.address}
                    className="mt-1 inline-flex break-all font-mono text-[10px] text-[#68717b] underline decoration-dotted underline-offset-2 hover:text-[#e60012]"
                  >
                    {selectedMotorcycle.address} ↗
                  </a>
                </div>
              </div>
            )}

            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Tipo de servicio</span>
              <select value={serviceType} onChange={(event) => setServiceType(event.target.value === "" ? "" : Number(event.target.value) as TipoServicio)} className="w-full rounded-lg border border-[#e2e5e8] bg-white px-3 py-2.5 text-[11px] outline-none focus:border-[#e60012]" disabled={busy}>
                <option value="">Selecciona un tipo de servicio</option>
                <option value={TipoServicio.Mantenimiento}>Mantenimiento</option>
                <option value={TipoServicio.Reparacion}>Reparación</option>
                <option value={TipoServicio.Garantia}>Garantía</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Kilometraje actual</span>
              <input value={mileage} onChange={(event) => setMileage(event.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" required disabled={busy} placeholder="Ej. 1500" className="w-full rounded-lg border border-[#e2e5e8] px-3 py-2.5 text-[11px] outline-none focus:border-[#e60012]" />
            </label>
          </div>

          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Descripción del trabajo</span>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={100} required disabled={busy} rows={5} placeholder="Describe el mantenimiento o reparación realizada…" className="w-full resize-y rounded-lg border border-[#e2e5e8] px-3 py-2.5 text-[11px] leading-relaxed outline-none focus:border-[#e60012]" />
              <span className="mt-1 block text-right text-[9px] text-[#a0a6ad]">{new TextEncoder().encode(description).length}/100 bytes UTF-8</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Costo del servicio</span>
              <input value={cost} onChange={(event) => setCost(event.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" required disabled={busy} placeholder="Ej. 250" className="w-full rounded-lg border border-[#e2e5e8] px-3 py-2.5 text-[11px] outline-none focus:border-[#e60012]" />
              <span className="mt-1 block text-[9px] text-[#a0a6ad]">Monto entero, sin decimales. Puede ser 0 para trabajos sin costo.</span>
            </label>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#eff0f2] pt-4">
              <p className="text-[9px] text-[#9299a1]">El registro actualiza el contador de servicios de la moto.</p>
              <button type="submit" disabled={busy || loading || soldMotorcycles.length === 0} className="rounded-lg bg-[#e60012] px-4 py-2.5 text-[10px] font-semibold text-white transition hover:bg-[#c90010] disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Registrando…" : "Registrar servicio"}</button>
            </div>
          </div>
        </form>
        {soldMotorcycles.length === 0 && !loading && (
          <p className="mt-4 rounded-lg bg-[#fff7f7] p-3 text-[10px] text-[#a34a50]">Todavía no hay motos vendidas en este concesionario. El módulo Servicios solo permite registrar trabajos para motos que ya tengan una venta.</p>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-[#e9ebee] bg-white shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
        <div className="flex items-center justify-between border-b border-[#eff0f2] px-6 py-4">
          <div>
            <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">HISTORIAL ON-CHAIN</p>
            <h2 className="mt-1 text-[14px] font-bold text-[#252a30]">Servicios del concesionario</h2>
          </div>
          <span className="rounded-md bg-[#f4f5f6] px-2 py-1 text-[9px] font-bold text-[#737b84]">{services.length} registros</span>
        </div>
        {services.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left">
              <thead className="bg-[#fafbfc] text-[9px] font-bold uppercase tracking-wide text-[#9299a1]">
                <tr><th className="px-6 py-3">Fecha</th><th className="px-4 py-3">Moto</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3 text-right">Km</th><th className="px-4 py-3 text-right">Costo</th><th className="px-5 py-3 text-right">Servicio PDA</th><th className="px-4 py-3 text-right">Detalle</th></tr>
              </thead>
              <tbody className="divide-y divide-[#f0f1f3]">
                {services.map((item) => (
                  <tr key={item.address} className="text-[10px] text-[#555e68]">
                    <td className="whitespace-nowrap px-6 py-3">{new Date(Number(item.data.fechaServicio) * 1000).toLocaleString("es-VE")}</td>
                    <td className="px-4 py-3"><p className="font-semibold text-[#424950]">{item.motorcycle ? `${item.motorcycle.marca} ${item.motorcycle.modelo}` : shortAddress(item.data.moto)}</p><p className="mt-0.5 font-mono text-[9px] text-[#9299a1]">{item.motorcycle?.serial ?? shortAddress(item.data.moto)}</p></td>
                    <td className="px-4 py-3">{serviceLabels[item.data.tipo]}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatAmount(item.data.kilometraje)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[#252a30]">{formatAmount(item.data.costo)}</td>
                    <td className="px-5 py-3 text-right"><a href={`https://explorer.solana.com/address/${item.address}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="font-mono text-[#68717b] underline decoration-dotted underline-offset-2 hover:text-[#e60012]">{shortAddress(item.address)} ↗</a></td>
                    <td className="px-4 py-3 text-right"><button type="button" onClick={() => setDetail(item)} className="whitespace-nowrap rounded-md border border-[#e2e5e8] px-2.5 py-1.5 text-[9px] font-semibold text-[#555e68] hover:border-[#e60012] hover:text-[#e60012]">Ver detalles</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex min-h-[145px] flex-col items-center justify-center px-6 text-center">
            <p className="text-[11px] font-semibold text-[#515962]">{loading ? "Consultando servicios…" : "Todavía no hay servicios registrados"}</p>
            <p className="mt-1 text-[10px] text-[#9aa1a9]">Los mantenimientos y reparaciones confirmados aparecerán aquí.</p>
          </div>
        )}
      </section>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#171b20]/50 p-4" onClick={() => setDetail(null)}>
          <section role="dialog" aria-modal="true" aria-labelledby="service-detail-title" onClick={(event) => event.stopPropagation()} className="my-auto max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-[#eff0f2] bg-white px-6 py-5">
              <div>
                <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">REGISTRO ON-CHAIN</p>
                <h2 id="service-detail-title" className="mt-1 text-[17px] font-bold text-[#252a30]">Detalle del servicio</h2>
                <p className="mt-1 font-mono text-[10px] text-[#858d96]">{shortAddress(detail.address)}</p>
              </div>
              <button type="button" onClick={() => setDetail(null)} aria-label="Cerrar detalles" className="rounded-lg border border-[#e2e5e8] px-3 py-1.5 text-[12px] text-[#68717b] hover:bg-[#f7f8fa]">✕</button>
            </div>
            <div className="space-y-4 p-6">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-[#f7f8fa] p-4"><p className="text-[9px] font-bold text-[#9299a1]">TIPO</p><p className="mt-2 text-[13px] font-bold text-[#252a30]">{serviceLabels[detail.data.tipo]}</p></div>
                <div className="rounded-xl bg-[#f7f8fa] p-4"><p className="text-[9px] font-bold text-[#9299a1]">KILOMETRAJE</p><p className="mt-2 text-[13px] font-bold text-[#252a30]">{formatAmount(detail.data.kilometraje)} km</p></div>
                <div className="rounded-xl bg-[#f7f8fa] p-4"><p className="text-[9px] font-bold text-[#9299a1]">COSTO</p><p className="mt-2 text-[13px] font-bold text-[#252a30]">{formatAmount(detail.data.costo)}</p></div>
              </div>
              <div className="rounded-xl border border-[#eff0f2] p-4">
                <h3 className="text-[11px] font-bold text-[#252a30]">Información del servicio</h3>
                <p className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-[#555e68]">{detail.data.descripcion}</p>
                <p className="mt-3 text-[10px] text-[#737b84]">Fecha: <strong className="text-[#252a30]">{new Date(Number(detail.data.fechaServicio) * 1000).toLocaleString("es-VE")}</strong></p>
                <p className="mt-2 break-all text-[10px] text-[#737b84]">PDA: <a className="font-mono text-[#e60012] hover:underline" href={`https://explorer.solana.com/address/${detail.address}?cluster=devnet`} target="_blank" rel="noopener noreferrer">{detail.address} ↗</a></p>
              </div>
              <div className="rounded-xl border border-[#eff0f2] p-4">
                <h3 className="text-[11px] font-bold text-[#252a30]">Moto vinculada</h3>
                {detail.motorcycle ? <><p className="mt-2 text-[13px] font-bold text-[#252a30]">{detail.motorcycle.marca} {detail.motorcycle.modelo}</p><div className="mt-2 grid gap-2 text-[10px] text-[#68717b] sm:grid-cols-2"><p>Serial: <strong className="font-mono text-[#252a30]">{detail.motorcycle.serial}</strong></p><p>Placa: <strong className="font-mono text-[#252a30]">{detail.motorcycle.placa}</strong></p><p>Color: <strong className="text-[#252a30]">{detail.motorcycle.color}</strong></p><p>Vendida: <strong className="text-[#252a30]">{detail.motorcycle.vendida ? "Sí" : "No"}</strong></p></div></> : <p className="mt-2 text-[10px] text-[#9299a1]">No se pudo cargar la cuenta de la moto asociada.</p>}
                <p className="mt-3 break-all text-[10px]">Moto PDA: <a className="font-mono text-[#e60012] hover:underline" href={`https://explorer.solana.com/address/${detail.data.moto}?cluster=devnet`} target="_blank" rel="noopener noreferrer">{detail.data.moto} ↗</a></p>
              </div>
              <div className="rounded-xl border border-[#eff0f2] p-4">
                <h3 className="text-[11px] font-bold text-[#252a30]">Concesionario</h3>
                <p className="mt-2 text-[11px] font-semibold text-[#252a30]">{nombreConcesionario}</p>
                <p className="mt-2 break-all text-[10px]">PDA: <a className="font-mono text-[#e60012] hover:underline" href={`https://explorer.solana.com/address/${detail.data.concesionario}?cluster=devnet`} target="_blank" rel="noopener noreferrer">{detail.data.concesionario} ↗</a></p>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
