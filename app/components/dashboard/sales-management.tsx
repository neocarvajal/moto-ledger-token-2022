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
import { deriveClientePda, deriveVentaPda } from "../../lib/moto-ledger/pdas";
import { REGISTRO_PROGRAM_ADDRESS } from "../../lib/moto-ledger/src/generated/programs";
import {
  getMotoDecoder,
  getMotoDiscriminatorBytes,
  type Moto,
} from "../../lib/moto-ledger/src/generated/accounts/moto";
import {
  getVentaDecoder,
  getVentaDiscriminatorBytes,
  type Venta,
} from "../../lib/moto-ledger/src/generated/accounts/venta";
import {
  getClienteDecoder,
  getClienteDiscriminatorBytes,
  type Cliente,
} from "../../lib/moto-ledger/src/generated/accounts/cliente";
import type { Concesionario } from "../../lib/moto-ledger/src/generated/accounts/concesionario";

type MotorcycleRecord = { address: string; data: Moto };
type CustomerRecord = { address: string; data: Cliente };
type SaleRecord = { address: string; data: Venta };
type SaleDetails = {
  sale: SaleRecord;
  customer: Cliente;
  motorcycle: Moto;
  dealership: Concesionario;
};

function parseCedula(value: string) {
  const parsed = Number(value.trim());
  if (!/^[0-9]+$/.test(value.trim()) || !Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 4294967295) {
    throw new Error("Introduce una cédula válida.");
  }
  return parsed;
}

function formatAmount(value: bigint) {
  return value.toLocaleString("es-VE");
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-5)}`;
}

export function SalesManagement({
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
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [selectedCustomerAddress, setSelectedCustomerAddress] = useState("");
  const [serial, setSerial] = useState("");
  const [cedula, setCedula] = useState("");
  const [price, setPrice] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [saleDetails, setSaleDetails] = useState<SaleDetails | null>(null);

  const availableMotorcycles = useMemo(
    () => motorcycles.filter((item) => !item.data.vendida),
    [motorcycles]
  );

  const loadData = useCallback(async () => {
    if (!concesionario) return;
    setLoading(true);
    try {
      const dealerAddress = address(concesionario);
      const motoDiscriminator = getBase58Decoder().decode(
        getMotoDiscriminatorBytes()
      ) as Base58EncodedBytes;
      const ventaDiscriminator = getBase58Decoder().decode(
        getVentaDiscriminatorBytes()
      ) as Base58EncodedBytes;

      const [motoResults, ventaResults] = await Promise.all([
        client.rpc.getProgramAccounts(
          REGISTRO_PROGRAM_ADDRESS,
          {
            encoding: "base64",
            filters: [
              { memcmp: { offset: 0n, bytes: motoDiscriminator, encoding: "base58" } },
            ],
          }
        ).send(),
        client.rpc.getProgramAccounts(
          REGISTRO_PROGRAM_ADDRESS,
          {
            encoding: "base64",
            filters: [
              { memcmp: { offset: 0n, bytes: ventaDiscriminator, encoding: "base58" } },
              { memcmp: { offset: 8n, bytes: dealerAddress as Base58EncodedBytes, encoding: "base58" } },
            ],
          }
        ).send(),
      ]);

      const motoRecords: MotorcycleRecord[] = motoResults
        .map((item) => ({
          address: item.pubkey,
          data: getMotoDecoder().decode(getBase64Encoder().encode(item.account.data[0])),
        }))
        .filter((item) => item.data.concesionario === concesionario)
        .sort((a, b) => a.data.serial.localeCompare(b.data.serial));

      const saleRecords: SaleRecord[] = ventaResults
        .map((item) => ({
          address: item.pubkey,
          data: getVentaDecoder().decode(getBase64Encoder().encode(item.account.data[0])),
        }))
        .sort((a, b) => Number(b.data.fechaVenta - a.data.fechaVenta));

      setMotorcycles(motoRecords);
      setSales(saleRecords);
      setSerial((current) =>
        motoRecords.some((item) => item.data.serial === current && !item.data.vendida)
          ? current
          : motoRecords.find((item) => !item.data.vendida)?.data.serial ?? ""
      );
    } catch (error) {
      console.error("No se pudieron cargar las ventas:", error);
      toast.error("No se pudo consultar el inventario y las ventas en Solana.");
    } finally {
      setLoading(false);
    }
  }, [client, concesionario]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const loadCustomers = useCallback(async () => {
    if (!connected?.account.address) {
      setCustomers([]);
      setSelectedCustomerAddress("");
      setCedula("");
      setCustomerName("");
      return;
    }

    setLoadingCustomers(true);
    try {
      const ownerFilter = address(connected.account.address) as Base58EncodedBytes;
      const discriminatorFilter = getBase58Decoder().decode(
        getClienteDiscriminatorBytes()
      ) as Base58EncodedBytes;
      const results = await client.rpc
        .getProgramAccounts(REGISTRO_PROGRAM_ADDRESS, {
          encoding: "base64",
          filters: [
            { memcmp: { offset: 0n, bytes: discriminatorFilter, encoding: "base58" } },
            { memcmp: { offset: 8n, bytes: ownerFilter, encoding: "base58" } },
          ],
        })
        .send();

      const found: CustomerRecord[] = results.map((result) => ({
        address: result.pubkey,
        data: getClienteDecoder().decode(
          getBase64Encoder().encode(result.account.data[0])
        ),
      }));
      found.sort((a, b) => a.data.idCliente - b.data.idCliente);
      setCustomers(found);
      const selected = found[0] ?? null;
      setSelectedCustomerAddress(selected?.address ?? "");
      setCedula(selected ? String(selected.data.cedulaCliente) : "");
      setCustomerName(selected?.data.nombreCliente ?? "");
    } catch (error) {
      console.error("No se pudieron cargar los clientes para ventas:", error);
      toast.error("No se pudieron consultar los clientes registrados del concesionario en Solana.");
    } finally {
      setLoadingCustomers(false);
    }
  }, [client, connected?.account.address]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  const lookupCustomer = async (value: string) => {
    if (!connected) throw new Error("Conecta tu wallet para consultar clientes.");
    const id = parseCedula(value);
    const [pda] = await deriveClientePda(address(connected.account.address), id);
    const account = await client.registro.accounts.cliente.fetch(pda);
    if (account.data.owner !== connected.account.address) {
      throw new Error("El cliente no pertenece a la wallet conectada.");
    }
    setCustomerName(account.data.nombreCliente);
    return { id, pda };
  };

  const handleCustomerLookup = async () => {
    try {
      await lookupCustomer(cedula);
    } catch (error) {
      setCustomerName("");
      toast.error(error instanceof Error ? error.message : "No se encontró el cliente.");
    }
  };

  const handleViewDetails = async (sale: SaleRecord) => {
    setDetailLoading(sale.address);
    setSaleDetails(null);
    try {
      const [customerAccount, motorcycleAccount, dealershipAccount] = await Promise.all([
        client.registro.accounts.cliente.fetch(address(sale.data.cliente)),
        client.registro.accounts.moto.fetch(address(sale.data.moto)),
        client.registro.accounts.concesionario.fetch(address(sale.data.concesionario)),
      ]);
      setSaleDetails({
        sale,
        customer: customerAccount.data,
        motorcycle: motorcycleAccount.data,
        dealership: dealershipAccount.data,
      });
    } catch (error) {
      console.error("No se pudieron consultar los detalles de la venta:", error);
      toast.error(error instanceof Error ? error.message : "No se pudieron consultar los datos relacionados con esta venta.");
    } finally {
      setDetailLoading(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!connected?.signer) {
      toast.error("Conecta una wallet con capacidad de firma.");
      return;
    }
    if (!serial) {
      toast.error("Selecciona una moto disponible.");
      return;
    }

    let customerId: number;
    let amount: bigint;
    try {
      customerId = parseCedula(cedula);
      if (!/^[0-9]+$/.test(price.trim())) throw new Error("Introduce un precio entero válido.");
      amount = BigInt(price.trim());
      if (amount <= 0n) throw new Error("El precio de venta debe ser mayor que cero.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Revisa los datos de la venta.");
      return;
    }

    setBusy(true);
    try {
      const owner = address(connected.account.address);
      const dealerAddress = address(concesionario);
      const [cliente] = await deriveClientePda(owner, customerId);
      const customer = await client.registro.accounts.cliente.fetch(cliente);
      if (customer.data.owner !== owner) throw new Error("El cliente no pertenece a la wallet conectada.");

      const motorcycle = motorcycles.find((item) => item.data.serial === serial);
      if (!motorcycle) throw new Error("La moto seleccionada ya no está disponible.");
      if (motorcycle.data.vendida) throw new Error("Esta moto ya fue vendida.");

      const [venta] = await deriveVentaPda(address(motorcycle.address));
      const instruction = client.registro.instructions.registrarVenta({
        owner: connected.signer,
        concesionario: dealerAddress,
        cliente,
        moto: address(motorcycle.address),
        venta,
        nombreConcesionario,
        serial: motorcycle.data.serial,
        cedulaCliente: customerId,
        precioVenta: amount,
      });
      const result = await instruction.sendTransaction();
      notifyTransactionSuccess("Venta registrada correctamente en Solana.", result.context.signature);
      setCedula("");
      setPrice("");
      setCustomerName("");
      setSelectedCustomerAddress("");
      await Promise.all([loadData(), onRegistered()]);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "No se pudo registrar la venta.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[#e9ebee] bg-white p-6 shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">COMERCIALIZACIÓN</p>
            <h2 className="mt-2 text-[15px] font-bold text-[#252a30]">Registrar venta</h2>
            <p className="mt-1 text-[10px] text-[#858d96]">Asocia una moto disponible con un cliente registrado.</p>
          </div>
          <button type="button" onClick={() => void loadData()} disabled={loading} className="rounded-lg border border-[#e2e5e8] px-3 py-2 text-[10px] font-semibold text-[#555e68] hover:bg-[#f7f8fa] disabled:opacity-50">
            {loading ? "Actualizando…" : "Actualizar datos"}
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-[#f7f8fa] p-4">
            <p className="text-[9px] text-[#9299a1]">Unidades disponibles</p>
            <p className="mt-1 text-[22px] font-bold text-[#252a30]">{availableMotorcycles.length}</p>
          </div>
          <div className="rounded-lg bg-[#f7f8fa] p-4">
            <p className="text-[9px] text-[#9299a1]">Ventas registradas</p>
            <p className="mt-1 text-[22px] font-bold text-[#252a30]">{sales.length}</p>
          </div>
          <div className="rounded-lg bg-[#f7f8fa] p-4">
            <p className="text-[9px] text-[#9299a1]">Concesionario</p>
            <p className="mt-1 truncate text-[13px] font-bold text-[#252a30]">{nombreConcesionario}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 grid gap-4 border-t border-[#eff0f2] pt-5 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Moto disponible</span>
            <select value={serial} onChange={(event) => setSerial(event.target.value)} required className="w-full rounded-lg border border-[#e2e5e8] bg-white px-3 py-2.5 text-[11px] outline-none focus:border-[#e60012]">
              {availableMotorcycles.length === 0 ? <option value="">No hay unidades disponibles</option> : availableMotorcycles.map((item) => (
                <option key={item.address} value={item.data.serial}>
                  {item.data.marca} {item.data.modelo} · {item.data.serial} · {item.data.placa}
                </option>
              ))}
            </select>
            {availableMotorcycles.length === 0 && <span className="mt-1 block text-[9px] text-[#a0a6ad]">Registra una moto antes de crear una venta.</span>}
          </label>

          <div className="sm:col-span-2">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <label htmlFor="sale-registered-customer" className="block text-[10px] font-semibold text-[#555e68]">Cliente registrado</label>
              <button type="button" onClick={() => void loadCustomers()} disabled={loadingCustomers} className="text-[10px] font-semibold text-[#68717b] hover:text-[#e60012] disabled:opacity-50">
                {loadingCustomers ? "Actualizando…" : "Actualizar clientes"}
              </button>
            </div>
            {customers.length > 0 ? (
              <select
                id="sale-registered-customer"
                value={selectedCustomerAddress}
                onChange={(event) => {
                  const selected = customers.find((item) => item.address === event.target.value) ?? null;
                  setSelectedCustomerAddress(selected?.address ?? "");
                  setCedula(selected ? String(selected.data.cedulaCliente) : "");
                  setCustomerName(selected?.data.nombreCliente ?? "");
                }}
                className="w-full rounded-lg border border-[#e2e5e8] bg-white px-3 py-2.5 text-[11px] text-[#252a30] outline-none focus:border-[#e60012]"
              >
                <option value="">Selecciona un cliente registrado</option>
                {customers.map((item) => (
                  <option key={item.address} value={item.address}>
                    {item.data.nombreCliente} · C.I. {item.data.cedulaCliente}
                  </option>
                ))}
              </select>
            ) : (
              <div className="rounded-lg bg-[#f7f8fa] px-3 py-3 text-[10px] text-[#858d96]">
                {loadingCustomers ? "Consultando clientes en Solana…" : "No hay clientes registrados para este concesionario."}
              </div>
            )}
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input value={cedula} onChange={(event) => { setCedula(event.target.value.replace(/[^0-9]/g, "")); setCustomerName(""); setSelectedCustomerAddress(""); }} inputMode="numeric" maxLength={10} required placeholder="Cédula de identidad" className="min-w-0 flex-1 rounded-lg border border-[#e2e5e8] px-3 py-2.5 font-mono text-[11px] outline-none focus:border-[#e60012]" />
              <button type="button" onClick={() => void handleCustomerLookup()} disabled={!cedula} className="rounded-lg border border-[#e2e5e8] px-4 py-2.5 text-[10px] font-semibold text-[#555e68] hover:bg-[#f7f8fa] disabled:opacity-50">Verificar cliente</button>
            </div>
            {customerName && <p className="mt-2 text-[10px] font-semibold text-[#16845a]">✓ {customerName} · Cliente verificado en Solana</p>}
            {customers.length > 0 && <p className="mt-1 text-[9px] text-[#a0a6ad]">{customers.length} cliente(s) registrados en este concesionario.</p>}
          </div>

          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Precio de venta</span>
            <input value={price} onChange={(event) => setPrice(event.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" required placeholder="Ej. 2500" className="w-full rounded-lg border border-[#e2e5e8] px-3 py-2.5 font-mono text-[11px] outline-none focus:border-[#e60012]" />
            <span className="mt-1 block text-[9px] text-[#9aa1a9]">Monto entero registrado en la cuenta on-chain, sin decimales.</span>
          </label>
          <div className="flex items-end">
            <button type="submit" disabled={busy || loading || availableMotorcycles.length === 0} className="w-full rounded-lg bg-[#e60012] px-4 py-2.5 text-[11px] font-semibold text-white transition hover:bg-[#c90010] disabled:opacity-50">
              {busy ? "Registrando venta…" : "Confirmar venta"}
            </button>
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-xl border border-[#e9ebee] bg-white shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
        <div className="flex items-center justify-between border-b border-[#eff0f2] px-6 py-4">
          <div>
            <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">HISTORIAL ON-CHAIN</p>
            <h2 className="mt-1 text-[14px] font-bold text-[#252a30]">Ventas del concesionario</h2>
          </div>
          <span className="rounded-md bg-[#f4f5f6] px-2 py-1 text-[9px] font-bold text-[#737b84]">{sales.length} registros</span>
        </div>
        {sales.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left">
              <thead className="bg-[#fafbfc] text-[9px] font-bold uppercase tracking-wide text-[#9299a1]">
                <tr><th className="px-6 py-3">Fecha</th><th className="px-4 py-3">Cliente PDA</th><th className="px-4 py-3">Moto PDA</th><th className="px-4 py-3 text-right">Precio</th><th className="px-6 py-3 text-right">Venta PDA</th><th className="px-4 py-3 text-right">Detalle</th></tr>
              </thead>
              <tbody className="divide-y divide-[#f0f1f3]">
                {sales.map((sale) => (
                  <tr key={sale.address} className="text-[10px] text-[#555e68]">
                    <td className="whitespace-nowrap px-6 py-3">{new Date(Number(sale.data.fechaVenta) * 1000).toLocaleString("es-VE")}</td>
                    <td className="px-4 py-3 font-mono">{shortAddress(sale.data.cliente)}</td>
                    <td className="px-4 py-3 font-mono">{shortAddress(sale.data.moto)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-[#252a30]">{formatAmount(sale.data.precioVenta)}</td>
                    <td className="px-6 py-3 text-right"><a href={`https://explorer.solana.com/address/${sale.address}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="font-mono text-[#68717b] underline decoration-dotted underline-offset-2 hover:text-[#e60012]">{shortAddress(sale.address)} ↗</a></td>
                    <td className="px-4 py-3 text-right"><button type="button" onClick={() => void handleViewDetails(sale)} disabled={detailLoading !== null} className="whitespace-nowrap rounded-md border border-[#e2e5e8] px-2.5 py-1.5 text-[9px] font-semibold text-[#555e68] transition hover:border-[#e60012] hover:text-[#e60012] disabled:opacity-50">{detailLoading === sale.address ? "Cargando…" : "Ver detalles"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex min-h-[150px] flex-col items-center justify-center px-6 text-center">
            <p className="text-[11px] font-semibold text-[#515962]">{loading ? "Consultando ventas…" : "Todavía no hay ventas registradas"}</p>
            <p className="mt-1 text-[10px] text-[#9aa1a9]">Las ventas confirmadas en la blockchain aparecerán aquí.</p>
          </div>
        )}
      </section>

      {detailLoading && !saleDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#171b20]/40 p-4">
          <div className="rounded-xl bg-white px-6 py-5 text-center shadow-xl">
            <p className="text-[11px] font-semibold text-[#252a30]">Consultando datos on-chain…</p>
            <p className="mt-1 text-[10px] text-[#858d96]">Leyendo las cuentas vinculadas a la venta.</p>
          </div>
        </div>
      )}

      {saleDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#171b20]/50 p-4" onClick={() => setSaleDetails(null)}>
          <section role="dialog" aria-modal="true" aria-labelledby="sale-details-title" onClick={(event) => event.stopPropagation()} className="my-auto max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-[#eff0f2] bg-white px-6 py-5">
              <div>
                <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">REGISTRO ON-CHAIN</p>
                <h2 id="sale-details-title" className="mt-1 text-[17px] font-bold text-[#252a30]">Detalle de la venta</h2>
                <p className="mt-1 font-mono text-[10px] text-[#858d96]">{shortAddress(saleDetails.sale.address)}</p>
              </div>
              <button type="button" onClick={() => setSaleDetails(null)} aria-label="Cerrar detalles" className="rounded-lg border border-[#e2e5e8] px-3 py-1.5 text-[12px] text-[#68717b] hover:bg-[#f7f8fa]">✕</button>
            </div>

            <div className="space-y-5 p-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-[#f7f8fa] p-4">
                  <p className="text-[9px] font-bold tracking-wide text-[#9299a1]">PRECIO DE VENTA</p>
                  <p className="mt-2 text-[24px] font-bold text-[#252a30]">{formatAmount(saleDetails.sale.data.precioVenta)}</p>
                  <p className="mt-1 text-[10px] text-[#858d96]">Monto almacenado en la cuenta Venta</p>
                </div>
                <div className="rounded-xl bg-[#f7f8fa] p-4">
                  <p className="text-[9px] font-bold tracking-wide text-[#9299a1]">FECHA DE REGISTRO</p>
                  <p className="mt-2 text-[14px] font-bold text-[#252a30]">{new Date(Number(saleDetails.sale.data.fechaVenta) * 1000).toLocaleString("es-VE")}</p>
                  <p className="mt-1 text-[10px] text-[#858d96]">Timestamp guardado on-chain</p>
                </div>
              </div>

              <div className="rounded-xl border border-[#eff0f2] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[11px] font-bold text-[#252a30]">Cuenta Venta</h3>
                  <a href={`https://explorer.solana.com/address/${saleDetails.sale.address}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="text-[9px] font-semibold text-[#e60012] hover:underline">Abrir en Explorer ↗</a>
                </div>
                <p className="mt-2 break-all font-mono text-[10px] text-[#68717b]">{saleDetails.sale.address}</p>
                <div className="mt-3 grid gap-2 text-[10px] sm:grid-cols-2">
                  <p><span className="text-[#9299a1]">Concesionario:</span> <span className="break-all font-mono">{saleDetails.sale.data.concesionario}</span></p>
                  <p><span className="text-[#9299a1]">Cliente:</span> <span className="break-all font-mono">{saleDetails.sale.data.cliente}</span></p>
                  <p className="sm:col-span-2"><span className="text-[#9299a1]">Moto:</span> <span className="break-all font-mono">{saleDetails.sale.data.moto}</span></p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-[#eff0f2] p-4">
                  <h3 className="text-[11px] font-bold text-[#252a30]">Cliente</h3>
                  <p className="mt-2 text-[14px] font-bold text-[#252a30]">{saleDetails.customer.nombreCliente}</p>
                  <div className="mt-3 space-y-2 text-[10px] text-[#68717b]">
                    <p>Cédula: <strong className="text-[#252a30]">{saleDetails.customer.cedulaCliente}</strong></p>
                    <p>ID cliente: <strong className="text-[#252a30]">{saleDetails.customer.idCliente}</strong></p>
                    <p>Motos asociadas: <strong className="text-[#252a30]">{saleDetails.customer.totalMotosCliente}</strong></p>
                    <p>Owner: <span className="break-all font-mono">{saleDetails.customer.owner}</span></p>
                    <p>PDA: <a className="break-all font-mono text-[#e60012] hover:underline" href={`https://explorer.solana.com/address/${saleDetails.sale.data.cliente}?cluster=devnet`} target="_blank" rel="noopener noreferrer">{saleDetails.sale.data.cliente} ↗</a></p>
                  </div>
                </div>

                <div className="rounded-xl border border-[#eff0f2] p-4">
                  <h3 className="text-[11px] font-bold text-[#252a30]">Moto</h3>
                  <p className="mt-2 text-[14px] font-bold text-[#252a30]">{saleDetails.motorcycle.marca} {saleDetails.motorcycle.modelo}</p>
                  <div className="mt-3 space-y-2 text-[10px] text-[#68717b]">
                    <p>Serial: <strong className="font-mono text-[#252a30]">{saleDetails.motorcycle.serial}</strong></p>
                    <p>Placa: <strong className="font-mono text-[#252a30]">{saleDetails.motorcycle.placa}</strong></p>
                    <p>Color: <strong className="text-[#252a30]">{saleDetails.motorcycle.color}</strong></p>
                    <p>Vendida: <strong className="text-[#252a30]">{saleDetails.motorcycle.vendida ? "Sí" : "No"}</strong></p>
                    <p>Servicios: <strong className="text-[#252a30]">{saleDetails.motorcycle.servicios.toString()}</strong> · Reclamaciones: <strong className="text-[#252a30]">{saleDetails.motorcycle.totalReclamaciones.toString()}</strong></p>
                    <p>Garantía PDA: <span className="break-all font-mono">{saleDetails.motorcycle.garantia}</span></p>
                    <p>PDA: <a className="break-all font-mono text-[#e60012] hover:underline" href={`https://explorer.solana.com/address/${saleDetails.sale.data.moto}?cluster=devnet`} target="_blank" rel="noopener noreferrer">{saleDetails.sale.data.moto} ↗</a></p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[#eff0f2] p-4">
                <h3 className="text-[11px] font-bold text-[#252a30]">Concesionario</h3>
                <p className="mt-2 text-[14px] font-bold text-[#252a30]">{saleDetails.dealership.nombreConcesionario}</p>
                <div className="mt-3 grid gap-2 text-[10px] text-[#68717b] sm:grid-cols-2">
                  <p>RIF: <strong className="text-[#252a30]">{saleDetails.dealership.rifConcesionario}</strong></p>
                  <p>ID: <strong className="text-[#252a30]">{saleDetails.dealership.idConcesionario}</strong></p>
                  <p>Total motos: <strong className="text-[#252a30]">{saleDetails.dealership.totalMotos.toString()}</strong></p>
                  <p>Total clientes: <strong className="text-[#252a30]">{saleDetails.dealership.totalClientes}</strong></p>
                  <p>Total ventas: <strong className="text-[#252a30]">{saleDetails.dealership.totalVentas.toString()}</strong></p>
                  <p>Total servicios: <strong className="text-[#252a30]">{saleDetails.dealership.totalServicios.toString()}</strong></p>
                  <p>Garantía (días): <strong className="text-[#252a30]">{saleDetails.dealership.duracionGarantiaDias}</strong></p>
                  <p>Km máximo: <strong className="text-[#252a30]">{saleDetails.dealership.kilometrajeMaximo.toString()}</strong></p>
                  <p className="sm:col-span-2">Owner: <span className="break-all font-mono">{saleDetails.dealership.owner}</span></p>
                  <p className="sm:col-span-2">PDA: <a className="break-all font-mono text-[#e60012] hover:underline" href={`https://explorer.solana.com/address/${saleDetails.sale.data.concesionario}?cluster=devnet`} target="_blank" rel="noopener noreferrer">{saleDetails.sale.data.concesionario} ↗</a></p>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
