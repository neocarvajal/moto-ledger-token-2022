"use client";

import { useEffect, useRef, useState } from "react";
import {
  address,
  assertIsTransactionWithBlockhashLifetime,
  appendTransactionMessageInstruction,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  type Base64EncodedWireTransaction,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { useAppClient } from "../../lib/client-provider";
import { useCluster } from "../cluster-context";
import { deriveWalletClientePda } from "../../lib/moto-ledger/pdas";

type LinkSession = {
  owner: string;
  concesionario: string;
  walletAddress: string | null;
  transaction: string | null;
  signedTransaction: string | null;
  status: string;
  expiresAt: number;
};

export function CustomerWalletLink({
  cliente,
  clienteNombre,
  clienteCedula,
  concesionario,
  totalMotos,
}: {
  cliente: string;
  clienteNombre: string;
  clienteCedula: string;
  concesionario: string;
  totalMotos: number;
}) {
  const client = useAppClient();
  const connected = useConnectedWallet(client);
  const { cluster } = useCluster();
  const [linkedWallet, setLinkedWallet] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [session, setSession] = useState<LinkSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [showUnlinkModal, setShowUnlinkModal] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successSignature, setSuccessSignature] = useState<string | null>(null);
  const [qrCreatedAt, setQrCreatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const buildingRef = useRef(false);
  const sendingRef = useRef(false);
  const cancelledRef = useRef(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    if (!showLinkModal && !showUnlinkModal) return;

    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
    };
  }, [showLinkModal, showUnlinkModal]);

  useEffect(() => {
    let active = true;
    setChecking(true);
    setLinkedWallet(null);
    void deriveWalletClientePda(address(cliente))
      .then(([walletCliente]) => client.registro.accounts.walletCliente.fetch(walletCliente))
      .then((account) => {
        if (active) setLinkedWallet(account.data.wallet);
      })
      .catch(() => {
        if (active) setLinkedWallet(null);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => { active = false; };
  }, [client, cliente]);

  useEffect(() => {
    if (!token) return;
    const interval = window.setInterval(() => {
      const status = sessionRef.current?.status;
      if (status === "completed" || status === "cancelled") {
        window.clearInterval(interval);
        return;
      }
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, [token]);

  useEffect(() => {
    if (!token || session?.status === "completed" || session?.status === "cancelled") return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(`/api/wallet-link/${token}`, { cache: "no-store" });
        const payload = (await response.json()) as LinkSession & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "La solicitud expiró.");
        if (active) setSession(payload);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "No se pudo consultar la solicitud.");
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 2000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [token, session?.status]);

  const authorizeWallet = async () => {
    if (!token || !session || !connected) return;
    const buyerAddress = session.walletAddress;
    const ownerAddress = connected.account.address;
    const ownerSigner = connected.signer;
    if (!buyerAddress || !ownerAddress || !ownerSigner) return;
    if (ownerAddress !== session.owner || session.concesionario !== concesionario) {
      setError("La wallet conectada o el concesionario no coinciden con la solicitud.");
      return;
    }
    if (buildingRef.current) return;

    buildingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const [walletCliente] = await deriveWalletClientePda(address(cliente));
      const existing = await client.registro.accounts.walletCliente.fetch(walletCliente).catch(() => null);
      if (existing) throw new Error("Este cliente ya tiene una wallet vinculada.");

      const instruction = client.registro.instructions.vincularWalletCliente({
        owner: ownerSigner,
        wallet: createNoopSigner(address(buyerAddress)),
        cliente: address(cliente),
        walletCliente,
      });

      const latestBlockhash = await client.rpc
        .getLatestBlockhash({ commitment: "confirmed" })
        .send();

      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayerSigner(ownerSigner, tx),
        (tx) => appendTransactionMessageInstruction(instruction, tx),
        (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash.value, tx)
      );

      const partiallySigned = await partiallySignTransactionMessageWithSigners(message);
      assertIsTransactionWithBlockhashLifetime(partiallySigned);
      const ownerSignature = partiallySigned.signatures[address(ownerAddress)];
      if (!ownerSignature || ownerSignature.every((byte) => byte === 0)) {
        throw new Error("La wallet del concesionario no permite firmar parcialmente esta transacción.");
      }
      const serialized = getBase64EncodedWireTransaction(partiallySigned);
      const response = await fetch(`/api/wallet-link/${token}/transaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction: serialized }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo preparar la transacción.");
    } catch (cause) {
      buildingRef.current = false;
      setError(cause instanceof Error ? cause.message : "No se pudo preparar la transacción.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!token || !session?.signedTransaction || session.status !== "signed" || sendingRef.current) return;
    sendingRef.current = true;
    cancelledRef.current = false;
    setBusy(true);
    setError(null);

    void (async () => {
      try {
        // Submit the exact signed wire transaction. Decoding it first loses the
        // blockhash lifetime metadata required by sendAndConfirmTransactionFactory.
        const signature = await client.rpc
          .sendTransaction(
            session.signedTransaction as Base64EncodedWireTransaction,
            {
              encoding: "base64",
              preflightCommitment: "confirmed",
              maxRetries: 3n,
            }
          )
          .send();

        if (cancelledRef.current) return;

        // sendTransaction only acknowledges RPC receipt; wait until the cluster
        // confirms execution before marking the wallet link as completed.
        let confirmed = false;
        for (let attempt = 0; attempt < 30; attempt += 1) {
          const statuses = await client.rpc
            .getSignatureStatuses([signature])
            .send();
          if (cancelledRef.current) return;
          const status = statuses.value[0];

          if (status?.err) {
            throw new Error(`La transacción fue rechazada por Solana: ${JSON.stringify(status.err)}`);
          }

          if (
            status?.confirmationStatus === "confirmed" ||
            status?.confirmationStatus === "finalized"
          ) {
            confirmed = true;
            break;
          }

          await new Promise((resolve) => window.setTimeout(resolve, 1000));
        }

        if (!confirmed) {
          throw new Error(
            "Solana recibió la transacción, pero todavía no confirmó su ejecución. Puedes volver a consultar el estado sin crear otra vinculación."
          );
        }

        if (cancelledRef.current) return;
        const completion = await fetch(`/api/wallet-link/${token}/complete`, {
          method: "POST",
        });
        if (!completion.ok) {
          throw new Error("La transacción se confirmó, pero no se pudo cerrar la sesión de vinculación.");
        }
        setSuccessSignature(signature);
        setLinkedWallet(session.walletAddress);
        setSession((current) => current ? { ...current, status: "completed" } : current);
        toast.success("Wallet del cliente vinculada correctamente.");
      } catch (cause) {
        sendingRef.current = false;
        if (!cancelledRef.current) setError(cause instanceof Error ? cause.message : "No se pudo enviar la transacción.");
      } finally {
        setBusy(false);
      }
    })();
  }, [token, session?.signedTransaction, session?.status, session?.walletAddress, client]);

  const unlinkWallet = async () => {
    if (!connected?.signer) {
      toast.error("Conecta la wallet propietaria del concesionario.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const [walletCliente] = await deriveWalletClientePda(address(cliente));
      const existing = await client.registro.accounts.walletCliente
        .fetch(walletCliente)
        .catch(() => null);

      if (!existing) {
        setLinkedWallet(null);
        toast.info("Este cliente ya no tiene una wallet vinculada.");
        return;
      }

      const instruction = client.registro.instructions.desvincularWalletCliente({
        owner: connected.signer,
        cliente: address(cliente),
        walletCliente,
      });
      const result = await instruction.sendTransaction();

      setLinkedWallet(null);
      setSuccessSignature(null);
      setShowUnlinkModal(false);
      toast.success("Wallet desvinculada. El historial del cliente se conservó.");
      if (result.context.signature) {
        console.info("Wallet unlink transaction:", result.context.signature);
      }
    } catch (cause) {
      console.error("No se pudo desvincular la wallet:", cause);
      setError(cause instanceof Error ? cause.message : "No se pudo desvincular la wallet.");
      toast.error(cause instanceof Error ? cause.message : "No se pudo desvincular la wallet.");
    } finally {
      setBusy(false);
    }
  };

  const closeRequest = async () => {
    cancelledRef.current = true;
    if (token && session?.status !== "completed") await fetch(`/api/wallet-link/${token}/cancel`, { method: "POST" }).catch(() => undefined);
    setShowLinkModal(false);
    setToken(null);
    setUrl(null);
    setSession(null);
    setQrCreatedAt(null);
    setError(null);
    buildingRef.current = false;
    sendingRef.current = false;
    setBusy(false);
  };

  const startLink = async () => {
    if (cluster === "localnet") {
      toast.error("La vinculación por QR requiere una red pública accesible desde el teléfono.");
      return;
    }
    if (!connected?.signer || !connected.account.address) {
      toast.error("Conecta la wallet propietaria del concesionario.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccessSignature(null);
    buildingRef.current = false;
    sendingRef.current = false;
    cancelledRef.current = false;
    try {
      const response = await fetch("/api/wallet-link", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: connected.account.address,
          cliente,
          clienteNombre,
          clienteCedula,
          concesionario,
          cluster,
        }),
      });
      const payload = (await response.json()) as { token?: string; error?: string };
      if (!response.ok || !payload.token) throw new Error(payload.error ?? "No se pudo crear el QR.");
      setToken(payload.token);
      setQrCreatedAt(Date.now());
      setNow(Date.now());
      const publicAppUrl = (
        process.env.NEXT_PUBLIC_APP_URL || window.location.origin
      ).replace(/\/+$/, "");
      setUrl(`${publicAppUrl}/vincular-wallet/${payload.token}`);
      setSession(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo iniciar la vinculación.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-[#eff0f2] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[9px] font-bold tracking-[0.12em] text-[#9299a1]">WALLET DEL COMPRADOR</p>
          <p className="mt-1 text-[11px] font-semibold text-[#252a30]">
            {checking ? "Consultando vinculación…" : linkedWallet ? "Wallet vinculada" : "Sin wallet vinculada"}
          </p>
          {linkedWallet && <p className="mt-1 break-all font-mono text-[9px] text-[#68717b]">{linkedWallet}</p>}
          {linkedWallet && (
            <button
              type="button"
              onClick={() => setShowUnlinkModal(true)}
              disabled={busy || checking || !connected?.signer}
              className="mt-2 rounded-lg border border-red-200 px-3 py-2 text-[10px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {busy ? "Procesando…" : "Desvincular wallet"}
            </button>
          )}
        </div>
        {!linkedWallet && totalMotos > 0 && !token && (
          <button type="button" onClick={() => { setShowLinkModal(true); void startLink(); }} disabled={busy || checking || !connected?.signer} className="rounded-lg bg-[#e60012] px-3 py-2 text-[10px] font-semibold text-white hover:bg-[#c90010] disabled:opacity-50">
            {busy ? "Preparando…" : "Vincular mediante QR"}
          </button>
        )}
      </div>

      {totalMotos <= 0 && !linkedWallet && (
        <p className="mt-3 text-[9px] leading-relaxed text-[#9299a1]">El cliente debe tener al menos una compra registrada para poder vincular una wallet.</p>
      )}

      {showLinkModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto overscroll-contain bg-[#171b20]/55 p-4 backdrop-blur-md">
          <section role="dialog" aria-modal="true" aria-labelledby="link-wallet-title" className="my-auto max-h-[92vh] w-full max-w-2xl touch-pan-y overflow-y-auto overscroll-contain rounded-2xl border border-[#e9ebee] bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-[#eff0f2] px-5 py-4 sm:px-6">
              <div>
                <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">GESTIÓN DE CLIENTES</p>
                <h2 id="link-wallet-title" className="mt-1 text-[17px] font-bold text-[#252a30]">Vincular wallet del cliente</h2>
                <p className="mt-1 text-[10px] text-[#858d96]">{clienteNombre} · C.I. {clienteCedula}</p>
              </div>
              <button type="button" onClick={() => void closeRequest()} aria-label="Cerrar vinculación" className="rounded-lg border border-[#e2e5e8] px-3 py-1.5 text-[12px] text-[#68717b] hover:bg-[#f7f8fa] disabled:opacity-40">✕</button>
            </div>
            {!token || !url ? (
              <div className="p-8 text-center">
                <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-[#f2c6ca] border-t-[#e60012]" />
                <p className="mt-4 text-[12px] font-semibold text-[#252a30]">Preparando solicitud segura…</p>
                {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-[10px] text-red-700">{error}</p>}
                <button type="button" onClick={() => void closeRequest()} className="mt-4 text-[10px] font-semibold text-[#737b84] underline">Cancelar proceso y cerrar</button>
              </div>
            ) : successSignature ? (
              <div className="p-8 text-center">
                <div className="relative mx-auto flex h-20 w-20 items-center justify-center">
                  <span className="absolute inset-0 animate-ping rounded-full bg-[#d8f4e4] opacity-60" />
                  <span className="relative flex h-16 w-16 animate-bounce items-center justify-center rounded-full bg-[#e7f8ee] text-3xl font-bold text-[#168354]">✓</span>
                </div>
                <h3 className="mt-5 text-lg font-bold text-[#252a30]">¡Wallet vinculada correctamente!</h3>
                <p className="mt-2 text-[11px] leading-relaxed text-[#68717b]">La wallet del cliente quedó asociada y la transacción fue confirmada en Solana.</p>
                <div className="mx-auto mt-5 max-w-md rounded-xl border border-[#e8ecef] bg-[#fafbfc] p-4 text-left">
                  <p className="text-[9px] font-bold tracking-wider text-[#9299a1]">CLIENTE VINCULADO</p>
                  <p className="mt-1 text-[12px] font-semibold text-[#252a30]">{clienteNombre}</p>
                  <p className="mt-1 text-[10px] text-[#68717b]">C.I. {clienteCedula}</p>
                  <p className="mt-3 break-all font-mono text-[10px] text-[#68717b]">{linkedWallet}</p>
                </div>
                <a className="mt-4 inline-block break-all text-[10px] font-semibold text-[#168354] underline" href={`https://explorer.solana.com/tx/${successSignature}?cluster=${cluster}`} target="_blank" rel="noopener noreferrer">Ver transacción en Solana Explorer ↗</a>
                <p className="mt-4 text-[10px] text-[#68717b]">El proceso finalizó. Ya puedes cerrar esta ventana.</p>
                <button type="button" onClick={() => void closeRequest()} className="mt-5 rounded-lg bg-[#252a30] px-5 py-2.5 text-[10px] font-semibold text-white">Cerrar ventana</button>
              </div>
            ) : (
              <div className="grid gap-6 p-5 sm:grid-cols-[190px_1fr] sm:p-6">
                <div className="flex flex-col items-center">
                  <div className="rounded-xl border border-[#e9ebee] bg-white p-3 shadow-sm"><QRCodeSVG value={url} size={164} level="M" includeMargin /></div>
                  <p className="mt-3 text-center text-[10px] font-bold text-[#252a30]">Escanea con el teléfono del comprador</p>
                  <p className="mt-1 break-all text-center text-[9px] text-[#9aa1a9]">{url}</p>
                  <p className={`mt-3 text-[11px] font-bold tabular-nums ${(session?.expiresAt ?? (qrCreatedAt ?? now) + 300000) - now <= 30000 ? "text-red-600" : "text-[#68717b]"}`}>
                    Tiempo restante: {(() => { const seconds = Math.max(0, Math.ceil(((session?.expiresAt ?? (qrCreatedAt ?? now) + 300000) - now) / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; })()}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] leading-relaxed text-[#737b84]">El comprador abrirá esta solicitud y conectará su wallet. El concesionario autorizará la dirección y preparará la transacción; finalmente, el comprador la firmará desde su teléfono.</p>
                  <div className="mt-4 space-y-3">
                    <div className={`rounded-lg border p-3 ${!session?.walletAddress ? "border-[#e9ebee] bg-[#fafbfc]" : "border-[#ccebd9] bg-[#f3fbf6]"}`}>
                      <p className="text-[9px] font-bold tracking-wider text-[#9299a1]">1 · CONEXIÓN DEL COMPRADOR</p>
                      <p className="mt-1 text-[10px] font-semibold text-[#424950]">{!session?.walletAddress ? "Esperando que el cliente escanee el QR y conecte su wallet…" : "Wallet detectada correctamente."}</p>
                    </div>
                    {session?.walletAddress && (
                      <div className="rounded-lg border border-[#f0d9b9] bg-[#fffaf2] p-3">
                        <p className="text-[9px] font-semibold text-[#9a641f]">WALLET DETECTADA · VERIFICA CON EL COMPRADOR</p>
                        <p className="mt-2 break-all font-mono text-[10px] text-[#424950]">{session.walletAddress}</p>
                        {!session.transaction && <button type="button" onClick={() => void authorizeWallet()} disabled={busy || !connected?.signer} className="mt-3 rounded-lg bg-[#e60012] px-3 py-2 text-[10px] font-semibold text-white disabled:opacity-50">{busy ? "Preparando transacción…" : "Confirmar wallet y firmar"}</button>}
                      </div>
                    )}
                    <div className={`rounded-lg border p-3 ${session?.transaction ? "border-[#ccebd9] bg-[#f3fbf6]" : "border-[#e9ebee] bg-[#fafbfc]"}`}>
                      <p className="text-[9px] font-bold tracking-wider text-[#9299a1]">2 · AUTORIZACIÓN DEL CONCESIONARIO</p>
                      <p className="mt-1 text-[10px] font-semibold text-[#424950]">{session?.transaction ? "Transacción preparada y firma del concesionario aplicada." : "Pendiente de confirmar la wallet detectada."}</p>
                    </div>
                    <div className={`rounded-lg border p-3 ${session?.status === "signed" ? "border-[#ccebd9] bg-[#f3fbf6]" : "border-[#e9ebee] bg-[#fafbfc]"}`}>
                      <p className="text-[9px] font-bold tracking-wider text-[#9299a1]">3 · FIRMA DEL COMPRADOR Y CONFIRMACIÓN</p>
                      <p className="mt-1 text-[10px] font-semibold text-[#424950]">{session?.status === "signed" ? "Firma recibida. Enviando y esperando confirmación de Solana…" : "Esperando que el comprador firme desde su wallet."}</p>
                    </div>
                  </div>
                  {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-[10px] leading-relaxed text-red-700">{error}</p>}
                  <button type="button" onClick={() => void closeRequest()} className="mt-4 rounded-lg border border-[#e2e5e8] px-4 py-2 text-[10px] font-semibold text-[#68717b] hover:bg-[#f7f8fa]">Cancelar proceso y cerrar</button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
      {error && !showLinkModal && <p className="mt-3 rounded-lg bg-red-50 p-3 text-[10px] leading-relaxed text-red-700">{error}</p>}

      {showUnlinkModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#171b20]/55 p-4 backdrop-blur-[2px]"
          onClick={() => !busy && setShowUnlinkModal(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="unlink-wallet-title"
            onClick={(event) => event.stopPropagation()}
            className="my-auto w-full max-w-md overflow-hidden rounded-2xl border border-[#e9ebee] bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-[#eff0f2] px-6 py-5">
              <div>
                <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">GESTIÓN DE CLIENTES</p>
                <h2 id="unlink-wallet-title" className="mt-1 text-[17px] font-bold text-[#252a30]">Desvincular wallet</h2>
                <p className="mt-1 text-[10px] text-[#858d96]">Confirma que deseas retirar la asociación de esta wallet.</p>
              </div>
              <button type="button" onClick={() => setShowUnlinkModal(false)} disabled={busy} aria-label="Cerrar confirmación" className="rounded-lg border border-[#e2e5e8] px-3 py-1.5 text-[12px] text-[#68717b] hover:bg-[#f7f8fa] disabled:opacity-40">✕</button>
            </div>
            <div className="space-y-4 p-6">
              <div className="rounded-xl border border-[#f2d5d7] bg-[#fff8f8] p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#fdebed] text-[17px] text-[#d90011]">!</span>
                  <div className="min-w-0">
                    <p className="text-[12px] font-bold text-[#30363d]">Wallet que se desvinculará</p>
                    <p className="mt-2 break-all font-mono text-[10px] leading-relaxed text-[#68717b]">{linkedWallet}</p>
                  </div>
                </div>
              </div>
              <div className="space-y-2 text-[10px] leading-relaxed text-[#68717b]">
                <p>Se cerrará únicamente la cuenta de asociación de la wallet del cliente.</p>
                <p className="font-semibold text-[#a33d45]">El historial del cliente, sus compras, ventas y puntos permanecerán intactos. La operación no transfiere tokens ni fondos de la wallet del cliente.</p>
                <p>La renta recuperable de la cuenta cerrada se devolverá a la wallet propietaria del concesionario.</p>
              </div>
              {error && <p className="rounded-lg bg-red-50 p-3 text-[10px] leading-relaxed text-red-700">{error}</p>}
              <div className="flex flex-col-reverse gap-2 border-t border-[#eff0f2] pt-4 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setShowUnlinkModal(false)} disabled={busy} className="rounded-lg border border-[#e2e5e8] px-4 py-2.5 text-[10px] font-semibold text-[#555e68] transition hover:bg-[#f7f8fa] disabled:opacity-50">Cancelar</button>
                <button type="button" onClick={() => void unlinkWallet()} disabled={busy || !connected?.signer} className="rounded-lg bg-[#e60012] px-4 py-2.5 text-[10px] font-semibold text-white transition hover:bg-[#c90010] disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Procesando…" : "Sí, desvincular wallet"}</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
