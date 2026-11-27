"use client";

import { useEffect, useState } from "react";
import { ClusterSelect } from "../cluster-select";
import { WalletButton } from "../wallet-button";
import { DealershipWorkspace } from "./dealership-workspace";
import { useAppClient } from "../../lib/client-provider";
import { useCluster } from "../cluster-context";

const navigation = [
  { id: "settings", label: "Configuración", icon: "☷", group: "SISTEMA" },
  { id: "motorcycles", label: "Inventario", icon: "◫", group: "GESTIÓN" },
  { id: "customers", label: "Clientes", icon: "♙" },
  { id: "sales", label: "Ventas", icon: "↗" },
  { id: "loyalty", label: "Fidelización", icon: "✦", group: "GESTIÓN" },
  { id: "services", label: "Servicios", icon: "⚙" },
  { id: "warranties", label: "Garantías", icon: "◇", group: "POSVENTA", disabled: true },
  { id: "claims", label: "Reclamaciones", icon: "▤" },
] as const;

const pageCopy: Record<string, { title: string; description: string }> = {
  motorcycles: {
    title: "Inventario",
    description: "Registro, consulta y seguimiento de las motos de tu concesionario.",
  },
  customers: {
    title: "Clientes",
    description: "Directorio de clientes registrados en tu concesionario.",
  },
  sales: {
    title: "Ventas",
    description: "Registro y seguimiento de las ventas de motos.",
  },
  services: {
    title: "Servicios",
    description: "Mantenimientos, reparaciones y trabajos realizados.",
  },
  loyalty: {
    title: "Fidelización",
    description: "Metadata IPFS y configuración del programa de puntos Token-2022.",
  },
  warranties: {
    title: "Garantías",
    description: "Cobertura, vigencia y condiciones de garantía.",
  },
  claims: {
    title: "Reclamaciones",
    description: "Solicitudes de garantía y su estado de atención.",
  },
  settings: {
    title: "Configuración",
    description: "Registra y administra tus concesionarios y define sus políticas de garantía.",
  },
};

function BrandMark() {
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e60012] text-white shadow-sm shadow-red-200">
      <svg viewBox="0 0 32 32" className="h-6 w-6" fill="none" aria-hidden="true">
        <path d="M5 21.5 10.5 11h5L21 21.5h6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10.5 11 16 21.5 21 11" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="7" cy="22" r="3" stroke="currentColor" strokeWidth="2" />
        <circle cx="25" cy="22" r="3" stroke="currentColor" strokeWidth="2" />
      </svg>
    </div>
  );
}

function Sidebar({
  active,
  onNavigate,
}: {
  active: string;
  onNavigate: (id: string) => void;
}) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[252px] flex-col border-r border-[#e9ebee] bg-white lg:flex">
      <div className="flex h-[76px] items-center gap-3 border-b border-[#f0f1f3] px-6">
        <BrandMark />
        <div>
          <p className="text-[15px] font-extrabold tracking-[-0.04em] text-[#20252b]">MOTO<span className="text-[#e60012]">LEDGER</span></p>
          <p className="mt-0.5 text-[9px] font-semibold tracking-[0.19em] text-[#9aa1a9]">DEALERSHIP MANAGEMENT</p>
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-4 py-7" aria-label="Navegación principal">
        {["SISTEMA", "GESTIÓN", "POSVENTA"].map((group) => (
          <div key={group}>
            <p className="mb-2 px-3 text-[9px] font-bold tracking-[0.18em] text-[#a0a6ad]">{group}</p>
            <div className="space-y-1">
              {navigation.filter((item) => ("group" in item && item.group === group) || (!("group" in item) && group === "GESTIÓN" && ["customers", "sales", "services"].includes(item.id))).map((item) => {
                const selected = active === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => !("disabled" in item && item.disabled) && onNavigate(item.id)}
                    disabled={"disabled" in item && item.disabled}
                    title={"disabled" in item && item.disabled ? "Módulo próximamente" : undefined}
                    className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[12px] font-semibold transition ${"disabled" in item && item.disabled ? "cursor-not-allowed opacity-40" : selected ? "bg-[#fff0f1] text-[#d90011]" : "text-[#69717a] hover:bg-[#f6f7f8] hover:text-[#252a30]"}`}
                  >
                    <span className={`flex h-5 w-5 items-center justify-center text-[17px] ${selected ? "text-[#e60012]" : "text-[#9aa1a9] group-hover:text-[#555e68]"}`}>{item.icon}</span>
                    {item.label}
                    {"disabled" in item && item.disabled && <span className="ml-auto text-[8px] font-medium tracking-wide">PRONTO</span>}
                    {selected && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#e60012]" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-[#f0f1f3] p-4">
        <div className="rounded-xl bg-[#f7f8fa] p-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#e60012]" />
            <span className="text-[10px] font-bold tracking-wide text-[#555e68]">POWERED BY SOLANA</span>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-[#9299a1]">Registros verificables y trazabilidad para el ciclo de vida de cada moto.</p>
        </div>
        <p className="mt-4 px-1 text-[10px] text-[#a5abb2]">MotoLedger · Versión 1.0</p>
      </div>
    </aside>
  );
}

function MetricCard({
  label,
  icon,
  note,
}: {
  label: string;
  icon: string;
  note: string;
}) {
  return (
    <div className="rounded-xl border border-[#e9ebee] bg-white p-5 shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-[#7b838c]">{label}</p>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f6f7f8] text-[17px] text-[#69717a]">{icon}</span>
      </div>
      <p className="mt-4 text-[27px] font-bold tracking-[-0.05em] text-[#252a30]">—</p>
      <p className="mt-1 text-[10px] text-[#a0a6ad]">{note}</p>
    </div>
  );
}

type NetworkStatus = "checking" | "connected" | "disconnected";

function NetworkStatusBadge() {
  const client = useAppClient();
  const { cluster } = useCluster();
  const [status, setStatus] = useState<NetworkStatus>("checking");
  const [slot, setSlot] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const checkNetwork = async () => {
      const startedAt = performance.now();
      try {
        const currentSlot = await client.rpc.getSlot().send();
        const elapsed = Math.round(performance.now() - startedAt);
        if (!active) return;
        setStatus("connected");
        setSlot(currentSlot.toString());
        setLatency(elapsed);
        setLastChecked(new Date().toLocaleTimeString("es-VE"));
      } catch (error) {
        if (!active) return;
        console.warn(`No se pudo consultar la red ${cluster}:`, error);
        setStatus("disconnected");
        setLatency(null);
        setLastChecked(new Date().toLocaleTimeString("es-VE"));
      }
    };

    void checkNetwork();
    const interval = window.setInterval(() => void checkNetwork(), 10_000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [client, cluster]);

  const appearance = {
    checking: {
      label: "CONECTANDO A LA RED",
      dot: "bg-[#e6a23c] animate-pulse",
      border: "border-[#f3dfbd]",
      background: "bg-[#fff9ef]",
      text: "text-[#b7791f]",
    },
    connected: {
      label: "RED CONECTADA",
      dot: "bg-[#16a36a]",
      border: "border-[#ccebdc]",
      background: "bg-[#f1fbf6]",
      text: "text-[#168354]",
    },
    disconnected: {
      label: "SIN CONEXIÓN",
      dot: "bg-[#dc4545]",
      border: "border-[#f2d1d1]",
      background: "bg-[#fff5f5]",
      text: "text-[#c43d3d]",
    },
  }[status];

  return (
    <div
      className={`flex min-w-[190px] flex-col gap-1 rounded-lg border px-3 py-2 ${appearance.border} ${appearance.background}`}
      role="status"
      aria-live="polite"
      title={lastChecked ? `Última comprobación: ${lastChecked}` : "Comprobando conexión RPC"}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${appearance.dot}`} />
        <span className={`text-[9px] font-bold tracking-wide ${appearance.text}`}>{appearance.label}</span>
        <span className="ml-auto text-[9px] font-semibold uppercase text-[#858d96]">{cluster}</span>
      </div>
      <div className="flex items-center gap-3 pl-4 text-[9px] text-[#7b838c]">
        <span>{slot ? `Slot #${Number(slot).toLocaleString("es-VE")}` : "Consultando slot…"}</span>
        {latency !== null && <span>{latency} ms</span>}
      </div>
    </div>
  );
}

function EmptySection({ title }: { title: string }) {
  return (
    <section className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-[#e9ebee] bg-white px-6 text-center shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fff0f1] text-2xl text-[#e60012]">⌁</div>
      <h2 className="mt-4 text-[14px] font-bold text-[#343a40]">{title}</h2>
      <p className="mt-2 max-w-sm text-[11px] leading-relaxed text-[#9299a1]">Estamos preparando este módulo para conectarlo con las instrucciones y cuentas del programa MotoLedger en Solana.</p>
      <span className="mt-5 rounded-full border border-[#f1d4d7] bg-[#fff7f7] px-3 py-1.5 text-[9px] font-bold tracking-wide text-[#d90011]">MÓDULO EN DESARROLLO</span>
    </section>
  );
}

export function DashboardShell() {
  const [active, setActive] = useState("settings");
  const page = pageCopy[active];

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-[#20252b]">
      <Sidebar active={active} onNavigate={setActive} />
      <div className="min-h-screen lg:pl-[252px]">
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-[#e9ebee] bg-white/95 px-5 backdrop-blur sm:px-8">
          <div className="flex items-center gap-3 lg:hidden">
            <BrandMark />
            <span className="text-[14px] font-extrabold tracking-[-0.04em]">MOTO<span className="text-[#e60012]">LEDGER</span></span>
          </div>
          <div className="hidden lg:block">
            <p className="text-[9px] font-semibold tracking-[0.16em] text-[#a0a6ad]">PANEL DE CONTROL</p>
            <p className="mt-1 text-[12px] font-bold text-[#424950]">{page.title}</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <ClusterSelect />
            <WalletButton />
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-[#e9ebee] bg-white px-4 py-2 lg:hidden" aria-label="Navegación móvil">
          {navigation.map((item) => (
            <button
              key={item.id}
              onClick={() => !("disabled" in item && item.disabled) && setActive(item.id)}
              disabled={"disabled" in item && item.disabled}
              title={"disabled" in item && item.disabled ? "Módulo próximamente" : undefined}
              className={`shrink-0 rounded-lg px-3 py-2 text-[10px] font-semibold transition ${"disabled" in item && item.disabled ? "cursor-not-allowed opacity-40" : active === item.id ? "bg-[#fff0f1] text-[#d90011]" : "text-[#737b84] hover:bg-[#f6f7f8]"}`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <main className="mx-auto max-w-[1440px] px-5 py-7 sm:px-8 sm:py-9">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold tracking-[0.16em] text-[#e60012]">MOTOLEDGER / {active.toUpperCase()}</p>
              <h1 className="mt-2 text-[25px] font-bold tracking-[-0.045em] text-[#20252b] sm:text-[29px]">{page.title}</h1>
              <p className="mt-1.5 text-[11px] text-[#858d96]">{page.description}</p>
            </div>
            <NetworkStatusBadge />
          </div>

          <div className={active === "motorcycles" || active === "customers" || active === "sales" || active === "services" || active === "loyalty" || active === "settings" ? "" : "hidden"}><DealershipWorkspace activeModule={active} onNavigate={setActive} /></div>
          {active !== "motorcycles" && active !== "customers" && active !== "sales" && active !== "services" && active !== "loyalty" && active !== "settings" && <EmptySection title={page.title} />}

          <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-[#e9ebee] pt-4 text-[9px] text-[#a0a6ad]">
            <span>MOTOLEDGER · GESTIÓN DE CONCESIONARIOS</span>
            <span>Construido sobre Solana</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
