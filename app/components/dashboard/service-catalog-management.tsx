"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
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

type ServiceForm = {
  nombre: string;
  descripcion: string;
  puntos: string;
  activo: boolean;
};

const EMPTY_FORM: ServiceForm = {
  nombre: "",
  descripcion: "",
  puntos: "",
  activo: true,
};

const MAX_SERVICES = 8;

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
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<ServiceForm>(EMPTY_FORM);

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

  const assertOwner = async () => {
    if (!connected?.signer || !connected.account) {
      throw new Error("Conecta la wallet propietaria del concesionario.");
    }
    const dealership = await client.registro.accounts.concesionario.fetch(
      address(concesionario)
    );
    if (dealership.data.owner !== connected.account.address) {
      throw new Error("La wallet conectada no es propietaria de este concesionario.");
    }
  };

  const initializeCatalog = async () => {
    setBusy(true);
    try {
      await assertOwner();
      const [catalogPda] = await deriveCatalogoServiciosPda(address(concesionario));
      await client.registro.instructions.inicializarCatalogoServicios({
        owner: connected!.signer!,
        concesionario: address(concesionario),
        catalogoServicios: catalogPda,
      }).sendTransaction();
      toast.success("Catálogo inicial creado para este concesionario.");
      await loadCatalog();
    } catch (error) {
      console.error("No se pudo inicializar el catálogo:", error);
      toast.error(error instanceof Error ? error.message : "No se pudo crear el catálogo.");
    } finally {
      setBusy(false);
    }
  };

  const startEditing = (service: CatalogService) => {
    setEditingId(service.id);
    setFormOpen(true);
    setForm({
      nombre: service.nombre,
      descripcion: service.descripcion,
      puntos: service.puntos.toString(),
      activo: service.activo,
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setFormOpen(false);
    setForm(EMPTY_FORM);
  };

  const submitService = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nombre = form.nombre.trim();
    const descripcion = form.descripcion.trim();
    const puntos = Number(form.puntos);

    if (!nombre || nombre.length > 40) {
      toast.error("El nombre debe tener entre 1 y 40 caracteres.");
      return;
    }
    if (descripcion.length > 100) {
      toast.error("La descripción no puede superar 100 caracteres.");
      return;
    }
    if (!Number.isSafeInteger(puntos) || puntos <= 0) {
      toast.error("Los puntos deben ser un número entero mayor a cero.");
      return;
    }

    setBusy(true);
    try {
      await assertOwner();
      const [catalogPda] = await deriveCatalogoServiciosPda(address(concesionario));

      if (editingId !== null) {
        await client.registro.instructions.actualizarServicioCatalogo({
          owner: connected!.signer!,
          concesionario: address(concesionario),
          catalogoServicios: catalogPda,
          servicioId: editingId,
          nombre,
          descripcion,
          puntos: BigInt(puntos),
          activo: form.activo,
        }).sendTransaction();
        toast.success("Servicio actualizado en el catálogo.");
      } else {
        if (services.length >= MAX_SERVICES) {
          throw new Error("El catálogo alcanzó el máximo de 8 servicios.");
        }
        await client.registro.instructions.agregarServicioCatalogo({
          owner: connected!.signer!,
          concesionario: address(concesionario),
          catalogoServicios: catalogPda,
          nombre,
          descripcion,
          puntos: BigInt(puntos),
          activo: form.activo,
        }).sendTransaction();
        toast.success("Servicio agregado al catálogo.");
      }

      resetForm();
      await loadCatalog();
    } catch (error) {
      console.error("No se pudo guardar el servicio:", error);
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el servicio.");
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
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] text-[#858d96]">{services.length} de {MAX_SERVICES} servicios configurados</p>
            <button
              type="button"
              onClick={() => { resetForm(); setFormOpen(true); }}
              disabled={busy || services.length >= MAX_SERVICES || !connected?.signer}
              className="rounded-lg bg-[#252a30] px-3 py-2 text-[9px] font-semibold text-white hover:bg-[#111418] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Agregar servicio
            </button>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {services.map((service) => (
              <div key={service.id} className="rounded-lg border border-[#eff0f2] p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] font-semibold text-[#252a30]">{service.nombre}</p>
                  <span className={service.activo ? "rounded-full bg-[#edf8f2] px-2 py-1 text-[8px] font-semibold text-[#168451]" : "rounded-full bg-[#f3f4f6] px-2 py-1 text-[8px] font-semibold text-[#858d96]"}>
                    {service.activo ? "Disponible" : "Desactivado"}
                  </span>
                </div>
                <p className="mt-1 text-[9px] leading-relaxed text-[#858d96]">{service.descripcion}</p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <p className="text-[15px] font-bold tabular-nums text-[#252a30]">{service.puntos.toString()} <span className="text-[9px] font-medium text-[#858d96]">puntos</span></p>
                  <button type="button" onClick={() => startEditing(service)} disabled={busy || !connected?.signer} className="rounded-md border border-[#e2e5e8] px-3 py-1.5 text-[9px] font-semibold text-[#555e68] hover:border-[#e60012] hover:text-[#d90011] disabled:opacity-50">
                    Editar
                  </button>
                </div>
              </div>
            ))}
          </div>

          {formOpen && (
            <form onSubmit={(event) => void submitService(event)} className="mt-4 rounded-lg border border-[#e2e5e8] bg-[#fafbfc] p-4">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-[11px] font-bold text-[#252a30]">{editingId === null ? "Nuevo servicio" : "Editar servicio"}</h4>
                <button type="button" onClick={resetForm} disabled={busy} className="text-[9px] font-semibold text-[#858d96] hover:text-[#252a30]">Cancelar</button>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[9px] font-semibold text-[#555e68]">Nombre (máx. 40)</span>
                  <input value={form.nombre} onChange={(event) => setForm((value) => ({ ...value, nombre: event.target.value }))} maxLength={40} required disabled={busy} className="w-full rounded-lg border border-[#e2e5e8] bg-white px-3 py-2 text-[10px] outline-none focus:border-[#e60012]" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[9px] font-semibold text-[#555e68]">Puntos</span>
                  <input type="number" min="1" step="1" inputMode="numeric" value={form.puntos} onChange={(event) => setForm((value) => ({ ...value, puntos: event.target.value }))} required disabled={busy} className="w-full rounded-lg border border-[#e2e5e8] bg-white px-3 py-2 text-[10px] outline-none focus:border-[#e60012]" />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-[9px] font-semibold text-[#555e68]">Descripción (máx. 100)</span>
                  <textarea value={form.descripcion} onChange={(event) => setForm((value) => ({ ...value, descripcion: event.target.value }))} maxLength={100} rows={2} disabled={busy} className="w-full resize-y rounded-lg border border-[#e2e5e8] bg-white px-3 py-2 text-[10px] outline-none focus:border-[#e60012]" />
                </label>
                <label className="flex items-center gap-2 text-[10px] text-[#555e68] sm:col-span-2">
                  <input type="checkbox" checked={form.activo} onChange={(event) => setForm((value) => ({ ...value, activo: event.target.checked }))} disabled={busy} />
                  Servicio disponible para canjes
                </label>
              </div>
              <div className="mt-3 flex justify-end">
                <button type="submit" disabled={busy || !connected?.signer} className="rounded-lg bg-[#e60012] px-4 py-2.5 text-[10px] font-semibold text-white hover:bg-[#c90010] disabled:cursor-not-allowed disabled:opacity-50">
                  {busy ? "Guardando…" : editingId === null ? "Guardar servicio" : "Guardar cambios"}
                </button>
              </div>
            </form>
          )}

          <div className="mt-3 rounded-lg bg-[#f7f8fa] p-3">
            <p className="break-all font-mono text-[9px] text-[#858d96]">Catálogo PDA: {catalogAddress}</p>
            <p className="mt-1 text-[9px] text-[#858d96]">Los servicios y precios pertenecen únicamente a este concesionario. Máximo 8 servicios por catálogo.</p>
          </div>
        </>
      )}
    </section>
  );
}
