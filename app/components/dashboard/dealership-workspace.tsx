"use client";

import { useCallback, useEffect, useState } from "react";
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
  deriveConcesionarioPda,
  deriveRegistroGlobalPda,
} from "../../lib/moto-ledger/pdas";
import {
  getConcesionarioDecoder,
  getConcesionarioDiscriminatorBytes,
  type Concesionario,
} from "../../lib/moto-ledger/src/generated/accounts/concesionario";
import { REGISTRO_PROGRAM_ADDRESS } from "../../lib/moto-ledger/src/generated/programs";
import {
  getAsociacionClienteDecoder,
  getAsociacionClienteDiscriminatorBytes,
} from "../../lib/moto-ledger/src/generated/accounts/asociacionCliente";
import { MotorcycleRegistration } from "./motorcycle-registration";
import { MotorcycleCatalog } from "./motorcycle-catalog";
import { CustomerManagement } from "./customer-management";
import { SalesManagement } from "./sales-management";
import { ServicesManagement } from "./services-management";
import { SettingsManagement } from "./settings-management";
import { LoyaltyManagement } from "./loyalty-management";

type DealershipRecord = { address: string; data: Concesionario };

function shortAddress(value: string) {
  return `${value.slice(0, 5)}…${value.slice(-5)}`;
}

export function DealershipWorkspace({
  activeModule,
  onNavigate,
}: {
  activeModule: string;
  onNavigate: (module: string) => void;
}) {
  const client = useAppClient();
  const connected = useConnectedWallet(client);
  const walletAddress = connected?.account.address;
  const [name, setName] = useState("");
  const [rif, setRif] = useState("");
  const [dealerships, setDealerships] = useState<DealershipRecord[]>([]);
  const [dealership, setDealership] = useState<DealershipRecord | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loadingDealerships, setLoadingDealerships] = useState(false);
  const [loadingSelectedDealership, setLoadingSelectedDealership] = useState(false);
  const [busy, setBusy] = useState<"create" | null>(null);
  const [catalogRefreshKey, setCatalogRefreshKey] = useState(0);
  const [associatedCustomerCount, setAssociatedCustomerCount] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadDealerships = useCallback(async () => {
    if (!walletAddress) {
      setDealerships([]);
      setDealership(null);
      return;
    }

    setLoadingDealerships(true);
    try {
      // RPC memcmp filters require encoded strings, not raw byte arrays.
      const ownerFilter = address(walletAddress) as Base58EncodedBytes;
      const discriminatorFilter = getBase58Decoder().decode(
        getConcesionarioDiscriminatorBytes()
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

      const found: DealershipRecord[] = results.map((result) => ({
        address: result.pubkey,
        data: getConcesionarioDecoder().decode(
          getBase64Encoder().encode(result.account.data[0])
        ),
      }));

      found.sort((a, b) => a.data.idConcesionario - b.data.idConcesionario);
      setDealerships(found);
      setDealership((current) =>
        found.find((item) => item.address === current?.address) ?? null
      );
      if (found.length > 0) setShowCreate(false);
    } catch (error) {
      console.error("No se pudieron cargar los concesionarios:", error);
      toast.error("No se pudieron consultar tus concesionarios en Solana.");
    } finally {
      setLoadingDealerships(false);
    }
  }, [client, walletAddress]);

  useEffect(() => {
    void loadDealerships();
  }, [loadDealerships]);

  const refreshDealership = useCallback(async (targetAddress: string) => {
    const refreshed = await client.registro.accounts.concesionario.fetch(
      address(targetAddress)
    );
    const record = { address: targetAddress, data: refreshed.data };

    setDealership((current) =>
      current?.address === targetAddress ? record : current
    );
    setDealerships((current) =>
      current.map((item) => item.address === targetAddress ? record : item)
    );

    return record;
  }, [client]);

  // Each module has its own dealership selection. Entering a module
  // clears the previous selection so the user explicitly selects it again.
  useEffect(() => {
    setDealership(null);
    setAssociatedCustomerCount(null);
    setLoadingSelectedDealership(false);
  }, [activeModule]);

  const handleSelectDealership = useCallback(async (selectedAddress: string) => {
    if (!selectedAddress) {
      setDealership(null);
      setAssociatedCustomerCount(null);
      return;
    }

    setDealership(null);
    setAssociatedCustomerCount(null);
    setLoadingSelectedDealership(true);

    try {
      // Always fetch the account from Solana on selection; do not rely on
      // the possibly stale copy used to populate the dropdown.
      const refreshed = await client.registro.accounts.concesionario.fetch(
        address(selectedAddress)
      );
      const record = { address: selectedAddress, data: refreshed.data };

      setDealerships((current) =>
        current.map((item) => item.address === selectedAddress ? record : item)
      );
      setDealership(record);
    } catch (error) {
      console.error("No se pudo consultar el concesionario seleccionado:", error);
      toast.error("No se pudo consultar el estado actualizado del concesionario en Solana.");
    } finally {
      setLoadingSelectedDealership(false);
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;

    async function loadAssociatedCustomerCount() {
      if (!dealership?.address || !walletAddress) {
        setAssociatedCustomerCount(null);
        return;
      }

      try {
        const discriminatorFilter = getBase58Decoder().decode(
          getAsociacionClienteDiscriminatorBytes()
        ) as Base58EncodedBytes;
        const dealerFilter = address(dealership.address) as Base58EncodedBytes;
        const ownerFilter = address(walletAddress) as Base58EncodedBytes;
        const results = await client.rpc.getProgramAccounts(
          REGISTRO_PROGRAM_ADDRESS,
          {
            encoding: "base64",
            filters: [
              { memcmp: { offset: 0n, bytes: discriminatorFilter, encoding: "base58" } },
              { memcmp: { offset: 8n, bytes: ownerFilter, encoding: "base58" } },
              { memcmp: { offset: 40n, bytes: dealerFilter, encoding: "base58" } },
            ],
          }
        ).send();

        const count = results.reduce((total, result) => {
          const association = getAsociacionClienteDecoder().decode(
            getBase64Encoder().encode(result.account.data[0])
          );
          return total + (association.activo ? 1 : 0);
        }, 0);

        if (!cancelled) setAssociatedCustomerCount(count);
      } catch (error) {
        console.error("No se pudo consultar el total de clientes asociados:", error);
        if (!cancelled) setAssociatedCustomerCount(null);
      }
    }

    void loadAssociatedCustomerCount();
    return () => { cancelled = true; };
  }, [client, dealership?.address, walletAddress]);

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!connected?.signer) {
      toast.error("La wallet conectada no permite firmar transacciones.");
      return;
    }
    if (name.trim().length < 3 || rif.trim().length < 3) {
      toast.error("Completa el nombre y el RIF del concesionario.");
      return;
    }

    setBusy("create");
    try {
      const [registroGlobal] = await deriveRegistroGlobalPda();
      const [concesionario] = await deriveConcesionarioPda(
        name.trim(),
        address(connected.account.address)
      );
      const existing = await client.registro.accounts.concesionario
        .fetch(concesionario)
        .catch(() => null);

      if (existing) {
        await loadDealerships();
        setDealership({ address: concesionario, data: existing.data });
        setShowCreate(false);
        toast.info("Este concesionario ya estaba registrado y fue seleccionado.");
        return;
      }

      const instruction = client.registro.instructions.registrarConcesionario({
        owner: connected.signer,
        registroGlobal,
        concesionario,
        nombreConcesionario: name.trim(),
        rifConcesionario: rif.trim(),
      });
      const result = await instruction.sendTransaction();
      notifyTransactionSuccess(
        "Concesionario registrado y seleccionado.",
        result.context.signature
      );
      const created = await client.registro.accounts.concesionario.fetch(concesionario);
      const record = { address: concesionario, data: created.data };
      setDealerships((current) => [...current, record].sort(
        (a, b) => a.data.idConcesionario - b.data.idConcesionario
      ));
      setDealership(record);
      setShowCreate(false);
      setName("");
      setRif("");

    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo registrar el concesionario."
      );
    } finally {
      setBusy(null);
    }
  };

  // Keep the server render and the first client render identical. Wallet
  // extensions can expose the connected account before hydration completes.
  if (!mounted) {
    return (
      <section className="rounded-xl border border-[#e9ebee] bg-white p-7 shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
        <div className="h-11 w-11 animate-pulse rounded-xl bg-[#f7f8fa]" />
        <div className="mt-4 h-4 w-56 animate-pulse rounded bg-[#f1f2f4]" />
        <div className="mt-3 h-3 w-full max-w-lg animate-pulse rounded bg-[#f7f8fa]" />
      </section>
    );
  }

  if (!connected) {
    return (
      <section className="rounded-xl border border-[#e9ebee] bg-white p-7 shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#fff0f1] text-xl text-[#e60012]">⌂</div>
        <h2 className="mt-4 text-[15px] font-bold text-[#252a30]">Conecta tu wallet para comenzar</h2>
        <p className="mt-2 max-w-lg text-[11px] leading-relaxed text-[#858d96]">
          Tu wallet identifica al propietario del concesionario y firma las operaciones que se registran en el programa MotoLedger.
        </p>
      </section>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)]">
      <section className="rounded-xl border border-[#e9ebee] bg-white p-6 shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">ESPACIO DE TRABAJO</p>
            <h2 className="mt-2 text-[16px] font-bold text-[#252a30]">Selecciona tu concesionario</h2>
            <p className="mt-1 text-[11px] text-[#858d96]">Cargamos automáticamente los concesionarios registrados por esta wallet.</p>
          </div>
          <button type="button" onClick={() => void loadDealerships()} disabled={loadingDealerships} className="rounded-lg border border-[#e2e5e8] px-3 py-2 text-[10px] font-semibold text-[#555e68] hover:bg-[#f7f8fa] disabled:opacity-50">
            {loadingDealerships ? "Actualizando…" : "Actualizar"}
          </button>
        </div>

        {dealerships.length > 0 && (
          <div className="mt-5">
            <label className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Concesionarios de esta wallet</label>
            <select
              value={dealership?.address ?? ""}
              onChange={(event) => void handleSelectDealership(event.target.value)}
              disabled={loadingSelectedDealership}
              className="w-full rounded-lg border border-[#e2e5e8] bg-white px-3 py-3 text-[12px] text-[#252a30] outline-none focus:border-[#e60012]"
            >
              <option value="">Selecciona un concesionario</option>
              {dealerships.map((item) => (
                <option key={item.address} value={item.address}>
                  {item.data.nombreConcesionario} · {item.data.rifConcesionario}
                </option>
              ))}
            </select>
            <p className="mt-2 text-[9px] text-[#a0a6ad]">{dealerships.length} concesionario(s) encontrados en la red seleccionada.</p>
          </div>
        )}

        {loadingSelectedDealership && (
          <div className="mt-5 rounded-lg bg-[#f7f8fa] p-5 text-center text-[11px] text-[#858d96]">
            Consultando el estado actualizado del concesionario en Solana…
          </div>
        )}

        {loadingDealerships && dealerships.length === 0 ? (
          <div className="mt-5 rounded-lg bg-[#f7f8fa] p-5 text-center text-[11px] text-[#858d96]">Consultando tus concesionarios en Solana…</div>
        ) : dealerships.length === 0 && !showCreate ? (
          <div className="mt-5 rounded-lg bg-[#f7f8fa] p-5 text-center">
            <p className="text-[11px] font-semibold text-[#515962]">No encontramos concesionarios para esta wallet.</p>
            <p className="mt-1 text-[10px] text-[#9aa1a9]">{activeModule === "settings" ? "Registra tu primer concesionario para comenzar." : "El registro de concesionarios se realiza desde Configuración."}</p>
          </div>
        ) : null}

        {activeModule === "settings" && (showCreate || (dealerships.length === 0 && !loadingDealerships)) ? (
          <form onSubmit={handleCreate} className="mt-5 space-y-4 border-t border-[#eff0f2] pt-5">
            <div>
              <h3 className="text-[12px] font-bold text-[#252a30]">Registrar nuevo concesionario</h3>
              <p className="mt-1 text-[10px] text-[#858d96]">Solo necesitarás estos datos la primera vez.</p>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Nombre del concesionario</span>
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={30} placeholder="Ej. Moto Center Sucre" className="w-full rounded-lg border border-[#e2e5e8] px-3 py-2.5 text-[12px] outline-none focus:border-[#e60012]" required />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">RIF del concesionario</span>
              <input value={rif} onChange={(event) => setRif(event.target.value)} maxLength={10} placeholder="J123456789" className="w-full rounded-lg border border-[#e2e5e8] px-3 py-2.5 text-[12px] outline-none focus:border-[#e60012]" required />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={busy !== null} className="rounded-lg bg-[#e60012] px-4 py-2.5 text-[11px] font-semibold text-white hover:bg-[#c90010] disabled:opacity-50">{busy === "create" ? "Enviando transacción…" : "Registrar concesionario"}</button>
              {dealerships.length > 0 && <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border border-[#e2e5e8] px-4 py-2.5 text-[11px] font-semibold text-[#555e68]">Cancelar</button>}
            </div>
          </form>
        ) : activeModule === "settings" ? (
          <button type="button" onClick={() => setShowCreate(true)} className="mt-4 rounded-lg border border-dashed border-[#d9dde1] px-4 py-2.5 text-[10px] font-semibold text-[#68717b] hover:border-[#e60012] hover:text-[#e60012]">
            + Registrar otro concesionario
          </button>
        ) : dealerships.length === 0 && !loadingDealerships ? (
          <div className="mt-5 rounded-lg border border-dashed border-[#e2e5e8] p-5 text-center">
            <p className="text-[11px] font-semibold text-[#515962]">Primero configura tu concesionario.</p>
            <p className="mt-1 text-[10px] text-[#9aa1a9]">El registro y la política de garantía se administran desde Configuración.</p>
            <button type="button" onClick={() => onNavigate("settings")} className="mt-3 rounded-lg bg-[#e60012] px-4 py-2.5 text-[10px] font-semibold text-white hover:bg-[#c90010]">
              Ir a Configuración
            </button>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-[#e9ebee] bg-white p-6 shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-bold text-[#252a30]">Estado on-chain</h2>
          <span className="flex items-center gap-1.5 text-[9px] font-semibold text-[#16a36a]"><span className="h-1.5 w-1.5 rounded-full bg-[#16a36a]" /> WALLET CONECTADA</span>
        </div>
        {dealership ? (
          <>
            <div className="mt-5 rounded-lg bg-[#f7f8fa] p-4">
              <p className="text-[9px] font-bold tracking-[0.12em] text-[#9299a1]">CONCESIONARIO SELECCIONADO</p>
              <p className="mt-2 text-[15px] font-bold text-[#252a30]">{dealership.data.nombreConcesionario}</p>
              <p className="mt-1 text-[10px] text-[#858d96]">{dealership.data.rifConcesionario}</p>
              <a href={`https://explorer.solana.com/address/${dealership.address}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex break-all font-mono text-[9px] text-[#68717b] underline decoration-dotted underline-offset-2 transition hover:text-[#e60012]">{dealership.address}<span className="ml-1 shrink-0">↗</span></a>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-[#eff0f2] p-3"><p className="text-[9px] text-[#9299a1]">Garantía (días)</p><p className="mt-1 text-[18px] font-bold text-[#252a30]">{dealership.data.duracionGarantiaDias}</p></div>
              <div className="rounded-lg border border-[#eff0f2] p-3"><p className="text-[9px] text-[#9299a1]">Km máximos</p><p className="mt-1 text-[18px] font-bold text-[#252a30]">{dealership.data.kilometrajeMaximo.toLocaleString("es-VE")}</p></div>
            </div>
            {dealership.data.duracionGarantiaDias < 1 || dealership.data.kilometrajeMaximo < 1n ? (
              <div className="mt-4 rounded-lg border border-[#f1dfe0] bg-[#fff9f9] p-3">
                <p className="text-[10px] font-bold text-[#8e343b]">Configuración de garantía pendiente</p>
                <p className="mt-1 text-[9px] leading-relaxed text-[#95666a]">Define la duración y el kilometraje máximo antes de registrar motos para este concesionario.</p>
                {activeModule !== "settings" && (
                  <button type="button" onClick={() => onNavigate("settings")} className="mt-2 rounded-md bg-[#e60012] px-3 py-2 text-[9px] font-semibold text-white hover:bg-[#c90010]">
                    Configurar garantía
                  </button>
                )}
              </div>
            ) : null}
            <p className="mt-4 text-[10px] leading-relaxed text-[#737b84]">{dealership.data.totalMotos.toString()} motos · {associatedCustomerCount === null ? "…" : associatedCustomerCount} clientes asociados · {dealership.data.totalVentas.toString()} ventas · {dealership.data.totalServicios.toString()} servicios.</p>
            <p className="mt-2 text-[9px] text-[#a0a6ad]">Cuenta: {shortAddress(dealership.address)}</p>
          </>
        ) : (
          <div className="flex min-h-[230px] flex-col items-center justify-center text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f7f8fa] text-lg text-[#9aa1a9]">⌂</div>
            <p className="mt-3 text-[11px] font-semibold text-[#515962]">Sin concesionario seleccionado</p>
            <p className="mt-1 max-w-[240px] text-[10px] leading-relaxed text-[#9aa1a9]">Selecciona un concesionario o registra uno nuevo.</p>
          </div>
        )}
      </section>

      {dealership && activeModule === "motorcycles" && (
        <div className="xl:col-span-2">
          <MotorcycleRegistration
            concesionario={dealership.address}
            nombreConcesionario={dealership.data.nombreConcesionario}
            onRegistered={async () => {
              setCatalogRefreshKey((current) => current + 1);
              await refreshDealership(dealership.address);
            }}
          />
          <div className="mt-4">
            <MotorcycleCatalog
              concesionario={dealership.address}
              refreshKey={catalogRefreshKey}
              nombreConcesionario={dealership.data.nombreConcesionario}
              onDeleted={async () => {
                await refreshDealership(dealership.address);
              }}
            />
          </div>
        </div>
      )}
      {dealership && activeModule === "customers" && (
        <div className="xl:col-span-2">
          <CustomerManagement
            concesionario={dealership.address}
            nombreConcesionario={dealership.data.nombreConcesionario}
            onRegistered={async () => {
              await refreshDealership(dealership.address);
            }}
          />
        </div>
      )}

      {dealership && activeModule === "sales" && (
        <div className="xl:col-span-2">
          <SalesManagement
            concesionario={dealership.address}
            nombreConcesionario={dealership.data.nombreConcesionario}
            onNavigate={onNavigate}
            onRegistered={async () => {
              await refreshDealership(dealership.address);
            }}
          />
        </div>
      )}


      {dealership && activeModule === "loyalty" && (
        <div className="xl:col-span-2">
          <LoyaltyManagement
            key={`${dealership.address}:${activeModule}`}
            concesionario={dealership.address}
            nombreConcesionario={dealership.data.nombreConcesionario}
          />
        </div>
      )}

      {dealership && activeModule === "settings" && (
        <div className="xl:col-span-2">
          <SettingsManagement
            concesionario={dealership.address}
            data={dealership.data}
            onUpdated={async () => {
              await refreshDealership(dealership.address);
            }}
          />
        </div>
      )}

      {dealership && activeModule === "services" && (
        <div className="xl:col-span-2">
          <ServicesManagement
            concesionario={dealership.address}
            nombreConcesionario={dealership.data.nombreConcesionario}
            onRegistered={async () => {
              await refreshDealership(dealership.address);
            }}
          />
        </div>
      )}
    </div>
  );
}
