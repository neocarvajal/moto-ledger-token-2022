"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
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
import { deriveClientePda, deriveProgramaFidelidadPda, deriveToken2022Ata, deriveWalletClientePda } from "../../lib/moto-ledger/pdas";
import { CustomerWalletLink } from "./customer-wallet-link";
import { type Cliente } from "../../lib/moto-ledger/src/generated/accounts/cliente";
import { REGISTRO_PROGRAM_ADDRESS } from "../../lib/moto-ledger/src/generated/programs";
import { getAsociacionClienteDecoder, getAsociacionClienteDiscriminatorBytes } from "../../lib/moto-ledger/src/generated/accounts/asociacionCliente";

type CustomerRecord = { address: ReturnType<typeof address>; data: Cliente };

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
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [busy, setBusy] = useState<"register" | "search" | null>(null);
  const [loyaltyBalance, setLoyaltyBalance] = useState<bigint | null>(null);
  const [loyaltyStatus, setLoyaltyStatus] = useState<"idle" | "loading" | "ready" | "unlinked" | "unavailable" | "outside_dealership">("idle");

  const loadCustomers = useCallback(async () => {
    if (!connected?.account.address || !concesionario) {
      setCustomers([]);
      return;
    }

    setLoadingCustomers(true);
    try {
      const ownerAddress = address(connected.account.address);
      const dealerAddress = address(concesionario);
      const discriminatorFilter = getBase58Decoder().decode(
        getAsociacionClienteDiscriminatorBytes()
      ) as Base58EncodedBytes;
      const dealerFilter = dealerAddress as Base58EncodedBytes;
      const associations = await client.rpc
        .getProgramAccounts(REGISTRO_PROGRAM_ADDRESS, {
          encoding: "base64",
          filters: [
            { memcmp: { offset: 0n, bytes: discriminatorFilter, encoding: "base58" } },
            { memcmp: { offset: 40n, bytes: dealerFilter, encoding: "base58" } },
          ],
        })
        .send();

      const customerAddresses = [...new Set(
        associations.map((association) =>
          getAsociacionClienteDecoder().decode(
            getBase64Encoder().encode(association.account.data[0])
          ).cliente
        )
      )];

      const records = await Promise.all(
        customerAddresses.map(async (customerAddress) => {
          try {
            const account = await client.registro.accounts.cliente.fetch(address(customerAddress));
            if (account.data.owner !== ownerAddress) return null;
            return { address: customerAddress, data: account.data } satisfies CustomerRecord;
          } catch {
            return null;
          }
        })
      );
      const found = records
        .filter((record) => record !== null)
        .sort((a, b) => a.data.idCliente - b.data.idCliente);

      setCustomers(found);
    } catch (error) {
      console.error("No se pudieron cargar los clientes del concesionario:", error);
      toast.error("No se pudieron consultar los clientes con ventas en este concesionario.");
    } finally {
      setLoadingCustomers(false);
    }
  }, [client, connected?.account.address, concesionario]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  useEffect(() => {
    let cancelled = false;
    async function loadLoyaltyBalance() {
      setLoyaltyBalance(null);
      if (!customer) {
        setLoyaltyStatus("idle");
        return;
      }
      if (!customers.some((item) => item.address === customer.address)) {
        setLoyaltyStatus("outside_dealership");
        return;
      }
      setLoyaltyStatus("loading");
      try {
        const [walletPda] = await deriveWalletClientePda(address(customer.address));
        const [programPda] = await deriveProgramaFidelidadPda(address(concesionario));
        const [walletInfo, programInfo] = await Promise.all([
          client.registro.accounts.walletCliente.fetch(walletPda).catch(() => null),
          client.rpc.getAccountInfo(programPda, { encoding: "base64" }).send(),
        ]);
        if (!walletInfo) {
          if (!cancelled) setLoyaltyStatus("unlinked");
          return;
        }
        if (!programInfo.value) {
          if (!cancelled) setLoyaltyStatus("unavailable");
          return;
        }
        const program = await client.registro.accounts.programaFidelidad.fetch(programPda);
        const [ata] = await deriveToken2022Ata(address(walletInfo.data.wallet), address(program.data.mint));
        const tokenAccountInfo = await client.rpc.getAccountInfo(ata, { encoding: "base64" }).send();
        if (!tokenAccountInfo.value) {
          if (!cancelled) {
            setLoyaltyBalance(0n);
            setLoyaltyStatus("ready");
          }
          return;
        }
        const tokenBalance = await client.rpc.getTokenAccountBalance(ata).send();
        if (!cancelled) {
          setLoyaltyBalance(BigInt(tokenBalance.value.amount));
          setLoyaltyStatus("ready");
        }
      } catch (error) {
        console.error("No se pudo consultar el saldo de fidelización:", error);
        if (!cancelled) setLoyaltyStatus("unavailable");
      }
    }
    void loadLoyaltyBalance();
    return () => { cancelled = true; };
  }, [client, concesionario, customer, customers]);

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
      const record = { address: cliente, data: created.data };
      if (existing && existing.data.nombreCliente !== created.data.nombreCliente) {
        toast.info("El cliente ya existía; se añadió su asociación al concesionario sin modificar sus datos globales.");
      }
      setCustomer(record);
      setCustomers((current) =>
        [...current.filter((item) => item.address !== cliente), record]
          .sort((a, b) => a.data.idCliente - b.data.idCliente)
      );
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
        <p className="mt-1 text-[10px] text-[#858d96]">El listado corresponde al concesionario seleccionado; la búsqueda por cédula es independiente y puede consultar cualquier cliente de esta wallet.</p>
        <div className="mt-5">
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <label htmlFor="registered-customer" className="block text-[10px] font-semibold text-[#555e68]">Clientes con ventas en este concesionario</label>
            <button type="button" onClick={() => void loadCustomers()} disabled={loadingCustomers} className="text-[10px] font-semibold text-[#68717b] hover:text-[#e60012] disabled:opacity-50">
              {loadingCustomers ? "Actualizando…" : "Actualizar"}
            </button>
          </div>
          {customers.length > 0 ? (
            <select
              id="registered-customer"
              value={customers.some((item) => item.address === customer?.address) ? customer?.address ?? "" : ""}
              onChange={(event) => {
                const selected = customers.find((item) => item.address === event.target.value) ?? null;
                setCustomer(selected);
                if (selected) setSearchCedula(String(selected.data.cedulaCliente));
              }}
              className="w-full rounded-lg border border-[#e2e5e8] bg-white px-3 py-3 text-[11px] text-[#252a30] outline-none focus:border-[#e60012]"
            >
              <option value="">Selecciona un cliente</option>
              {customers.map((item) => (
                <option key={item.address} value={item.address}>
                  {item.data.nombreCliente} · C.I. {item.data.cedulaCliente}
                </option>
              ))}
            </select>
          ) : (
            <div className="rounded-lg bg-[#f7f8fa] px-3 py-3 text-[10px] text-[#858d96]">
              {loadingCustomers ? "Consultando clientes de este concesionario en Solana…" : "Todavía no hay clientes con ventas registradas en este concesionario."}
            </div>
          )}
          {customers.length > 0 && (
            <p className="mt-2 text-[9px] text-[#a0a6ad]">{customers.length} cliente(s) con ventas en {nombreConcesionario}.</p>
          )}
          <p className="mt-2 text-[9px] leading-relaxed text-[#9299a1]">Este listado solo incluye clientes que tienen al menos una venta en el concesionario seleccionado. La búsqueda por cédula consulta el registro global de clientes de esta wallet, sin depender del concesionario seleccionado.</p>
        </div>
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
              <div className="rounded-lg bg-white p-3"><p className="text-[9px] text-[#9299a1]">Contexto de consulta</p><p className="mt-1 truncate text-[11px] font-semibold text-[#252a30]">{customers.some((item) => item.address === customer.address) ? nombreConcesionario : "Búsqueda global por cédula"}</p></div>
            </div>
            <p className="mt-3 text-[9px] text-[#9299a1]">PDA: <a href={`https://explorer.solana.com/address/${customer.address}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="break-all font-mono text-[#68717b] underline decoration-dotted underline-offset-2 transition hover:text-[#e60012]">{customer.address} ↗</a></p>
            <div className="mt-3 rounded-lg border border-[#e7eaed] bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[9px] font-bold tracking-[0.1em] text-[#9299a1]">FIDELIZACIÓN TOKEN-2022</p>
                  <p className="mt-1 text-[10px] text-[#68717b]">Saldo acumulado del cliente en este concesionario</p>
                </div>
                <div className="text-right">
                  {loyaltyStatus === "loading" ? (
                    <p className="text-[10px] text-[#9299a1]">Consultando…</p>
                  ) : loyaltyStatus === "ready" ? (
                    <p className="text-[20px] font-bold text-[#252a30]">{(loyaltyBalance ?? 0n).toLocaleString("es-VE")} <span className="text-[10px] font-semibold text-[#68717b]">puntos</span></p>
                  ) : loyaltyStatus === "unlinked" ? (
                    <p className="text-[10px] font-semibold text-[#b7791f]">Wallet no vinculada</p>
                  ) : loyaltyStatus === "unavailable" ? (
                    <p className="text-[10px] text-[#9299a1]">Programa no disponible</p>
                  ) : (
                    <p className="text-[10px] text-[#9299a1]">—</p>
                  )}
                </div>
              </div>
            </div>
            <CustomerWalletLink cliente={customer.address} clienteNombre={customer.data.nombreCliente} clienteCedula={String(customer.data.cedulaCliente)} concesionario={concesionario} totalMotos={Number(customer.data.totalMotosCliente)} />
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
