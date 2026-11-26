"use client";

import { useState, type FormEvent } from "react";
import { address } from "@solana/kit";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import { toast } from "sonner";
import { useAppClient } from "../../lib/client-provider";
import { notifyTransactionSuccess } from "../../lib/transaction-toast";
import { deriveClientePda } from "../../lib/moto-ledger/pdas";
import { CustomerWalletLink } from "./customer-wallet-link";
import type { Cliente } from "../../lib/moto-ledger/src/generated/accounts";

function parseCedula(value: string) {
  const parsed = Number(value.trim());
  if (!/^[0-9]+$/.test(value.trim()) || !Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 4294967295) {
    throw new Error("Introduce una cédula válida.");
  }
  return parsed;
}

export function CustomerManagement({
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
  const [name, setName] = useState("");
  const [cedula, setCedula] = useState("");
  const [searchCedula, setSearchCedula] = useState("");
  const [customer, setCustomer] = useState<{ address: string; data: Cliente } | null>(null);
  const [busy, setBusy] = useState<"register" | "search" | null>(null);

  const lookup = async (value: string) => {
    if (!connected) throw new Error("Conecta tu wallet para consultar clientes.");
    const id = parseCedula(value);
    const [pda] = await deriveClientePda(address(connected.account.address), id);
    const account = await client.registro.accounts.cliente.fetch(pda);
    if (account.data.owner !== connected.account.address) throw new Error("El cliente no pertenece a la wallet conectada.");
    setCustomer({ address: pda, data: account.data });
  };

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy("search");
    setCustomer(null);
    try {
      await lookup(searchCedula);
      toast.success("Cliente encontrado en Solana.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se encontró el cliente.");
    } finally {
      setBusy(null);
    }
  };

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!connected?.signer) {
      toast.error("Conecta una wallet con capacidad de firma.");
      return;
    }
    let id: number;
    try {
      id = parseCedula(cedula);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Cédula inválida.");
      return;
    }
    const normalizedName = name.trim();
    if (!normalizedName || new TextEncoder().encode(normalizedName).length > 50) {
      toast.error("El nombre es obligatorio y no puede superar 50 bytes UTF-8.");
      return;
    }

    setBusy("register");
    try {
      const owner = address(connected.account.address);
      const [cliente] = await deriveClientePda(owner, id);
      const existing = await client.registro.accounts.cliente.fetch(cliente).catch(() => null);
      if (existing) {
        setCustomer({ address: cliente, data: existing.data });
        throw new Error("Ya existe un cliente con esa cédula para esta wallet.");
      }
      const instruction = client.registro.instructions.registrarCliente({
        owner: connected.signer,
        concesionario: address(concesionario),
        cliente,
        nombreConcesionario,
        cedulaCliente: id,
        nombreCliente: normalizedName,
      });
      const result = await instruction.sendTransaction();
      notifyTransactionSuccess(
        "Cliente registrado correctamente en Solana.",
        result.context.signature
      );
      const created = await client.registro.accounts.cliente.fetch(cliente);
      setCustomer({ address: cliente, data: created.data });
      await onRegistered();
      setName("");
      setCedula("");
      setSearchCedula(String(id));
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "No se pudo registrar el cliente.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="rounded-xl border border-[#e9ebee] bg-white p-6 shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
        <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">DIRECTORIO</p>
        <h2 className="mt-2 text-[15px] font-bold text-[#252a30]">Registrar cliente</h2>
        <p className="mt-1 text-[10px] text-[#858d96]">Registra los datos de identificación del comprador.</p>
        <form onSubmit={handleRegister} className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Nombre y apellido</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required placeholder="Ej. Juan Pérez" className="w-full rounded-lg border border-[#e2e5e8] px-3 py-2.5 text-[11px] outline-none focus:border-[#e60012]" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Cédula de identidad</span>
            <input value={cedula} onChange={(e) => setCedula(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" maxLength={10} required placeholder="12345678" className="w-full rounded-lg border border-[#e2e5e8] px-3 py-2.5 font-mono text-[11px] outline-none focus:border-[#e60012]" />
          </label>
          <button type="submit" disabled={busy !== null} className="rounded-lg bg-[#e60012] px-4 py-2.5 text-[11px] font-semibold text-white hover:bg-[#c90010] disabled:opacity-50">{busy === "register" ? "Registrando…" : "Registrar cliente"}</button>
        </form>
        <p className="mt-4 text-[9px] leading-relaxed text-[#9aa1a9]">La PDA se deriva con la wallet propietaria y la cédula. No se puede repetir una cédula para la misma wallet.</p>
      </section>

      <section className="rounded-xl border border-[#e9ebee] bg-white p-6 shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
        <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">CONSULTA ON-CHAIN</p>
        <h2 className="mt-2 text-[15px] font-bold text-[#252a30]">Buscar cliente</h2>
        <p className="mt-1 text-[10px] text-[#858d96]">Consulta su ficha mediante la cédula.</p>
        <form onSubmit={handleSearch} className="mt-5 flex flex-col gap-3 sm:flex-row">
          <input value={searchCedula} onChange={(e) => setSearchCedula(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" maxLength={10} required placeholder="Número de cédula" className="min-w-0 flex-1 rounded-lg border border-[#e2e5e8] px-3 py-2.5 font-mono text-[11px] outline-none focus:border-[#e60012]" />
          <button type="submit" disabled={busy !== null} className="rounded-lg border border-[#e2e5e8] px-4 py-2.5 text-[11px] font-semibold text-[#555e68] hover:bg-[#f7f8fa] disabled:opacity-50">{busy === "search" ? "Buscando…" : "Consultar"}</button>
        </form>
        {customer ? (
          <div className="mt-5 rounded-lg border border-[#eff0f2] bg-[#fafbfc] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[9px] font-bold tracking-[0.12em] text-[#16a36a]">CLIENTE REGISTRADO</p>
                <h3 className="mt-2 text-[15px] font-bold text-[#252a30]">{customer.data.nombreCliente}</h3>
                <p className="mt-1 text-[10px] text-[#737b84]">C.I. {customer.data.cedulaCliente}</p>
              </div>
              <span className="rounded-md bg-white px-2 py-1 text-[9px] font-bold text-[#737b84]">ID #{customer.data.idCliente}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-white p-3"><p className="text-[9px] text-[#9299a1]">Motos asociadas</p><p className="mt-1 text-[18px] font-bold text-[#252a30]">{customer.data.totalMotosCliente}</p></div>
              <div className="rounded-lg bg-white p-3"><p className="text-[9px] text-[#9299a1]">Concesionario</p><p className="mt-1 truncate text-[11px] font-semibold text-[#252a30]">{nombreConcesionario}</p></div>
            </div>
            <p className="mt-3 text-[9px] text-[#9299a1]">PDA: <a href={`https://explorer.solana.com/address/${customer.address}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="break-all font-mono text-[#68717b] underline decoration-dotted underline-offset-2 transition hover:text-[#e60012]">{customer.address} ↗</a></p>
            <CustomerWalletLink cliente={customer.address} concesionario={concesionario} totalMotos={Number(customer.data.totalMotosCliente)} />
          </div>
        ) : (
          <div className="mt-5 flex min-h-[170px] flex-col items-center justify-center rounded-lg bg-[#f7f8fa] px-5 text-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-lg text-[#9aa1a9]">♙</div>
            <p className="mt-3 text-[11px] font-semibold text-[#515962]">Sin cliente seleccionado</p>
            <p className="mt-1 max-w-[230px] text-[10px] leading-relaxed text-[#9aa1a9]">Introduce una cédula para consultar una cuenta Cliente existente.</p>
          </div>
        )}
      </section>
    </div>
  );
}
