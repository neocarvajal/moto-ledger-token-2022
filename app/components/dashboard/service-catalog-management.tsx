"use client";

import { useCallback, useEffect, useState } from "react";
import { address } from "@solana/kit";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import { toast } from "sonner";
import { useAppClient } from "../../lib/client-provider";
import { deriveCatalogoServiciosPda } from "../../lib/moto-ledger/pdas";

type CatalogService = {
  id: number;
  nombre: string;
  descripcion: string;
  puntos: bigint;
  activo: boolean;
};

export function ServiceCatalogManagement({
  concesionario,
}: {
  concesionario: string;
}) {
  const client = useAppClient();
  const connected = useConnectedWallet(client);
  const [catalogAddress, setCatalogAddress] = useState<string | null>(null);
  const [services, setServices] = useState<CatalogService[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setMissing(false);
    try {
      const [catalogPda] = await deriveCatalogoServiciosPda(address(concesionario));
      setCatalogAddress(catalogPda);
      const account = await client.registro.accounts.catalogoServicios.fetch(catalogPda);
      setServices(account.data.servicios);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (
        message.includes("account not found") ||
        message.includes("could not find") ||
        message.includes("does not exist") ||
        message.includes("not found")
      ) {
        setMissing(true);
        setServices([]);
      } else {
        console.error("No se pudo consultar el catálogo de servicios:", error);
        toast.error("No se pudo consultar el catálogo de servicios en Solana.");
      }
    } finally {
      setLoading(false);
    }
  }, [client, concesionario]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const initializeCatalog = async () => {
    if (!connected?.signer || !connected.account) {
      toast.error("Conecta la wallet propietaria del concesionario.");
      return;
    }
    setBusy(true);
    try {
      const dealership = await client.registro.accounts.concesionario.fetch(address(concesionario));
      if (dealership.data.owner !== connected.account.address) {
        throw new Error("La wallet conectada no es propietaria de este concesionario.");
      }
      const [catalogPda] = await deriveCatalogoServiciosPda(address(concesionario));
      const instruction = client.registro.instructions.inicializarCatalogoServicios({
        owner: connected.signer,
        concesionario: address(concesionario),
        catalogoServicios: catalogPda,
      });
      const result = await instruction.sendTransaction();
      toast.success("Catálogo inicial creado para este concesionario.");
      if (result?.context?.signature) {
        console.info("Catálogo de servicios:", result.context.signature);
      }
      await loadCatalog();
    } catch (error) {
      console.error("No se pudo inicializar el catálogo:", error);
      toast.error(error instanceof Error ? error.message : "No se pudo crear el catálogo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-4 rounded-xl border border-[#e9ebee] bg-white p-5 shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">FIDELIZACIÓN / CANJES</p>
          <h3 className="mt-2 text-[13px] font-bold text-[#252a30]">Catálogo de servicios</h3>
          <p className="mt-1 max-w-xl text-[10px] leading-relaxed text-[#858d96]">
            Cada concesionario administra su propio catálogo. Los precios se expresan en puntos del mint Token-2022 asociado a su programa de fidelización.
          </p>
        </div>
        <button type="button" onClick={() => void loadCatalog()} disabled={loading || busy} className="rounded-lg border border-[#e2e5e8] px-3 py-2 text-[9px] font-semibold text-[#555e68] hover:bg-[#f7f8fa] disabled:opacity-50">
          Actualizar
        </button>
      </div>

      {loading ? (
        <p className="mt-4 rounded-lg bg-[#f7f8fa] p-4 text-[10px] text-[#858d96]">Consultando catálogo en Solana…</p>
      ) : missing ? (
        <div className="mt-4 rounded-lg border border-dashed border-[#e2e5e8] bg-[#fafbfc] p-4">
          <p className="text-[11px] font-semibold text-[#252a30]">Este concesionario aún no tiene un catálogo.</p>
          <p className="mt-1 text-[10px] leading-relaxed text-[#858d96]">Puedes crear el catálogo inicial con cuatro servicios de ejemplo. Después podrás personalizar los servicios y sus puntos.</p>
          <button type="button" onClick={() => void initializeCatalog()} disabled={busy || !connected?.signer} className="mt-3 rounded-lg bg-[#e60012] px-4 py-2.5 text-[10px] font-semibold text-white hover:bg-[#c90010] disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? "Creando catálogo…" : "Crear catálogo inicial"}
          </button>
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {services.map((service) => (
              <div key={service.id} className="rounded-lg border border-[#eff0f2] p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] font-semibold text-[#252a30]">{service.nombre}</p>
                  <span className={service.activo ? "rounded-full bg-[#edf8f2] px-2 py-1 text-[8px] font-semibold text-[#168451]" : "rounded-full bg-[#f3f4f6] px-2 py-1 text-[8px] font-semibold text-[#858d96]"}>
                    {service.activo ? "Disponible" : "Desactivado"}
                  </span>
                </div>
                <p className="mt-1 text-[9px] leading-relaxed text-[#858d96]">{service.descripcion}</p>
                <p className="mt-3 text-[15px] font-bold tabular-nums text-[#252a30]">{service.puntos.toString()} <span className="text-[9px] font-medium text-[#858d96]">puntos</span></p>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-lg bg-[#f7f8fa] p-3">
            <p className="break-all font-mono text-[9px] text-[#858d96]">Catálogo PDA: {catalogAddress}</p>
            <p className="mt-1 text-[9px] text-[#858d96]">Los servicios y precios pertenecen únicamente a este concesionario.</p>
          </div>
        </>
      )}
    </section>
  );
}
