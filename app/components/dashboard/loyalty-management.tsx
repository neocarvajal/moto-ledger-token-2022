"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import { address, unwrapOption } from "@solana/kit";
import {
  fetchMint,
  getUpdateTokenMetadataFieldInstruction,
  isExtension,
  tokenMetadataField,
} from "@solana-program/token-2022";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import { toast } from "sonner";
import { useAppClient } from "../../lib/client-provider";
import { useCluster } from "../cluster-context";
import { createLoyaltyMint } from "../../lib/moto-ledger/loyalty-mint";
import { deriveProgramaFidelidadPda } from "../../lib/moto-ledger/pdas";

type TokenMetadataJson = {
  name: string;
  symbol: string;
  description: string;
  image: string;
};

type UploadResult = {
  imageUri: string;
  metadataUri: string;
  imageCid: string;
  metadataCid: string;
  imageFileId: string;
  metadataFileId: string;
  metadata: TokenMetadataJson;
};

type MintResult = {
  mint: string;
  programaFidelidad: string;
  autoridadFidelidad: string;
  signature: string;
};

type ExistingLoyaltyProgram = {
  mint: string;
  programaFidelidad: string;
  puntosPorVenta: bigint;
  name: string;
  symbol: string;
  description: string;
  imageUri: string | null;
  metadataUri: string;
  updateAuthority: string | null;
};

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

function createNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toGatewayUrl(uri: string, cid: string) {
  if (uri.startsWith("https://") || uri.startsWith("http://")) return uri;

  const gateway = process.env.NEXT_PUBLIC_GATEWAY_URL
    ?.trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");

  if (!gateway) {
    throw new Error("No se pudo generar el enlace público. Revisa NEXT_PUBLIC_GATEWAY_URL.");
  }

  const path = uri.startsWith("ipfs://")
    ? uri.slice("ipfs://".length)
    : uri.replace(/^\/?ipfs\//i, "");

  return "https://" + gateway + "/ipfs/" + (path || cid);
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
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mintBusy, setMintBusy] = useState(false);
  const [pointsPerSale, setPointsPerSale] = useState("100");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [mintResult, setMintResult] = useState<MintResult | null>(null);
  const [existingProgram, setExistingProgram] = useState<ExistingLoyaltyProgram | null>(null);
  const [programLoading, setProgramLoading] = useState(true);
  const [programLoadError, setProgramLoadError] = useState<string | null>(null);
  const [reloadProgram, setReloadProgram] = useState(0);
  const [updateBusy, setUpdateBusy] = useState(false);

  useEffect(() => {
    setName(`${nombreConcesionario} Rewards`);
    setDescription(`Programa de fidelización de ${nombreConcesionario} en MotoLedger.`);
    setImage(null);
    setResult(null);
    setMintResult(null);
  }, [concesionario, nombreConcesionario]);

  useEffect(() => {
    let cancelled = false;

    async function loadExistingProgram() {
      setProgramLoading(true);
      setProgramLoadError(null);
      setExistingProgram(null);

      try {
        const [programaFidelidad] = await deriveProgramaFidelidadPda(
          address(concesionario)
        );
        const programInfo = await client.rpc
          .getAccountInfo(programaFidelidad, { encoding: "base64" })
          .send();

        // A dealership without a loyalty PDA is a valid first-time state.
        if (!programInfo.value) {
          if (!cancelled) {
            setExistingProgram(null);
            setProgramLoadError(null);
          }
          return;
        }

        const account = await client.registro.accounts.programaFidelidad.fetch(
          programaFidelidad
        );

        const mintAddress = account.data.mint;
        const mintAccount = await fetchMint(client.rpc, mintAddress);
        const extensions = unwrapOption(mintAccount.data.extensions) ?? [];
        const tokenMetadata = extensions.find((item) =>
          isExtension("TokenMetadata", item)
        );

        if (!tokenMetadata) {
          throw new Error("El mint no contiene la extensión TokenMetadata.");
        }

        const metadataUri = tokenMetadata.uri;
        let description = "";
        const additionalMetadata = tokenMetadata.additionalMetadata;
        if (additionalMetadata instanceof Map) {
          description = additionalMetadata.get("description") ?? "";
        }

        let imageUri: string | null = null;
        try {
          const metadataCid = metadataUri.startsWith("ipfs://")
            ? metadataUri.slice("ipfs://".length).split("/")[0]
            : new URL(metadataUri).pathname.match(/\/ipfs\/([^/]+)/)?.[1];

          if (!metadataCid) {
            throw new Error("La URI on-chain no contiene un CID IPFS válido.");
          }

          // Fetch through our server to avoid browser CORS restrictions on public IPFS gateways.
          const metadataResponse = await fetch(
            `/api/ipfs/metadata?cid=${encodeURIComponent(metadataCid)}`,
            { cache: "no-store" }
          );
          if (metadataResponse.ok) {
            const metadataJson = (await metadataResponse.json()) as {
              image?: string;
              description?: string;
            };
            if (metadataJson.image) {
              imageUri = toGatewayUrl(metadataJson.image, "");
            }
            if (!description && metadataJson.description) {
              description = metadataJson.description;
            }
          }
        } catch (metadataError) {
          console.warn("No se pudo recuperar el JSON de metadata:", metadataError);
        }

        const updateAuthority = unwrapOption(tokenMetadata.updateAuthority);

        if (!cancelled) {
          setExistingProgram({
            mint: mintAddress,
            programaFidelidad,
            puntosPorVenta: account.data.puntosPorVenta,
            name: tokenMetadata.name,
            symbol: tokenMetadata.symbol,
            description,
            imageUri,
            metadataUri,
            updateAuthority: updateAuthority ?? null,
          });
          setName(tokenMetadata.name);
          setSymbol(tokenMetadata.symbol);
          setDescription(description);
        }
      } catch (error) {
        // A missing PDA means this dealership has not created its loyalty
        // program on the selected cluster yet. Other errors are shown below.
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "";
          const isMissingAccount =
            message.toLowerCase().includes("account not found") ||
            message.toLowerCase().includes("could not find") ||
            message.toLowerCase().includes("does not exist");
          if (!isMissingAccount) {
            console.error("Error al consultar la fidelización:", error);
            setProgramLoadError(
              "No se pudo consultar el programa de fidelización en Solana. Revisa la red seleccionada e inténtalo nuevamente."
            );
          }
        }
      } finally {
        if (!cancelled) setProgramLoading(false);
      }
    }

    void loadExistingProgram();
    return () => {
      cancelled = true;
    };
  }, [client, concesionario, cluster, reloadProgram]);

  useEffect(() => {
    if (!image) {
      setImagePreview(null);
      return;
    }

    const objectUrl = URL.createObjectURL(image);
    setImagePreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [image]);

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
      const signatureBase64 = btoa(
        Array.from(signature, (byte) => String.fromCharCode(byte)).join("")
      );
      form.set("signature", signatureBase64);
      form.set("image", image);

      const response = await fetch("/api/ipfs/upload", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as UploadResult | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload && payload.error ? payload.error : "No se pudo subir la metadata.");
      }

      const uploaded = payload as UploadResult;
      const publicImageUri = toGatewayUrl(uploaded.imageUri, uploaded.imageCid);
      const usableResult: UploadResult = {
        ...uploaded,
        imageUri: publicImageUri,
        metadataUri: toGatewayUrl(uploaded.metadataUri, uploaded.metadataCid),
        metadata: uploaded.metadata ?? {
          name: name.trim(),
          symbol: symbol.trim().toUpperCase(),
          description: description.trim(),
          image: publicImageUri,
        },
      };
      setResult(usableResult);
      toast.success("Imagen y metadata subidas correctamente a IPFS.");
    } catch (error) {
      console.error("No se pudo cargar la metadata de fidelización:", error);
      toast.error(
        error instanceof Error ? error.message : "No se pudo subir la metadata a IPFS."
      );
    } finally {
      setBusy(false);
    }
  };

  const handleCreateMint = async () => {
    if (!connected?.signer || !connected.account) {
      toast.error("Conecta una wallet que permita firmar transacciones.");
      return;
    }
    if (!result) {
      toast.error("Primero debes subir la metadata del programa a IPFS.");
      return;
    }
    if (!supportedCluster) {
      toast.error("La creación del mint solo está habilitada en Devnet y Mainnet.");
      return;
    }

    const parsedPoints = Number(pointsPerSale);
    if (!Number.isSafeInteger(parsedPoints) || parsedPoints <= 0) {
      toast.error("Los puntos por venta deben ser un entero mayor a cero.");
      return;
    }

    setMintBusy(true);
    setMintResult(null);
    try {
      const dealershipAddress = address(concesionario);
      const dealershipAccount = await client.registro.accounts.concesionario.fetch(
        dealershipAddress
      );
      if (dealershipAccount.data.owner !== connected.account.address) {
        throw new Error("La wallet conectada no es propietaria de este concesionario.");
      }

      const created = await createLoyaltyMint({
        client,
        owner: connected.signer,
        concesionario: dealershipAddress,
        nombreConcesionario,
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        description: description.trim(),
        metadataUri: result.metadataUri,
        puntosPorVenta: BigInt(parsedPoints),
      });

      setMintResult({
        mint: created.mint,
        programaFidelidad: created.programaFidelidad,
        autoridadFidelidad: created.autoridadFidelidad,
        signature: created.signature,
      });
      toast.success("Mint Token-2022 creado y programa de fidelización registrado.");
    } catch (error) {
      console.error("No se pudo crear el mint de fidelización:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo crear el mint Token-2022."
      );
    } finally {
      setMintBusy(false);
    }
  };

  const handleUpdateExistingMetadata = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!existingProgram || !connected?.signer || !connected.account) {
      toast.error("Conecta la wallet propietaria del programa para actualizar la metadata.");
      return;
    }
    if (existingProgram.updateAuthority !== connected.account.address) {
      toast.error("La wallet conectada no es la autoridad de actualización de TokenMetadata.");
      return;
    }
    if (!image) {
      toast.error("Selecciona la nueva imagen del programa.");
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

    setUpdateBusy(true);
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
      const signature = await client.wallet.signMessage(new TextEncoder().encode(message));

      const form = new FormData();
      form.set("name", name.trim());
      form.set("symbol", symbol.trim().toUpperCase());
      form.set("description", description.trim());
      form.set("wallet", wallet);
      form.set("dealership", concesionario);
      form.set("cluster", apiCluster);
      form.set("timestamp", String(timestamp));
      form.set("nonce", nonce);
      const signatureBase64 = btoa(
        Array.from(signature, (byte) => String.fromCharCode(byte)).join("")
      );
      form.set("signature", signatureBase64);
      form.set("image", image);

      const response = await fetch("/api/ipfs/upload", { method: "POST", body: form });
      const payload = (await response.json()) as UploadResult | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload && payload.error
          ? payload.error
          : "No se pudo subir la nueva metadata a IPFS.");
      }

      const uploaded = payload as UploadResult;
      const imageUri = toGatewayUrl(uploaded.imageUri, uploaded.imageCid);
      const metadataUri = toGatewayUrl(uploaded.metadataUri, uploaded.metadataCid);
      const mintAddress = address(existingProgram.mint);
      const instructions = [
        getUpdateTokenMetadataFieldInstruction({
          metadata: mintAddress,
          updateAuthority: connected.signer,
          field: tokenMetadataField("Name"),
          value: name.trim(),
        }),
        getUpdateTokenMetadataFieldInstruction({
          metadata: mintAddress,
          updateAuthority: connected.signer,
          field: tokenMetadataField("Symbol"),
          value: symbol.trim().toUpperCase(),
        }),
        getUpdateTokenMetadataFieldInstruction({
          metadata: mintAddress,
          updateAuthority: connected.signer,
          field: tokenMetadataField("Uri"),
          value: metadataUri,
        }),
        getUpdateTokenMetadataFieldInstruction({
          metadata: mintAddress,
          updateAuthority: connected.signer,
          field: tokenMetadataField("Key", ["description"]),
          value: description.trim(),
        }),
      ];

      await client.sendTransaction(instructions);
      setResult({
        ...uploaded,
        imageUri,
        metadataUri,
        metadata: uploaded.metadata ?? {
          name: name.trim(),
          symbol: symbol.trim().toUpperCase(),
          description: description.trim(),
          image: imageUri,
        },
      });
      setImage(null);
      setImagePreview(null);
      setReloadProgram((value) => value + 1);
      toast.success("Metadata actualizada en el mint Token-2022 existente.");
    } catch (error) {
      console.error("No se pudo actualizar la metadata de fidelización:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar la metadata del token."
      );
    } finally {
      setUpdateBusy(false);
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

  if (programLoading) {
    return (
      <section className="rounded-xl border border-[#e9ebee] bg-white p-6">
        <p className="text-[10px] font-semibold text-[#555e68]">
          Consultando el programa de fidelización en Solana…
        </p>
      </section>
    );
  }

  if (programLoadError) {
    return (
      <section className="rounded-xl border border-[#f1dfe0] bg-white p-6">
        <h2 className="text-[13px] font-bold text-[#252a30]">No se pudo cargar la fidelización</h2>
        <p className="mt-2 text-[10px] leading-relaxed text-[#95666a]">{programLoadError}</p>
        <button
          type="button"
          onClick={() => {
            setProgramLoadError(null);
            setProgramLoading(true);
            setReloadProgram((value) => value + 1);
          }}
          className="mt-3 rounded-lg bg-[#e60012] px-3 py-2 text-[10px] font-semibold text-white"
        >
          Volver a consultar
        </button>
      </section>
    );
  }

  if (existingProgram) {
    return (
      <section className="rounded-xl border border-[#ccebdc] bg-white p-5 shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[9px] font-bold tracking-[0.16em] text-[#168451]">TOKEN-2022 / PROGRAMA ACTIVO</p>
            <h2 className="mt-2 text-[15px] font-bold text-[#252a30]">Programa de fidelización</h2>
            <p className="mt-1 text-[10px] text-[#858d96]">
              Configuración recuperada directamente desde Solana.
            </p>
          </div>
          <span className="rounded-full bg-[#edf8f2] px-3 py-1 text-[9px] font-semibold text-[#168451]">Activo</span>
        </div>

        <div className="mt-4 flex flex-col gap-4 rounded-lg bg-[#f7f8fa] p-4 sm:flex-row sm:items-center">
          <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#e2e5e8] bg-white">
            {existingProgram.imageUri ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={existingProgram.imageUri}
                alt={existingProgram.name}
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="px-2 text-center text-[10px] text-[#9299a1]">
                Imagen no disponible
              </span>
            )}
          </div>
          <div className="min-w-0">
            <h3 className="text-[14px] font-bold text-[#252a30]">{existingProgram.name}</h3>
            <p className="mt-1 text-[10px] font-semibold tracking-wide text-[#d90011]">{existingProgram.symbol}</p>
            <p className="mt-2 text-[10px] leading-relaxed text-[#858d96]">
              {existingProgram.description || "Sin descripción"}
            </p>
            <a href={existingProgram.metadataUri} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[9px] font-semibold text-[#d90011] underline">
              Ver metadata JSON ↗
            </a>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <a
            href={`https://explorer.solana.com/address/${existingProgram.mint}?cluster=${apiCluster}`}
            target="_blank"
            rel="noopener noreferrer"
            title={existingProgram.mint}
            className="rounded-lg border border-[#eff0f2] p-3 hover:border-[#e60012]"
          >
            <p className="text-[9px] font-bold tracking-wide text-[#9299a1]">MINT TOKEN-2022</p>
            <p className="mt-1 break-all font-mono text-[10px] text-[#555e68]">{existingProgram.mint}</p>
            <p className="mt-2 text-[9px] font-semibold text-[#d90011]">Ver mint en Explorer ↗</p>
          </a>
          <div className="rounded-lg border border-[#eff0f2] p-3">
            <p className="text-[9px] font-bold tracking-wide text-[#9299a1]">PUNTOS POR VENTA</p>
            <p className="mt-1 text-[20px] font-bold text-[#252a30]">{existingProgram.puntosPorVenta.toString()}</p>
            <p className="mt-1 text-[9px] text-[#858d96]">Puntos configurados on-chain</p>
          </div>
        </div>

        <form onSubmit={handleUpdateExistingMetadata} className="mt-4 rounded-lg border border-[#eff0f2] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-[11px] font-bold text-[#252a30]">Actualizar identidad del token</h3>
              <p className="mt-1 text-[9px] text-[#858d96]">Sube una nueva imagen y actualiza el JSON y TokenMetadata del mint existente.</p>
            </div>
            <span className="rounded-full bg-[#f7f8fa] px-2 py-1 text-[9px] text-[#858d96]">No crea otro mint</span>
          </div>

          {existingProgram.updateAuthority !== connected?.account?.address && (
            <p className="mt-3 rounded-md bg-[#fff9f9] p-2 text-[9px] leading-relaxed text-[#95666a]">
              La wallet conectada no es la autoridad de actualización de este mint. Puedes consultar la imagen y metadata, pero otra wallet debe firmar los cambios.
            </p>
          )}

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[9px] font-semibold text-[#555e68]">Nombre</span>
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={64} disabled={updateBusy} required className="w-full rounded-lg border border-[#e2e5e8] px-3 py-2 text-[11px]" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[9px] font-semibold text-[#555e68]">Símbolo</span>
              <input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} maxLength={10} disabled={updateBusy} required className="w-full rounded-lg border border-[#e2e5e8] px-3 py-2 text-[11px]" />
            </label>
          </div>
          <label className="mt-3 block">
            <span className="mb-1 block text-[9px] font-semibold text-[#555e68]">Descripción</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={2} disabled={updateBusy} className="w-full rounded-lg border border-[#e2e5e8] px-3 py-2 text-[11px]" />
          </label>
          <label className="mt-3 block">
            <span className="mb-1 block text-[9px] font-semibold text-[#555e68]">Nueva imagen</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setImage(event.target.files?.[0] ?? null)} disabled={updateBusy} className="block w-full rounded-lg border border-[#e2e5e8] px-2 py-2 text-[10px]" />
          </label>
          {imagePreview && (
            <div className="mt-3 flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagePreview} alt="Vista previa de la nueva imagen" className="h-16 w-16 rounded-lg border object-contain" />
              <span className="text-[9px] text-[#858d96]">Nueva imagen seleccionada</span>
            </div>
          )}
          <div className="mt-4 flex justify-end">
            <button type="submit" disabled={updateBusy || !image || existingProgram.updateAuthority !== connected?.account?.address || !supportedCluster} className="rounded-lg bg-[#e60012] px-4 py-2.5 text-[10px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
              {updateBusy ? "Actualizando metadata…" : "Actualizar metadata del mint"}
            </button>
          </div>
        </form>

        <a
          href={`https://explorer.solana.com/address/${existingProgram.programaFidelidad}?cluster=${apiCluster}`}
          target="_blank"
          rel="noopener noreferrer"
          title={existingProgram.programaFidelidad}
          className="mt-3 block rounded-lg bg-[#f7f8fa] p-3"
        >
          <p className="text-[9px] font-bold tracking-wide text-[#9299a1]">PDA DEL PROGRAMA</p>
          <p className="mt-1 break-all font-mono text-[10px] text-[#555e68]">{existingProgram.programaFidelidad}</p>
          <p className="mt-2 text-[9px] font-semibold text-[#d90011]">Ver cuenta en Explorer ↗</p>
        </a>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[#e9ebee] bg-white p-6 shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
        <div>
          <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">FIDELIZACIÓN / METADATA DEL TOKEN</p>
          <h2 className="mt-2 text-[15px] font-bold text-[#252a30]">Identidad del programa de puntos</h2>
          <p className="mt-1 text-[10px] leading-relaxed text-[#858d96]">
            Prepara la imagen y los metadatos públicos del token de fidelización. Los archivos se almacenan en IPFS mediante Pinata.
          </p>
        </div>

        <div className="mt-5 rounded-lg bg-[#f7f8fa] p-4">
          <p className="text-[9px] font-bold tracking-wide text-[#9299a1]">CONCESIONARIO</p>
          <p className="mt-1 text-[12px] font-bold text-[#252a30]">{nombreConcesionario}</p>
          <p className="mt-1 break-all font-mono text-[9px] text-[#858d96]">{concesionario}</p>
          <p className="mt-2 text-[9px] text-[#858d96]">Red seleccionada: <span className="font-semibold uppercase">{cluster}</span></p>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="grid gap-5 md:grid-cols-[190px_minmax(0,1fr)]">
            <div className="space-y-3">
              <div>
                <p className="mb-1.5 text-[10px] font-semibold text-[#555e68]">Logo del token</p>
                <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-[#d9dde2] bg-[#f7f8fa]">
                  {imagePreview ? (
                    <Image
                      src={imagePreview}
                      alt={`Logo de ${name || "token"}`}
                      width={190}
                      height={190}
                      unoptimized
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="px-4 text-center">
                      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white text-2xl text-[#b4bbc3]">◎</span>
                      <p className="mt-2 text-[10px] font-medium text-[#858d96]">Vista previa del logo</p>
                      <p className="mt-1 text-[9px] text-[#a0a6ad]">Selecciona una imagen</p>
                    </div>
                  )}
                </div>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Imagen del programa</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { setImage(event.target.files?.[0] ?? null); if (!mintResult) setResult(null); }} disabled={busy || !!mintResult} className="block w-full rounded-lg border border-[#e2e5e8] bg-white px-2 py-2 text-[10px] text-[#555e68] file:mr-2 file:rounded-md file:border-0 file:bg-[#fff0f1] file:px-2 file:py-1.5 file:text-[9px] file:font-semibold file:text-[#d90011]" />
                <span className="mt-1 block text-[9px] text-[#a0a6ad]">PNG, JPG o WEBP · máximo 5 MB.</span>
                {image && <span className="mt-1 block break-all text-[9px] font-medium text-[#555e68]">{image.name} · {(image.size / 1024 / 1024).toFixed(2)} MB</span>}
              </label>
            </div>

            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Nombre del token</span>
                  <input value={name} onChange={(event) => { setName(event.target.value); if (!mintResult) setResult(null); }} maxLength={64} disabled={busy || !!mintResult} required className="w-full rounded-lg border border-[#e2e5e8] px-3 py-2.5 text-[12px] outline-none focus:border-[#e60012] disabled:bg-[#f7f8fa]" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Símbolo</span>
                  <input value={symbol} onChange={(event) => { setSymbol(event.target.value.toUpperCase()); if (!mintResult) setResult(null); }} maxLength={10} disabled={busy || !!mintResult} required className="w-full rounded-lg border border-[#e2e5e8] px-3 py-2.5 text-[12px] uppercase outline-none focus:border-[#e60012] disabled:bg-[#f7f8fa]" />
                </label>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Descripción</span>
                <textarea value={description} onChange={(event) => { setDescription(event.target.value); if (!mintResult) setResult(null); }} maxLength={500} rows={5} disabled={busy || !!mintResult} className="w-full resize-y rounded-lg border border-[#e2e5e8] px-3 py-2.5 text-[12px] outline-none focus:border-[#e60012] disabled:bg-[#f7f8fa]" />
                <span className="mt-1 block text-right text-[9px] text-[#a0a6ad]">{description.length}/500</span>
              </label>
              <div className="rounded-lg bg-[#f7f8fa] p-3">
                <p className="text-[9px] font-bold tracking-wide text-[#9299a1]">VISTA PREVIA DE IDENTIDAD</p>
                <div className="mt-2 flex items-center gap-3">
                  {imagePreview && (
                    <Image src={imagePreview} alt="" width={40} height={40} unoptimized className="h-10 w-10 rounded-lg object-cover" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-bold text-[#252a30]">{name || "Nombre del token"}</p>
                    <p className="text-[10px] font-semibold tracking-wide text-[#e60012]">{symbol || "SÍMBOLO"}</p>
                  </div>
                </div>
                <p className="mt-2 line-clamp-2 text-[10px] leading-relaxed text-[#858d96]">{description || "Descripción del programa de fidelización."}</p>
              </div>
            </div>
          </div>

          {!supportedCluster && (
            <div className="rounded-lg border border-[#f1dfe0] bg-[#fff9f9] p-3 text-[10px] leading-relaxed text-[#95666a]">
              Cambia a Devnet o Mainnet para subir la metadata. La verificación del endpoint no admite Testnet ni Localnet.
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#eff0f2] pt-4">
            <p className="max-w-md text-[9px] leading-relaxed text-[#9299a1]">
              La wallet firmará un mensaje de autorización, no una transacción. La firma no mueve fondos ni crea el mint.
            </p>
            <button type="submit" disabled={busy || !!mintResult || !!result || !supportedCluster || !connected?.signer} className="rounded-lg bg-[#e60012] px-4 py-2.5 text-[10px] font-semibold text-white transition hover:bg-[#c90010] disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? "Subiendo a Pinata…" : result ? "Metadata subida" : "Firmar y subir metadata"}
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
              <p className="text-[9px] text-[#858d96]">Los dos archivos están almacenados públicamente en IPFS.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-[#eff0f2] p-3">
              <p className="text-[9px] font-bold tracking-wide text-[#9299a1]">IMAGEN PUBLICADA</p>
              <a
                href={result.imageUri}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block overflow-hidden rounded-lg bg-[#f7f8fa]"
                aria-label="Abrir imagen del programa en una pestaña nueva"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.imageUri}
                  alt={`Imagen del programa ${name}`}
                  className="h-40 w-full object-contain"
                />
              </a>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <a href={result.imageUri} target="_blank" rel="noopener noreferrer" className="text-[10px] font-semibold text-[#d90011] underline decoration-dotted underline-offset-2">
                  Abrir imagen ↗
                </a>
                <button type="button" onClick={() => void copyValue(result.imageUri, "Enlace de imagen")} className="text-[9px] font-semibold text-[#d90011] hover:underline">
                  Copiar enlace
                </button>
              </div>
            </div>

            <div className="flex flex-col rounded-lg border border-[#eff0f2] p-3">
              <p className="text-[9px] font-bold tracking-wide text-[#9299a1]">METADATA JSON</p>
              <div className="mt-2 flex flex-1 flex-col justify-center rounded-lg bg-[#f7f8fa] p-4">
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-[9px] leading-relaxed text-[#555e68]">
                  {JSON.stringify(result.metadata, null, 2)}
                </pre>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <a href={result.metadataUri} target="_blank" rel="noopener noreferrer" className="text-[10px] font-semibold text-[#d90011] underline decoration-dotted underline-offset-2">
                  Abrir metadata JSON ↗
                </a>
                <button type="button" onClick={() => void copyValue(result.metadataUri, "Enlace de metadata")} className="text-[9px] font-semibold text-[#d90011] hover:underline">
                  Copiar enlace
                </button>
              </div>
            </div>
          </div>
          <p className="mt-4 text-[9px] leading-relaxed text-[#9299a1]">
            La metadata está lista para asociarse al mint Token-2022 de este concesionario.
          </p>
        </section>
      )}

      {result && !mintResult && (
        <section className="rounded-xl border border-[#e9ebee] bg-white p-6 shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
          <div>
            <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">TOKEN-2022 / CONFIGURACIÓN ON-CHAIN</p>
            <h2 className="mt-2 text-[15px] font-bold text-[#252a30]">Crear el token de puntos</h2>
            <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-[#858d96]">
              Se creará un mint no transferible con 0 decimales, Metadata Pointer y Token Metadata. La autoridad de emisión pasará a la PDA del programa MotoLedger.
            </p>
          </div>

          <label className="mt-5 block max-w-xs">
            <span className="mb-1.5 block text-[10px] font-semibold text-[#555e68]">Puntos que genera cada venta</span>
            <input
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={pointsPerSale}
              onChange={(event) => setPointsPerSale(event.target.value)}
              disabled={mintBusy}
              className="w-full rounded-lg border border-[#e2e5e8] px-3 py-2.5 text-[12px] outline-none focus:border-[#e60012] disabled:bg-[#f7f8fa]"
            />
            <span className="mt-1 block text-[9px] text-[#a0a6ad]">Este valor podrá actualizarse mediante la instrucción de configuración correspondiente.</span>
          </label>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#eff0f2] pt-4">
            <p className="max-w-lg text-[9px] leading-relaxed text-[#9299a1]">
              Esta operación sí envía una transacción y requiere SOL para rent y fees. Revisa que la wallet y la red seleccionadas sean las correctas.
            </p>
            <button
              type="button"
              onClick={() => void handleCreateMint()}
              disabled={mintBusy || !connected?.signer || !supportedCluster}
              className="rounded-lg bg-[#e60012] px-4 py-2.5 text-[10px] font-semibold text-white transition hover:bg-[#c90010] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {mintBusy ? "Creando mint y registrando programa…" : "Crear mint Token-2022"}
            </button>
          </div>
        </section>
      )}

      {mintResult && (
        <section className="rounded-xl border border-[#ccebdc] bg-white p-4 shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#edf8f2] text-[#168451]">✓</span>
              <div>
                <h3 className="text-[12px] font-bold text-[#252a30]">Programa de fidelización creado</h3>
                <p className="text-[9px] text-[#858d96]">Mint y configuración registrados en Solana.</p>
              </div>
            </div>
            <a
              href={`https://explorer.solana.com/tx/${mintResult.signature}?cluster=${apiCluster}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-semibold text-[#d90011] underline decoration-dotted underline-offset-2"
            >
              Ver transacción ↗
            </a>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {[
              { label: "Mint Token-2022", value: mintResult.mint },
              { label: "PDA del programa", value: mintResult.programaFidelidad },
              { label: "PDA autoridad", value: mintResult.autoridadFidelidad },
            ].map((item) => (
              <a
                key={item.label}
                href={`https://explorer.solana.com/address/${item.value}?cluster=${apiCluster}`}
                target="_blank"
                rel="noopener noreferrer"
                title={item.value}
                className="min-w-0 rounded-lg border border-[#eff0f2] px-3 py-2 transition hover:border-[#e60012]"
              >
                <p className="text-[9px] font-bold tracking-wide text-[#9299a1]">{item.label.toUpperCase()}</p>
                <p className="mt-1 truncate font-mono text-[10px] text-[#555e68]">
                  {item.value.slice(0, 5)}…{item.value.slice(-5)}
                </p>
                <p className="mt-1 text-[9px] font-semibold text-[#d90011]">Ver cuenta ↗</p>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
