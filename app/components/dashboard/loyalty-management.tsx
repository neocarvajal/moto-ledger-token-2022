"use client";

import { useState, type FormEvent } from "react";
import { address, getBase64Encoder } from "@solana/kit";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import { toast } from "sonner";
import { useAppClient } from "../../lib/client-provider";
import { useCluster } from "../cluster-context";

type UploadResult = {
  imageUri: string;
  metadataUri: string;
  imageCid: string;
  metadataCid: string;
  groupId: string;
};

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

function createNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function LoyaltyManagement({
  concesionario,
  nombreConcesionario,
}: {
  concesionario: string;
  nombreConcesionario: string;
}) {
  const client = useAppClient();
  const connected = useConnectedWallet(client);
  const { cluster } = useCluster();
  const [name, setName] = useState(`${nombreConcesionario} Rewards`);
  const [symbol, setSymbol] = useState("MOTO");
  const [description, setDescription] = useState(
    `Programa de fidelización de ${nombreConcesionario} en MotoLedger.`
  );
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  const supportedCluster = cluster === "devnet" || cluster === "mainnet";
  const apiCluster = cluster === "mainnet" ? "mainnet-beta" : "devnet";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!connected?.signer || !connected.account) {
      toast.error("Conecta una wallet que permita firmar mensajes.");
      return;
    }
    if (!supportedCluster) {
      toast.error("La subida de metadata solo está habilitada en Devnet y Mainnet.");
      return;
    }
    if (!image) {
      toast.error("Selecciona la imagen del programa de fidelización.");
      return;
    }
    if (!ALLOWED_TYPES.includes(image.type) || image.size === 0 || image.size > MAX_IMAGE_SIZE) {
      toast.error("La imagen debe ser PNG, JPG o WEBP y pesar máximo 5 MB.");
      return;
    }
    if (name.trim().length < 3 || name.trim().length > 64) {
      toast.error("El nombre debe tener entre 3 y 64 caracteres.");
      return;
    }
    if (symbol.trim().length < 2 || symbol.trim().length > 10) {
      toast.error("El símbolo debe tener entre 2 y 10 caracteres.");
      return;
    }
    if (description.trim().length > 500) {
      toast.error("La descripción no puede superar 500 caracteres.");
      return;
    }

    setBusy(true);
    setResult(null);
    try {
      const dealershipAccount = await client.registro.accounts.concesionario.fetch(
        address(concesionario)
      );
      if (dealershipAccount.data.owner !== connected.account.address) {
        throw new Error("La wallet conectada no es propietaria de este concesionario.");
      }

      const timestamp = Date.now();
      const nonce = createNonce();
      const wallet = connected.account.address;
      const message = [
        "MotoLedger IPFS metadata upload",
        `wallet:${wallet}`,
        `dealership:${concesionario}`,
        `cluster:${apiCluster}`,
        `timestamp:${timestamp}`,
        `nonce:${nonce}`,
      ].join("\n");

      const signature = await client.wallet.signMessage(
        new TextEncoder().encode(message)
      );
      const form = new FormData();
      form.set("name", name.trim());
      form.set("symbol", symbol.trim().toUpperCase());
      form.set("description", description.trim());
      form.set("wallet", wallet);
      form.set("dealership", concesionario);
      form.set("cluster", apiCluster);
      form.set("timestamp", String(timestamp));
      form.set("nonce", nonce);
      form.set("signature", getBase64Encoder().encode(signature));
      form.set("image", image);

      const response = await fetch("/api/ipfs/upload", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as UploadResult | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload && payload.error ? payload.error : "No se pudo subir la metadata.");
      }

      setResult(payload as UploadResult);
      toast.success("Imagen y metadata subidas al grupo IPFS del concesionario.");
    } catch (error) {
      console.error("No se pudo cargar la metadata de fidelización:", error);
      toast.error(
        error instanceof Error ? error.message : "No se pudo subir la metadata a IPFS."
      );
    } finally {
      setBusy(false);
    }
  };

  const copyValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copiado.`);
    } catch {
      toast.error("No se pudo copiar al portapapeles.");
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[#e9ebee] bg-white p-6 shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
        <div>
          <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">FIDELIZACIÓN / METADATA DEL TOKEN</p>
          <h2 className="mt-2 text-[15px] font-bold text-[#252a30]">Identidad del programa de puntos</h2>
          <p className="mt-1 text-[10px] leading-relaxed text-[#858d96]">
            Prepara la imagen y los metadatos públicos del token de fidelización. Los archivos se guardan juntos en el grupo Pinata de este concesionario.
          </p>
        </div>

        <div className="mt-5 rounded-lg bg-[#f7f8fa] p-4">
          <p className="text-[9px] font-bold tracking-wide text-[#9299a1]">CONCESIONARIO</p>
          <p className="mt-1 text-[12px] font-bold text-[#252a30]">{nombreConcesionario}</p>
          <p className="mt-1 break-all font-mono text-[9px] text-[#858d96]">{concesionario}</p>
          <p className="mt-2 text-[9px] text-[#858d96]">Red seleccionada: <span className="font-semibold uppercase">{cluster}</span></p>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Nombre del token</span>
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={64} disabled={busy} required className="w-full rounded-lg border border-[#e2e5e8] px-3 py-2.5 text-[12px] outline-none focus:border-[#e60012] disabled:bg-[#f7f8fa]" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Símbolo</span>
              <input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} maxLength={10} disabled={busy} required className="w-full rounded-lg border border-[#e2e5e8] px-3 py-2.5 text-[12px] uppercase outline-none focus:border-[#e60012] disabled:bg-[#f7f8fa]" />
            </label>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Descripción</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={3} disabled={busy} className="w-full resize-y rounded-lg border border-[#e2e5e8] px-3 py-2.5 text-[12px] outline-none focus:border-[#e60012] disabled:bg-[#f7f8fa]" />
            <span className="mt-1 block text-right text-[9px] text-[#a0a6ad]">{description.length}/500</span>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Imagen del programa</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => setImage(event.target.files?.[0] ?? null)} className="block w-full rounded-lg border border-[#e2e5e8] bg-white px-3 py-2.5 text-[11px] text-[#555e68] file:mr-3 file:rounded-md file:border-0 file:bg-[#fff0f1] file:px-3 file:py-1.5 file:text-[10px] file:font-semibold file:text-[#d90011]" />
            <span className="mt-1 block text-[9px] text-[#a0a6ad]">PNG, JPG o WEBP · máximo 5 MB.</span>
            {image && <span className="mt-1 block text-[9px] font-medium text-[#555e68]">{image.name} · {(image.size / 1024 / 1024).toFixed(2)} MB</span>}
          </label>

          {!supportedCluster && (
            <div className="rounded-lg border border-[#f1dfe0] bg-[#fff9f9] p-3 text-[10px] leading-relaxed text-[#95666a]">
              Cambia a Devnet o Mainnet para subir la metadata. La verificación del endpoint no admite Testnet ni Localnet.
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#eff0f2] pt-4">
            <p className="max-w-md text-[9px] leading-relaxed text-[#9299a1]">
              La wallet firmará un mensaje de autorización, no una transacción. La firma no mueve fondos ni crea el mint.
            </p>
            <button type="submit" disabled={busy || !supportedCluster || !connected?.signer} className="rounded-lg bg-[#e60012] px-4 py-2.5 text-[10px] font-semibold text-white transition hover:bg-[#c90010] disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? "Subiendo a Pinata…" : "Firmar y subir metadata"}
            </button>
          </div>
        </form>
      </section>

      {result && (
        <section className="rounded-xl border border-[#ccebdc] bg-white p-6 shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#edf8f2] text-[#168451]">✓</span>
            <div>
              <h3 className="text-[13px] font-bold text-[#252a30]">Metadata almacenada en IPFS</h3>
              <p className="text-[9px] text-[#858d96]">Ambos archivos pertenecen al grupo de este concesionario.</p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {[
              { label: "URI de metadata", value: result.metadataUri },
              { label: "URI de imagen", value: result.imageUri },
              { label: "CID de metadata", value: result.metadataCid },
              { label: "CID de imagen", value: result.imageCid },
              { label: "Grupo Pinata", value: result.groupId },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-[#eff0f2] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[9px] font-bold tracking-wide text-[#9299a1]">{item.label.toUpperCase()}</p>
                  <button type="button" onClick={() => void copyValue(item.value, item.label)} className="shrink-0 text-[9px] font-semibold text-[#d90011] hover:underline">Copiar</button>
                </div>
                <p className="mt-1 break-all font-mono text-[10px] text-[#555e68]">{item.value}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[9px] leading-relaxed text-[#9299a1]">
            Guarda la URI de metadata para inicializar la extensión TokenMetadata cuando creemos el mint Token-2022. Esta subida todavía no modifica ningún mint.
          </p>
        </section>
      )}
    </div>
  );
}
