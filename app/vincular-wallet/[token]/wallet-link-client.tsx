"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  address,
  getBase64Encoder,
  getTransactionDecoder,
  getBase64EncodedWireTransaction,
} from "@solana/kit";
import {
  useConnectedWallet,
  useConnect,
  useWallets,
} from "@solana/kit-plugin-wallet/react";
import { useAppClient } from "../../lib/client-provider";
import { useCluster } from "../../components/cluster-context";

type Session = {
  owner: string;
  cliente: string;
  concesionario: string;
  cluster: "devnet" | "testnet" | "mainnet" | "localnet";
  walletAddress: string | null;
  transaction: string | null;
  signedTransaction: string | null;
  status: string;
  expiresAt: number;
};

function shortAddress(value: string) {
  return value.length > 16 ? `${value.slice(0, 7)}…${value.slice(-7)}` : value;
}

export function WalletLinkClient({ token }: { token: string }) {
  const client = useAppClient();
  const { cluster, setCluster } = useCluster();
  const wallets = useWallets(client);
  const connected = useConnectedWallet(client);
  const { dispatchAsync: connect, isRunning: connecting } = useConnect(client);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("Cargando solicitud segura…");
  const [now, setNow] = useState(() => Date.now());
  const signingRef = useRef(false);
  const walletSentRef = useRef(false);

  const loadSession = useCallback(async () => {
    const response = await fetch(`/api/wallet-link/${token}`, { cache: "no-store" });
    const payload = (await response.json()) as Session & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "La solicitud ya no está disponible.");
    setSession(payload);
    return payload;
  }, [token]);

  useEffect(() => {
    let active = true;
    void loadSession()
      .then((data) => {
        if (!active) return;
        if (data.cluster !== cluster) setCluster(data.cluster);
        setMessage("Conecta la wallet que deseas asociar a tu cuenta de cliente.");
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudo cargar la solicitud."))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [loadSession, cluster, setCluster]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!session || session.status === "completed" || session.status === "cancelled") return;
    let active = true;
    const poll = async () => {
      try {
        const data = await loadSession();
        if (active && data.expiresAt <= Date.now()) {
          setError("El código QR expiró. Solicita uno nuevo en el concesionario.");
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "La solicitud expiró.");
      }
    };
    const interval = window.setInterval(() => void poll(), 2500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [session?.status, session?.expiresAt, loadSession]);

  useEffect(() => {
    if (!connected?.account.address || !session || session.walletAddress || walletSentRef.current) return;
    walletSentRef.current = true;
    setMessage("Registrando la dirección de tu wallet…");
    void fetch(`/api/wallet-link/${token}/wallet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress: connected.account.address }),
    })
      .then(async (response) => {
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "No se pudo asociar esta wallet a la solicitud.");
        setMessage("Wallet recibida. Esperando la transacción preparada por el concesionario…");
        await loadSession();
      })
      .catch((cause) => {
        walletSentRef.current = false;
        setError(cause instanceof Error ? cause.message : "No se pudo registrar la wallet.");
      });
  }, [connected?.account.address, session, token, loadSession]);

  const signTransaction = async () => {
    if (!connected || !session?.transaction || session.signedTransaction || signingRef.current) return;
    const walletAddress = connected.account.address;
    const walletSigner = connected.signer;
    if (!walletAddress || !walletSigner || session.walletAddress !== walletAddress) return;

    signingRef.current = true;
    setError(null);
    setMessage("Abriendo la solicitud de firma en tu wallet…");
    try {
      const transactionBytes = getBase64Encoder().encode(session.transaction);
      const transaction = getTransactionDecoder().decode(transactionBytes);
      if (!("modifyAndSignTransactions" in walletSigner)) {
        throw new Error("Esta wallet no permite firmar esta transacción sin enviarla. Necesitas una wallet compatible con firma de transacciones.");
      }
      const [signedTransaction] = await walletSigner.modifyAndSignTransactions([transaction]);
      const customerSignature = signedTransaction.signatures[address(walletAddress)];
      if (!customerSignature || customerSignature.every((byte) => byte === 0)) {
        throw new Error("La wallet no devolvió la firma del comprador.");
      }
      const serialized = getBase64EncodedWireTransaction(signedTransaction);
      const response = await fetch(`/api/wallet-link/${token}/signed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction: serialized }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo enviar la firma.");
      setMessage("Firma enviada. El concesionario finalizará la vinculación en Solana.");
      await loadSession();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo firmar la transacción.");
    } finally {
      signingRef.current = false;
    }
  };

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-[#f7f8fa] p-5"><p className="text-sm text-[#68717b]">Cargando solicitud…</p></main>;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f8fa] p-5">
      <section className="w-full max-w-md rounded-2xl border border-[#e9ebee] bg-white p-6 shadow-sm sm:p-8">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e60012] text-sm font-black text-white">ML</div>
        <p className="mt-5 text-[9px] font-bold tracking-[0.18em] text-[#e60012]">MOTOLEDGER · VINCULACIÓN DE WALLET</p>
        <h1 className="mt-2 text-xl font-bold tracking-tight text-[#252a30]">Asocia tu wallet a tu cuenta</h1>
        <p className="mt-2 text-xs leading-relaxed text-[#737b84]">
          Esta solicitud permite asociar la dirección pública de tu wallet con tu registro de cliente. No compartas tu frase semilla ni claves privadas.
        </p>

        {error ? (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-xs leading-relaxed text-red-700">{error}</div>
        ) : session ? (
          <>
            <div className="mt-5 rounded-xl border border-[#e9ebee] bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-semibold text-[#68717b]">Tiempo restante de la solicitud</span>
                <span className={`font-mono text-sm font-bold tabular-nums ${session.expiresAt - now <= 30000 ? "text-red-600" : "text-[#252a30]"}`}>
                  {(() => { const seconds = Math.max(0, Math.ceil((session.expiresAt - now) / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; })()}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#eff0f2]">
                <div className="h-full rounded-full bg-[#e60012] transition-[width] duration-1000" style={{ width: `${Math.max(0, Math.min(100, ((session.expiresAt - now) / 300000) * 100))}%` }} />
              </div>
            </div>

            <div className="mt-4 space-y-3 rounded-xl bg-[#f7f8fa] p-4 text-xs">
              <div><p className="text-[9px] font-semibold uppercase tracking-wide text-[#9299a1]">Concesionario</p><p className="mt-1 break-all font-mono text-[#424950]">{shortAddress(session.concesionario)}</p></div>
              <div><p className="text-[9px] font-semibold uppercase tracking-wide text-[#9299a1]">Wallet del concesionario</p><p className="mt-1 break-all font-mono text-[#424950]">{shortAddress(session.owner)}</p></div>
              <div><p className="text-[9px] font-semibold uppercase tracking-wide text-[#9299a1]">Cuenta de cliente</p><p className="mt-1 break-all font-mono text-[#424950]">{shortAddress(session.cliente)}</p></div>
              <div><p className="text-[9px] font-semibold uppercase tracking-wide text-[#9299a1]">Red</p><p className="mt-1 font-semibold capitalize text-[#424950]">{session.cluster}</p></div>
            </div>

            {cluster !== session.cluster ? (
              <p className="mt-6 rounded-lg bg-[#f7f8fa] p-3 text-xs text-[#68717b]">Preparando la conexión con {session.cluster}…</p>
            ) : session.status === "cancelled" ? (
              <p className="mt-6 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">El concesionario canceló esta solicitud. Solicita un nuevo código QR.</p>
            ) : !connected ? (
              <div className="mt-6">
                <p className="mb-3 text-xs font-semibold text-[#424950]">Selecciona tu wallet</p>
                {wallets.length ? (
                  <div className="space-y-2">
                    {wallets.map((wallet) => (
                      <button key={wallet.name} type="button" disabled={connecting} onClick={() => void connect(wallet).catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudo conectar la wallet."))} className="flex w-full items-center gap-3 rounded-xl border border-[#e2e5e8] px-4 py-3 text-left text-xs font-semibold text-[#424950] transition hover:border-[#e60012] disabled:opacity-50">
                        {wallet.icon && (
                          // eslint-disable-next-line @next/next/no-img-element -- Wallet Standard icons are data URIs.
                          <img src={wallet.icon} alt="" className="h-6 w-6 rounded-md" />
                        )}
                        {wallet.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
                    No se detectó una wallet en este navegador. Abre este enlace desde el navegador integrado de tu wallet compatible con Solana y vuelve a cargar la página.
                  </p>
                )}
              </div>
            ) : session.walletAddress && session.walletAddress !== connected.account.address ? (
              <p className="mt-6 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
                Esta solicitud está asociada a otra dirección. Desconecta la wallet actual y conecta {shortAddress(session.walletAddress)}.
              </p>
            ) : (
              <div className="mt-6 rounded-xl border border-[#d7eee2] bg-[#f3fbf6] p-4">
                <p className="text-[9px] font-bold tracking-wide text-[#168354]">WALLET CONECTADA</p>
                <p className="mt-2 break-all font-mono text-[11px] text-[#424950]">{connected.account.address}</p>
                <p className="mt-3 text-xs leading-relaxed text-[#68717b]">{message}</p>
                {session.transaction && !session.signedTransaction && session.status !== "completed" && (
                  <button
                    type="button"
                    onClick={() => void signTransaction()}
                    disabled={signingRef.current || session.expiresAt <= now}
                    className="mt-4 w-full rounded-xl bg-[#e60012] px-4 py-3 text-xs font-bold text-white transition hover:bg-[#c90010] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Firmar vinculación en Solflare
                  </button>
                )}
              </div>
            )}

            {session.status === "completed" && (
              <p className="mt-5 rounded-lg bg-[#f3fbf6] p-3 text-xs font-semibold text-[#168354]">La vinculación se completó correctamente.</p>
            )}
          </>
        ) : null}

        <p className="mt-7 border-t border-[#eff0f2] pt-4 text-[10px] leading-relaxed text-[#9aa1a9]">
          La solicitud caduca automáticamente en cinco minutos. El concesionario cubre la comisión y los costes de creación de la cuenta. La firma autoriza únicamente la asociación indicada.
        </p>
      </section>
    </main>
  );
}
