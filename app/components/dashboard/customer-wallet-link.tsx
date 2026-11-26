"use client";

import { useEffect, useRef, useState } from "react";
import {
  address,
  appendTransactionMessageInstruction,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  partiallySignTransactionMessageWithSigners,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  assertIsSendableTransaction,
  assertIsTransactionWithBlockhashLifetime,
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
  concesionario,
  totalMotos,
}: {
  cliente: string;
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
  const [error, setError] = useState<string | null>(null);
  const [successSignature, setSuccessSignature] = useState<string | null>(null);
  const buildingRef = useRef(false);
  const sendingRef = useRef(false);

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
    if (!token || !session?.walletAddress || !connected?.signer || !connected.account.address) return;
    if (connected.account.address !== session.owner || session.concesionario !== concesionario) {
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
        owner: connected.signer,
        wallet: createNoopSigner(address(session.walletAddress)),
        cliente: address(cliente),
        walletCliente,
      });

      const latestBlockhash = await client.rpc
        .getLatestBlockhash({ commitment: "confirmed" })
        .send();

      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayerSigner(connected.signer!, tx),
        (tx) => appendTransactionMessageInstruction(instruction, tx),
        (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash.value, tx)
      );

      const [partiallySigned] = await partiallySignTransactionMessageWithSigners(message);
      const ownerSignature = partiallySigned.signatures[connected.account.address];
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
    setBusy(true);
    setError(null);

    void (async () => {
      try {
        const transactionBytes = getBase64Encoder().encode(session.signedTransaction!);
        const transaction = getTransactionDecoder().decode(transactionBytes);
        assertIsSendableTransaction(transaction);
        assertIsTransactionWithBlockhashLifetime(transaction);
        const sendAndConfirm = sendAndConfirmTransactionFactory({
          rpc: client.rpc,
          rpcSubscriptions: client.rpcSubscriptions,
        });
        await sendAndConfirm(transaction, { commitment: "confirmed" });
        const signature = getSignatureFromTransaction(transaction);
        await fetch(`/api/wallet-link/${token}/complete`, { method: "POST" });
        setSuccessSignature(signature);
        setLinkedWallet(session.walletAddress);
        setSession((current) => current ? { ...current, status: "completed" } : current);
        toast.success("Wallet del cliente vinculada correctamente.");
      } catch (cause) {
        sendingRef.current = false;
        setError(cause instanceof Error ? cause.message : "No se pudo enviar la transacción.");
      } finally {
        setBusy(false);
      }
    })();
  }, [token, session?.signedTransaction, session?.status, session?.walletAddress, client]);

  const closeRequest = async () => {
    if (token) await fetch(`/api/wallet-link/${token}/cancel`, { method: "POST" }).catch(() => undefined);
    setToken(null);
    setUrl(null);
    setSession(null);
    setError(null);
    buildingRef.current = false;
    sendingRef.current = false;
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
    try {
      const response = await fetch("/api/wallet-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: connected.account.address,
          cliente,
          concesionario,
          cluster,
        }),
      });
      const payload = (await response.json()) as { token?: string; error?: string };
      if (!response.ok || !payload.token) throw new Error(payload.error ?? "No se pudo crear el QR.");
      setToken(payload.token);
      setUrl(`${window.location.origin}/vincular-wallet/${payload.token}`);
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
        </div>
        {!linkedWallet && totalMotos > 0 && !token && (
          <button type="button" onClick={() => void startLink()} disabled={busy || checking || !connected?.signer} className="rounded-lg bg-[#e60012] px-3 py-2 text-[10px] font-semibold text-white hover:bg-[#c90010] disabled:opacity-50">
            {busy ? "Preparando…" : "Vincular mediante QR"}
          </button>
        )}
      </div>

      {totalMotos <= 0 && !linkedWallet && (
        <p className="mt-3 text-[9px] leading-relaxed text-[#9299a1]">El cliente debe tener al menos una compra registrada para poder vincular una wallet.</p>
      )}

      {token && url && !successSignature && (
        <div className="mt-4 grid gap-4 border-t border-[#eff0f2] pt-4 sm:grid-cols-[148px_1fr] sm:items-center">
          <div className="mx-auto rounded-xl border border-[#e9ebee] bg-white p-2">
            <QRCodeSVG value={url} size={132} level="M" includeMargin />
          </div>
          <div>
            <p className="text-[11px] font-bold text-[#252a30]">Escanea con el teléfono del comprador</p>
            <p className="mt-1 text-[10px] leading-relaxed text-[#737b84]">
              El cliente abrirá esta solicitud y conectará su wallet. El concesionario preparará y firmará la transacción; después, el comprador la completará desde el teléfono.
            </p>
            <p className="mt-3 text-[9px] font-semibold text-[#e60012]">
              {!session?.walletAddress ? "Esperando que el cliente conecte su wallet…" : !session.transaction ? "Verifica la dirección y autoriza la wallet del comprador." : session.status === "signed" ? "Firma recibida. Enviando a Solana…" : "Esperando la firma del cliente…"}
            </p>
            {session?.walletAddress && !session.transaction && (
              <div className="mt-3 rounded-lg border border-[#f0d9b9] bg-[#fffaf2] p-3">
                <p className="text-[9px] font-semibold text-[#9a641f]">WALLET DETECTADA · CONFIRMA CON EL COMPRADOR</p>
                <p className="mt-1 break-all font-mono text-[10px] text-[#424950]">{session.walletAddress}</p>
                <button type="button" onClick={() => void authorizeWallet()} disabled={busy || !connected?.signer} className="mt-3 rounded-lg bg-[#e60012] px-3 py-2 text-[10px] font-semibold text-white disabled:opacity-50">
                  {busy ? "Preparando transacción…" : "Confirmar wallet y firmar"}
                </button>
              </div>
            )}
            <p className="mt-2 break-all text-[9px] text-[#9aa1a9]">{url}</p>
            <p className="mt-2 text-[9px] text-[#9aa1a9]">El QR caduca en cinco minutos.</p>
            <button type="button" onClick={() => void closeRequest()} className="mt-3 text-[9px] font-semibold text-[#737b84] underline">Cerrar solicitud</button>
          </div>
        </div>
      )}

      {successSignature && (
        <div className="mt-3 rounded-lg bg-[#f3fbf6] p-3">
          <p className="text-[10px] font-semibold text-[#168354]">Vinculación confirmada en Solana.</p>
          <a className="mt-1 inline-block break-all text-[9px] text-[#168354] underline" href={`https://explorer.solana.com/tx/${successSignature}?cluster=${cluster}`} target="_blank" rel="noopener noreferrer">Ver transacción ↗</a>
        </div>
      )}

      {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-[10px] leading-relaxed text-red-700">{error}</p>}
    </div>
  );
}
