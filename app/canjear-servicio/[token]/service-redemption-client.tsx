"use client";

import { useCallback, useEffect, useState } from "react";
import { address, getBase64Encoder, getTransactionDecoder, getBase64EncodedWireTransaction } from "@solana/kit";
import { useConnectedWallet, useConnect, useWallets } from "@solana/kit-plugin-wallet/react";
import { useAppClient } from "../../lib/client-provider";
import { useCluster } from "../../components/cluster-context";
import { validateRedemptionIntentOnChain } from "../../lib/service-redemption-chain-validation";
import { deriveCanjeServicioPda } from "../../lib/moto-ledger/pdas";

type Session = {
  owner: string;
  concesionario: string;
  cliente: string;
  clienteNombre: string;
  clienteCedula: string;
  walletAddress: string;
  mint: string;
  servicioId: number;
  servicioNombre: string;
  puntos: string;
  kilometrajeActual: string;
  idCanje: string;
  lastValidBlockHeight: string;
  cluster: "devnet" | "testnet" | "mainnet" | "localnet";
  transaction: string | null;
  signedTransaction: string | null;
  status: "waiting_transaction" | "waiting_customer_signature" | "signed" | "completed" | "cancelled";
  expiresAt: number;
};

function shortAddress(value: string) {
  return value.length > 16 ? `${value.slice(0, 7)}…${value.slice(-7)}` : value;
}

export function ServiceRedemptionClient({ token }: { token: string }) {
  const client = useAppClient();
  const { cluster, setCluster } = useCluster();
  const wallets = useWallets(client);
  const connected = useConnectedWallet(client);
  const { dispatchAsync: connect, isRunning: connecting } = useConnect(client);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [signing, setSigning] = useState(false);
  const [completionVerified, setCompletionVerified] = useState(false);

  const loadSession = useCallback(async () => {
    const response = await fetch(`/api/service-redemption/${token}`, { cache: "no-store" });
    const payload = (await response.json()) as Session & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "La solicitud expiró.");
    setSession(payload);
    return payload;
  }, [token]);

  useEffect(() => {
    let active = true;
    void loadSession().then((data) => {
      if (active && data.cluster !== cluster) setCluster(data.cluster);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "No se pudo cargar el canje.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadSession, cluster, setCluster]);

  useEffect(() => {
    if (!session || ["completed", "cancelled"].includes(session.status)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = window.setInterval(() => {
      void loadSession().catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudo actualizar la solicitud."));
    }, 2000);
    return () => { window.clearInterval(timer); window.clearInterval(poll); };
  }, [session?.status, session?.expiresAt, loadSession]);

  useEffect(() => {
    let active = true;
    setCompletionVerified(false);
    if (session?.status !== "signed") return;
    const verifyReceipt = async () => {
      try {
        const [receiptPda] = await deriveCanjeServicioPda(address(session.cliente), BigInt(session.idCanje));
        const receipt = await client.registro.accounts.canjeServicio.fetch(receiptPda).catch(() => null);
        if (!receipt || !active) return;
        const data = receipt.data;
        if (
          data.cliente === session.cliente &&
          data.wallet === session.walletAddress &&
          data.concesionario === session.concesionario &&
          data.mint === session.mint &&
          data.idCanje === BigInt(session.idCanje) &&
          data.servicioId === session.servicioId &&
          data.puntos === BigInt(session.puntos)
        ) setCompletionVerified(true);
      } catch {
        // The receipt may not exist until the dealership submits the signed transaction.
      }
    };
    void verifyReceipt();
    const poll = window.setInterval(() => { void verifyReceipt(); }, 2000);
    return () => { active = false; window.clearInterval(poll); };
  }, [client, session?.status, session?.cliente, session?.idCanje, session?.walletAddress, session?.concesionario, session?.mint, session?.servicioId, session?.puntos]);

  const sign = async () => {
    if (!session?.transaction || !connected?.signer || connected.account.address !== session.walletAddress || signing) return;
    setSigning(true);
    setError(null);
    try {
      const currentBlockHeight = await client.rpc.getBlockHeight({ commitment: "confirmed" }).send();
      if (currentBlockHeight > BigInt(session.lastValidBlockHeight)) {
        throw new Error("La transacción preparada caducó en Solana. Solicita al concesionario que genere un nuevo QR.");
      }
      await validateRedemptionIntentOnChain(client, session);
      const tx = getTransactionDecoder().decode(getBase64Encoder().encode(session.transaction));
      const signer = connected.signer;
      if (!("modifyAndSignTransactions" in signer)) {
        throw new Error("Esta wallet no permite firmar transacciones preparadas. Usa una wallet compatible con Solana Wallet Standard.");
      }
      const [signed] = await signer.modifyAndSignTransactions([tx]);
      const blockHeightAfterSignature = await client.rpc.getBlockHeight({ commitment: "confirmed" }).send();
      if (blockHeightAfterSignature > BigInt(session.lastValidBlockHeight)) {
        throw new Error("La transacción caducó mientras la wallet esperaba tu firma. Solicita un nuevo QR al concesionario.");
      }
      const customerSignature = signed.signatures[address(session.walletAddress)];
      if (!customerSignature || customerSignature.every((byte) => byte === 0)) {
        throw new Error("La wallet no devolvió la firma del cliente.");
      }
      const response = await fetch(`/api/service-redemption/${token}/signed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ transaction: getBase64EncodedWireTransaction(signed) }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo entregar la firma.");
      await loadSession();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo firmar el canje.");
    } finally {
      setSigning(false);
    }
  };

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-[#f7f8fa] p-5"><p className="text-sm text-[#68717b]">Consultando solicitud en Solana…</p></main>;
  if (!session) return <main className="flex min-h-screen items-center justify-center bg-[#f7f8fa] p-5"><section className="max-w-md rounded-2xl bg-white p-6 text-sm text-red-700">{error ?? "Solicitud no disponible."}</section></main>;

  const remaining = Math.max(0, Math.ceil((session.expiresAt - now) / 1000));
  const expired = remaining === 0 && session.status !== "signed";
  const canSign = session.status === "waiting_customer_signature" && Boolean(session.transaction) && connected?.account.address === session.walletAddress;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f8fa] p-5">
      <section className="w-full max-w-md rounded-2xl border border-[#e9ebee] bg-white p-6 shadow-sm sm:p-8">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e60012] text-sm font-black text-white">ML</div>
        <p className="mt-5 text-[9px] font-bold tracking-[0.18em] text-[#e60012]">MOTOLEDGER · CANJE TOKEN-2022</p>
        <h1 className="mt-2 text-xl font-bold text-[#252a30]">Autorizar canje de puntos</h1>
        <p className="mt-2 text-xs leading-relaxed text-[#737b84]">Revisa los datos antes de firmar. Tu wallet autorizará la quema de puntos indicada; no compartas tu frase semilla ni claves privadas.</p>
        <p className="mt-2 text-[10px] leading-relaxed text-[#858d96]">Aunque el QR dure 5 minutos, la transacción puede caducar antes. La vigencia se comprueba en Solana justo antes y después de firmar.</p>
        <div className="mt-5 rounded-xl bg-[#f7f8fa] p-4 text-xs">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><p className="text-[9px] font-semibold uppercase text-[#9299a1]">Servicio</p><p className="mt-1 font-bold text-[#252a30]">{session.servicioNombre}</p></div>
            <div><p className="text-[9px] font-semibold uppercase text-[#9299a1]">Puntos a quemar</p><p className="mt-1 text-lg font-bold text-[#e60012]">{BigInt(session.puntos).toLocaleString("es-VE")}</p></div>
            <div><p className="text-[9px] font-semibold uppercase text-[#9299a1]">Kilometraje</p><p className="mt-1 font-semibold text-[#252a30]">{BigInt(session.kilometrajeActual).toLocaleString("es-VE")} km</p></div>
            <div className="col-span-2"><p className="text-[9px] font-semibold uppercase text-[#9299a1]">Cliente</p><p className="mt-1 font-semibold text-[#252a30]">{session.clienteNombre} · C.I. {session.clienteCedula}</p></div>
            <div className="col-span-2"><p className="text-[9px] font-semibold uppercase text-[#9299a1]">Concesionario</p><p className="mt-1 break-all font-mono text-[#424950]">{shortAddress(session.concesionario)}</p></div>
            <div className="col-span-2"><p className="text-[9px] font-semibold uppercase text-[#9299a1]">Mint de puntos Token-2022</p><p className="mt-1 break-all font-mono text-[#424950]">{shortAddress(session.mint)}</p></div>
            <div className="col-span-2"><p className="text-[9px] font-semibold uppercase text-[#9299a1]">Wallet que debe firmar</p><p className="mt-1 break-all font-mono text-[#424950]">{session.walletAddress}</p></div>
          </div>
        </div>
        {!completionVerified && (
          <div className="mt-4 flex items-center justify-between rounded-lg border border-[#e9ebee] p-3 text-xs">
            <span className="text-[#68717b]">Tiempo restante</span>
            <strong className={remaining <= 30 ? "font-mono text-red-600" : "font-mono text-[#252a30]"}>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</strong>
          </div>
        )}
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
        {expired || session.status === "cancelled" ? (
          <p className="mt-5 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">La solicitud expiró o fue cancelada. Solicita un nuevo QR en el concesionario.</p>
        ) : session.status === "signed" && completionVerified ? (
          <div className="mt-5 rounded-xl border border-[#ccebd9] bg-[#f3fbf6] p-6 text-center">
            <div className="relative mx-auto flex h-20 w-20 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-[#d8f4e4] opacity-60" />
              <span className="relative flex h-16 w-16 animate-bounce items-center justify-center rounded-full bg-[#e7f8ee] text-3xl font-bold text-[#168354]">✓</span>
            </div>
            <h2 className="mt-5 text-lg font-bold text-[#252a30]">¡Canje completado!</h2>
            <p className="mt-2 text-xs leading-relaxed text-[#527363]">La transacción fue confirmada y el recibo verificado directamente en Solana. Los puntos ya fueron quemados de tu saldo.</p>
            <div className="mt-5 rounded-lg border border-[#dcefe3] bg-white p-4 text-left">
              <p className="text-[9px] font-bold tracking-wider text-[#168354]">SERVICIO CANJEADO</p>
              <p className="mt-1 text-sm font-bold text-[#252a30]">{session.servicioNombre}</p>
              <div className="mt-3 flex items-center justify-between gap-3 text-xs">
                <span className="text-[#68717b]">Puntos utilizados</span>
                <strong className="text-[#168354]">{BigInt(session.puntos).toLocaleString("es-VE")} puntos</strong>
              </div>
            </div>
            <p className="mt-4 text-[10px] text-[#68717b]">Ya puedes cerrar esta página con seguridad.</p>
          </div>
        ) : session.status === "signed" ? (
          <p className="mt-5 rounded-lg bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">Firma recibida. Verificando el recibo del canje directamente en Solana…</p>
        ) : cluster !== session.cluster ? (
          <p className="mt-5 text-xs text-[#68717b]">Conectando a {session.cluster}…</p>
        ) : !connected ? (
          <div className="mt-5 space-y-2">
            <p className="text-xs font-semibold text-[#424950]">Selecciona tu wallet para autorizar el canje</p>
            {wallets.map((wallet) => <button key={wallet.name} type="button" disabled={connecting} onClick={() => { void connect(wallet).catch((cause) => { setError(cause instanceof Error ? cause.message : "No se pudo conectar la wallet."); }); }} className="flex w-full items-center gap-3 rounded-xl border border-[#e2e5e8] px-4 py-3 text-left text-xs font-semibold text-[#424950] hover:border-[#e60012] disabled:opacity-50">{wallet.icon && <img src={wallet.icon} alt="" className="h-6 w-6 rounded-md" />}{wallet.name}</button>)}
          </div>
        ) : connected.account.address !== session.walletAddress ? (
          <p className="mt-5 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Conecta la wallet vinculada a este cliente: {shortAddress(session.walletAddress)}.</p>
        ) : !canSign ? (
          <p className="mt-5 rounded-lg bg-[#f7f8fa] p-3 text-xs text-[#68717b]">Esperando que el concesionario prepare y firme la transacción de canje…</p>
        ) : (
          <button type="button" disabled={signing} onClick={() => void sign()} className="mt-5 w-full rounded-xl bg-[#e60012] px-4 py-3 text-xs font-bold text-white hover:bg-[#c90010] disabled:opacity-50">{signing ? "Esperando firma…" : `Autorizar quema de ${BigInt(session.puntos).toLocaleString("es-VE")} puntos`}</button>
        )}
        <p className="mt-5 text-center text-[10px] leading-relaxed text-[#9299a1]">El saldo y el resultado definitivo se verifican en la blockchain. Esta página solo transporta la solicitud temporal de firma.</p>
      </section>
    </main>
  );
}
