"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  address,
  appendTransactionMessageInstruction,
  assertIsTransactionWithBlockhashLifetime,
  createNoopSigner,
  createTransactionMessage,
  getBase58Decoder,
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Base58EncodedBytes,
  type Base64EncodedWireTransaction,
} from "@solana/kit";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { useAppClient } from "../../lib/client-provider";
import { useCluster } from "../cluster-context";
import {
  deriveCanjeServicioPda,
  deriveCatalogoServiciosPda,
  deriveClientePda,
  deriveProgramaFidelidadPda,
  deriveToken2022Ata,
  deriveWalletClientePda,
} from "../../lib/moto-ledger/pdas";
import { REGISTRO_PROGRAM_ADDRESS } from "../../lib/moto-ledger/src/generated/programs";
import { getClienteDecoder, getClienteDiscriminatorBytes, type Cliente } from "../../lib/moto-ledger/src/generated/accounts/cliente";
import { getVentaDecoder, getVentaDiscriminatorBytes, type Venta } from "../../lib/moto-ledger/src/generated/accounts/venta";
import { EstadoGarantia } from "../../lib/moto-ledger/src/generated/types/estadoGarantia";

type Customer = { address: string; data: Cliente };
type Sale = { address: string; data: Venta };
type SelectedSale = Sale & {
  serial: string;
  modelo: string;
  garantia: {
    fechaVencimiento: bigint;
    kilometrajeMaximo: bigint;
    estado: EstadoGarantia;
  };
};
type Service = { id: number; nombre: string; descripcion: string; puntos: bigint; activo: boolean };
type RedemptionSession = { token: string; url: string; expiresAt: number; idCanje: string; status?: string };
type Receipt = { signature: string; address: string; points: bigint };

function shortAddress(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-7)}` : value;
}

function parseMileage(value: string) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 0) {
    throw new Error("Introduce un kilometraje válido.");
  }
  return BigInt(value);
}

export function ServiceRedemptionManagement({ concesionario, nombreConcesionario }: { concesionario: string; nombreConcesionario: string }) {
  const client = useAppClient();
  const connected = useConnectedWallet(client);
  const { cluster } = useCluster();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [catalogReady, setCatalogReady] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [selectedSale, setSelectedSale] = useState("");
  const [selectedService, setSelectedService] = useState("");
  const [mileage, setMileage] = useState("");
  const [mint, setMint] = useState("");
  const [wallet, setWallet] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<RedemptionSession | null>(null);
  const [now, setNow] = useState(Date.now());
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const preparingRef = useRef(false);

  const selectedCustomerRecord = customers.find((item) => item.address === selectedCustomer) ?? null;
  const selectedSaleRecord = sales.find((item) => item.address === selectedSale) ?? null;
  const selectedServiceRecord = services.find((item) => String(item.id) === selectedService) ?? null;

  useEffect(() => {
    if (!showQrModal && !showCancelConfirm) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
    };
  }, [showQrModal, showCancelConfirm]);

  const loadChainData = useCallback(async () => {
    if (!connected?.account.address) {
      setCustomers([]);
      setSales([]);
      setServices([]);
      setCatalogReady(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setCatalogReady(false);
    try {
      const dealer = await client.registro.accounts.concesionario.fetch(address(concesionario));
      if (dealer.data.owner !== connected.account.address) throw new Error("La wallet conectada no es propietaria del concesionario seleccionado.");

      const [programPda] = await deriveProgramaFidelidadPda(address(concesionario));
      const [catalogPda] = await deriveCatalogoServiciosPda(address(concesionario));

      // The loyalty mint must exist, but the redemption catalog is initialized
      // separately and may legitimately be absent on an existing program.
      const programInfo = await client.rpc.getAccountInfo(programPda, { encoding: "base64" }).send();
      if (!programInfo.value) {
        throw new Error("Este concesionario todavía no tiene un programa de fidelización Token-2022. Créalo primero en la sección de fidelización.");
      }
      const program = await client.registro.accounts.programaFidelidad.fetch(programPda);
      if (program.data.concesionario !== concesionario) {
        throw new Error("El programa de fidelización no corresponde a este concesionario.");
      }

      const catalogInfo = await client.rpc.getAccountInfo(catalogPda, { encoding: "base64" }).send();
      let activeServices: Service[] = [];
      if (catalogInfo.value) {
        const catalog = await client.registro.accounts.catalogoServicios.fetch(catalogPda);
        if (catalog.data.concesionario !== concesionario) {
          throw new Error("El catálogo de servicios no corresponde a este concesionario.");
        }
        activeServices = catalog.data.servicios.filter((item) => item.activo);
      }
      setCatalogReady(Boolean(catalogInfo.value));

      const customerDiscriminator = getBase58Decoder().decode(getClienteDiscriminatorBytes()) as Base58EncodedBytes;
      const saleDiscriminator = getBase58Decoder().decode(getVentaDiscriminatorBytes()) as Base58EncodedBytes;
      const ownerFilter = address(connected.account.address) as Base58EncodedBytes;
      const dealerFilter = address(concesionario) as Base58EncodedBytes;
      const [customerAccounts, saleAccounts] = await Promise.all([
        client.rpc.getProgramAccounts(REGISTRO_PROGRAM_ADDRESS, {
          encoding: "base64",
          filters: [
            { memcmp: { offset: 0n, bytes: customerDiscriminator, encoding: "base58" } },
            { memcmp: { offset: 8n, bytes: ownerFilter, encoding: "base58" } },
          ],
        }).send(),
        client.rpc.getProgramAccounts(REGISTRO_PROGRAM_ADDRESS, {
          encoding: "base64",
          filters: [
            { memcmp: { offset: 0n, bytes: saleDiscriminator, encoding: "base58" } },
            { memcmp: { offset: 8n, bytes: dealerFilter, encoding: "base58" } },
          ],
        }).send(),
      ]);
      const customerRecords: Customer[] = customerAccounts.map((item) => ({
        address: item.pubkey,
        data: getClienteDecoder().decode(getBase64Encoder().encode(item.account.data[0])),
      }));
      const saleRecords: Sale[] = saleAccounts.map((item) => ({
        address: item.pubkey,
        data: getVentaDecoder().decode(getBase64Encoder().encode(item.account.data[0])),
      })).filter((sale) => sale.data.concesionario === concesionario &&
        customerRecords.some((customer) => customer.address === sale.data.cliente));

      setCustomers(customerRecords.sort((a, b) => a.data.nombreCliente.localeCompare(b.data.nombreCliente)));
      setSales(saleRecords);
      setServices(activeServices);
      setMint(program.data.mint);
      setSelectedCustomer((current) => customerRecords.some((item) => item.address === current) ? current : "");
      setSelectedSale((current) => saleRecords.some((item) => item.address === current) ? current : "");
    } catch (error) {
      console.error("Blockchain redemption data:", error);
      toast.error(error instanceof Error ? error.message : "No se pudo consultar la configuración on-chain.");
    } finally {
      setLoading(false);
    }
  }, [client, concesionario, connected?.account.address]);

  useEffect(() => { void loadChainData(); }, [loadChainData]);

  const customerSales = useMemo(
    () => sales.filter((sale) => sale.data.cliente === selectedCustomer),
    [sales, selectedCustomer]
  );

  useEffect(() => {
    setSelectedSale((current) => customerSales.some((sale) => sale.address === current) ? current : customerSales[0]?.address ?? "");
  }, [customerSales]);

  const [saleDetails, setSaleDetails] = useState<SelectedSale | null>(null);
  useEffect(() => {
    let active = true;
    setSaleDetails(null);
    if (!selectedSaleRecord) return;
    void (async () => {
      try {
        const moto = await client.registro.accounts.moto.fetch(address(selectedSaleRecord.data.moto));
        if (moto.data.concesionario !== concesionario || moto.data.garantia === undefined) throw new Error("La moto no pertenece al concesionario.");
        const warranty = await client.registro.accounts.garantia.fetch(address(moto.data.garantia));
        if (warranty.data.moto !== selectedSaleRecord.data.moto || warranty.data.concesionario !== concesionario) throw new Error("La garantía no coincide con la venta.");
        if (active) setSaleDetails({
          ...selectedSaleRecord,
          serial: moto.data.serial,
          modelo: `${moto.data.marca} ${moto.data.modelo}`,
          garantia: {
            fechaVencimiento: warranty.data.fechaVencimiento,
            kilometrajeMaximo: warranty.data.kilometrajeMaximo,
            estado: warranty.data.estado,
          },
        });
      } catch (error) {
        if (active) toast.error(error instanceof Error ? error.message : "No se pudo consultar la garantía on-chain.");
      }
    })();
    return () => { active = false; };
  }, [client, concesionario, selectedSaleRecord]);

  const loadCustomerBalance = useCallback(async () => {
    setWallet("");
    setBalance(null);
    if (!selectedCustomer || !mint) return;
    setChecking(true);
    try {
      const [walletPda] = await deriveWalletClientePda(address(selectedCustomer));
      const walletAccount = await client.registro.accounts.walletCliente.fetch(walletPda);
      if (walletAccount.data.cliente !== selectedCustomer) throw new Error("La wallet vinculada no corresponde al cliente.");
      const linkedWallet = walletAccount.data.wallet;
      setWallet(linkedWallet);
      const [ata] = await deriveToken2022Ata(address(linkedWallet), address(mint));
      const info = await client.rpc.getAccountInfo(ata, { encoding: "base64" }).send();
      if (!info.value) {
        setBalance(0n);
        return;
      }
      const tokenBalance = await client.rpc.getTokenAccountBalance(ata).send();
      setBalance(BigInt(tokenBalance.value.amount));
    } catch (error) {
      console.error("Customer token balance:", error);
      toast.error(error instanceof Error ? error.message : "No se pudo consultar el saldo Token-2022.");
    } finally {
      setChecking(false);
    }
  }, [client, selectedCustomer, mint]);

  useEffect(() => { void loadCustomerBalance(); }, [loadCustomerBalance]);

  const prepareRedemptionTransaction = useCallback(async (token: string, idCanjeValue: string) => {
    if (!connected?.signer || !connected.account.address || !selectedCustomerRecord ||
        !selectedSaleRecord || !selectedServiceRecord || !wallet || !mint) {
      throw new Error("No están disponibles los datos necesarios para preparar el canje.");
    }
    const km = parseMileage(mileage);
    const idCanje = BigInt(idCanjeValue);
    const [programaFidelidad] = await deriveProgramaFidelidadPda(address(concesionario));
    const [catalogoServicios] = await deriveCatalogoServiciosPda(address(concesionario));
    const [walletCliente] = await deriveWalletClientePda(address(selectedCustomer));
    const [tokenAccount] = await deriveToken2022Ata(address(wallet), address(mint));
    const [canjeServicio] = await deriveCanjeServicioPda(address(selectedCustomer), idCanje);
    const existing = await client.rpc.getAccountInfo(canjeServicio, { encoding: "base64" }).send();
    if (existing.value) throw new Error("El identificador de canje ya existe. Cancela la solicitud y genera un nuevo QR.");
    const moto = await client.registro.accounts.moto.fetch(address(selectedSaleRecord.data.moto));
    const instruction = client.registro.instructions.canjearServicio({
      owner: connected.signer,
      wallet: createNoopSigner(address(wallet)),
      concesionario: address(concesionario),
      programaFidelidad,
      catalogoServicios,
      cliente: address(selectedCustomer),
      walletCliente,
      venta: address(selectedSaleRecord.address),
      moto: address(selectedSaleRecord.data.moto),
      garantia: address(moto.data.garantia),
      mint: address(mint),
      tokenAccount,
      canjeServicio,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      servicioId: selectedServiceRecord.id,
      kilometrajeActual: km,
      idCanje,
    });
    // Start blockhash lifetime only after the customer wallet is ready to sign.
    const latestBlockhash = await client.rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(connected.signer!, tx),
      (tx) => appendTransactionMessageInstruction(instruction, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash.value, tx),
    );
    const partiallySigned = await partiallySignTransactionMessageWithSigners(message);
    assertIsTransactionWithBlockhashLifetime(partiallySigned);
    const ownerSignature = partiallySigned.signatures[address(connected.account.address)];
    if (!ownerSignature || ownerSignature.every((byte) => byte === 0)) {
      throw new Error("La wallet del concesionario no pudo firmar parcialmente la transacción.");
    }
    const response = await fetch(`/api/service-redemption/${token}/transaction`, {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({
        transaction: getBase64EncodedWireTransaction(partiallySigned),
        lastValidBlockHeight: latestBlockhash.value.lastValidBlockHeight.toString(),
      }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "No se pudo entregar la transacción al cliente.");
    setSession((current) => current?.token === token ? { ...current, status: "waiting_customer_signature" } : current);
  }, [client, connected?.signer, connected?.account.address, selectedCustomerRecord, selectedSaleRecord,
    selectedServiceRecord, wallet, mint, mileage, concesionario, selectedCustomer]);

  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = window.setInterval(() => {
      void fetch(`/api/service-redemption/${session.token}`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("La solicitud de canje expiró.");
          return response.json() as Promise<{ status: string; signedTransaction: string | null; idCanje: string; lastValidBlockHeight: string }>;
        })
        .then((data) => {
          setSession((current) => current ? { ...current, status: data.status } : current);
          if (data.status === "ready_to_prepare" && !preparingRef.current) {
            preparingRef.current = true;
            void prepareRedemptionTransaction(session.token, session.idCanje).catch(async (error) => {
              const message = error instanceof Error ? error.message : "No se pudo preparar el canje.";
              setQrError(message); toast.error(message);
              await fetch(`/api/service-redemption/${session.token}`, { method: "DELETE", cache: "no-store" }).catch(() => undefined);
              setSession(null);
            }).finally(() => { preparingRef.current = false; });
          }
          if (data.status === "signed" && data.signedTransaction && !sendingRef.current) {
            sendingRef.current = true;
            void (async () => {
              try {
                const currentBlockHeight = await client.rpc.getBlockHeight({ commitment: "confirmed" }).send();
                if (currentBlockHeight > BigInt(data.lastValidBlockHeight)) {
                  setSession(null);
                  throw new Error("La transacción caducó en Solana antes de enviarse. Genera un nuevo QR para continuar.");
                }
                const signature = await client.rpc.sendTransaction(data.signedTransaction as Base64EncodedWireTransaction, {
                  encoding: "base64", preflightCommitment: "confirmed", maxRetries: 3n,
                }).send();
                let confirmed = false;
                for (let attempt = 0; attempt < 30; attempt += 1) {
                  const status = (await client.rpc.getSignatureStatuses([signature]).send()).value[0];
                  if (status?.err) throw new Error(`Solana rechazó el canje: ${JSON.stringify(status.err)}`);
                  if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") { confirmed = true; break; }
                  await new Promise((resolve) => window.setTimeout(resolve, 1500));
                }
                if (!confirmed) throw new Error("La transacción fue enviada, pero aún no tiene confirmación. Revisa la firma en Explorer.");
                const idCanje = BigInt(data.idCanje);
                const [receiptPda] = await deriveCanjeServicioPda(address(selectedCustomer), idCanje);
                const receiptAccount = await client.registro.accounts.canjeServicio.fetch(receiptPda).catch(() => null);
                if (!receiptAccount) throw new Error(`La transacción confirmó, pero no se encontró el recibo esperado. Firma: ${signature}`);
                const receiptData = receiptAccount.data;
                if (receiptData.cliente !== selectedCustomer || receiptData.wallet !== wallet ||
                    receiptData.concesionario !== concesionario || receiptData.mint !== mint ||
                    receiptData.idCanje !== idCanje || receiptData.servicioId !== selectedServiceRecord?.id ||
                    receiptData.puntos !== selectedServiceRecord?.puntos ||
                    receiptData.venta !== selectedSaleRecord?.address ||
                    receiptData.moto !== selectedSaleRecord?.data.moto) {
                  throw new Error(`El recibo on-chain no coincide con la intención firmada. Firma: ${signature}`);
                }
                setReceipt({ signature, address: receiptPda, points: receiptData.puntos });
                toast.success("Canje registrado en Solana y puntos quemados.");
                setSession(null); setShowCancelConfirm(false);
                await loadChainData(); await loadCustomerBalance();
              } catch (error) {
                const message = error instanceof Error ? error.message : "No se pudo finalizar el canje.";
                setQrError(message); toast.error(message);
              } finally { sendingRef.current = false; }
            })();
          }
        })
        .catch((error) => toast.error(error instanceof Error ? error.message : "No se pudo consultar el estado del QR."));
    }, 2000);
    return () => { window.clearInterval(timer); window.clearInterval(poll); };
  }, [session, client, selectedCustomer, wallet, mint, concesionario, selectedServiceRecord, selectedSaleRecord, loadChainData, loadCustomerBalance, prepareRedemptionTransaction]);

  const startRedemption = async () => {
    if (cluster === "localnet") { toast.error("El canje por QR requiere una red pública accesible desde el teléfono."); return; }
    if (!connected?.signer || !connected.account.address) { toast.error("Conecta la wallet propietaria del concesionario."); return; }
    if (!catalogReady || !selectedCustomerRecord || !selectedSaleRecord || !saleDetails || !selectedServiceRecord || !wallet || balance === null || !mint) {
      toast.error("Selecciona un cliente con venta, moto, servicio y wallet vinculada."); return;
    }
    if (selectedServiceRecord.puntos > balance) { toast.error("El cliente no tiene puntos suficientes."); return; }
    let km: bigint;
    try { km = parseMileage(mileage); } catch (error) { toast.error(error instanceof Error ? error.message : "Kilometraje inválido."); return; }
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    const warrantyCovered = saleDetails.garantia.estado === EstadoGarantia.Activa &&
      nowSeconds <= saleDetails.garantia.fechaVencimiento && km <= saleDetails.garantia.kilometrajeMaximo;
    if (warrantyCovered) { toast.error("Este servicio aún está cubierto por la garantía. No se deben consumir puntos."); return; }

    setBusy(true); setQrError(null); setShowQrModal(true); preparingRef.current = false;
    try {
      let idCanje = BigInt(Date.now());
      let canjeServicio = await deriveCanjeServicioPda(address(selectedCustomer), idCanje);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const existing = await client.rpc.getAccountInfo(canjeServicio[0], { encoding: "base64" }).send();
        if (!existing.value) break;
        idCanje += 1n; canjeServicio = await deriveCanjeServicioPda(address(selectedCustomer), idCanje);
      }
      const receiptExists = await client.rpc.getAccountInfo(canjeServicio[0], { encoding: "base64" }).send();
      if (receiptExists.value) throw new Error("No se pudo generar un identificador de canje único. Inténtalo nuevamente.");
      const response = await fetch("/api/service-redemption", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({
          owner: connected.account.address, concesionario, cliente: selectedCustomer,
          clienteNombre: selectedCustomerRecord.data.nombreCliente,
          clienteCedula: String(selectedCustomerRecord.data.cedulaCliente),
          walletAddress: wallet, mint, servicioId: selectedServiceRecord.id,
          servicioNombre: selectedServiceRecord.nombre, puntos: selectedServiceRecord.puntos.toString(),
          kilometrajeActual: km.toString(), idCanje: idCanje.toString(), cluster,
        }),
      });
      const payload = await response.json() as { token?: string; error?: string; expiresAt?: number; status?: string };
      if (!response.ok || !payload.token) throw new Error(payload.error ?? "No se pudo crear el QR de canje.");
      const publicUrl = (process.env.NEXT_PUBLIC_APP_URL || window.location.origin).replace(/\\/+$/, "");
      setSession({
        token: payload.token, url: `${publicUrl}/canjear-servicio/${payload.token}`,
        expiresAt: payload.expiresAt ?? Date.now() + 300_000, idCanje: idCanje.toString(),
        status: payload.status ?? "waiting_customer_ready",
      });
      setReceipt(null);
    } catch (error) {
      console.error("Service redemption preparation:", error);
      const message = error instanceof Error ? error.message : "No se pudo preparar el canje.";
      setQrError(message); toast.error(message);
    } finally { setBusy(false); }
  };

  const remaining = session ? Math.max(0, Math.ceil((session.expiresAt - now) / 1000)) : 0;

  return (
    <section className="mt-5 rounded-xl border border-[#e9ebee] bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">TOKEN-2022 · POSVENTA</p>
          <h3 className="mt-2 text-[14px] font-bold text-[#252a30]">Canje de puntos por servicios</h3>
          <p className="mt-1 text-[10px] text-[#858d96]">{nombreConcesionario} · Los datos se consultan desde Solana. El QR solo transporta la solicitud temporal de firma.</p>
        </div>
        <button type="button" onClick={() => void loadChainData()} disabled={loading || busy} className="rounded-lg border border-[#e2e5e8] px-3 py-2 text-[10px] font-semibold text-[#424950] disabled:opacity-50">Actualizar blockchain</button>
      </div>

      {!loading && !catalogReady && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[10px] leading-relaxed text-amber-900">El programa Token-2022 existe, pero todavía no se ha inicializado el catálogo de servicios de este concesionario. Inicialízalo en la sección <strong>Catálogo de servicios</strong> y luego pulsa <strong>Actualizar blockchain</strong> aquí.</div>}

      {loading ? <p className="mt-4 text-xs text-[#68717b]">Consultando clientes, ventas y configuración en Solana…</p> : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-[10px] font-semibold text-[#68717b]">Cliente registrado en el concesionario
            <select value={selectedCustomer} onChange={(event) => { setSelectedCustomer(event.target.value); setReceipt(null); }} className="mt-1 w-full rounded-lg border border-[#e2e5e8] bg-white p-3 text-xs text-[#252a30]">
              <option value="">Selecciona un cliente</option>
              {customers.filter((customer) => sales.some((sale) => sale.data.cliente === customer.address)).map((customer) => <option key={customer.address} value={customer.address}>{customer.data.nombreCliente} · C.I. {customer.data.cedulaCliente}</option>)}
            </select>
          </label>
          <label className="text-[10px] font-semibold text-[#68717b]">Venta asociada
            <select value={selectedSale} onChange={(event) => setSelectedSale(event.target.value)} disabled={!customerSales.length} className="mt-1 w-full rounded-lg border border-[#e2e5e8] bg-white p-3 text-xs text-[#252a30]">
              {customerSales.map((sale) => <option key={sale.address} value={sale.address}>{shortAddress(sale.data.moto)} · {new Date(Number(sale.data.fechaVenta) * 1000).toLocaleDateString("es-VE")}</option>)}
            </select>
          </label>
          <label className="text-[10px] font-semibold text-[#68717b]">Servicio fuera de garantía
            <select value={selectedService} onChange={(event) => setSelectedService(event.target.value)} className="mt-1 w-full rounded-lg border border-[#e2e5e8] bg-white p-3 text-xs text-[#252a30]">
              <option value="">Selecciona un servicio</option>
              {services.map((service) => <option key={service.id} value={service.id}>{service.nombre} · {service.puntos.toString()} puntos</option>)}
            </select>
          </label>
          <label className="text-[10px] font-semibold text-[#68717b]">Kilometraje actual
            <input inputMode="numeric" value={mileage} onChange={(event) => setMileage(event.target.value)} placeholder="Ej. 12500" className="mt-1 w-full rounded-lg border border-[#e2e5e8] p-3 text-xs text-[#252a30]" />
          </label>
        </div>
      )}

      {selectedCustomerRecord && <div className="mt-4 rounded-lg bg-[#f7f8fa] p-3 text-xs">
        <div className="flex flex-wrap justify-between gap-2"><span className="text-[#68717b]">Wallet vinculada</span><strong className="font-mono text-[#252a30]">{checking ? "Consultando…" : wallet ? shortAddress(wallet) : "No vinculada"}</strong></div>
        <div className="mt-2 flex flex-wrap justify-between gap-2"><span className="text-[#68717b]">Saldo Token-2022</span><strong className="text-[#252a30]">{balance === null ? "—" : balance.toLocaleString("es-VE") + " puntos"}</strong></div>
        {saleDetails && <div className="mt-2 flex flex-wrap justify-between gap-2"><span className="text-[#68717b]">Moto / garantía</span><strong className="text-[#252a30]">{saleDetails.modelo} · {saleDetails.garantia.estado === EstadoGarantia.Activa ? "Activa" : "No activa"}</strong></div>}
      </div>}

      {selectedServiceRecord && <p className="mt-3 text-[10px] text-[#68717b]">El canje quemará {selectedServiceRecord.puntos.toLocaleString("es-VE")} puntos del mint {shortAddress(mint)}. La garantía cubierta no consume puntos; Solana vuelve a validar todas las cuentas y condiciones al ejecutar.</p>}

      <button type="button" onClick={() => void startRedemption()} disabled={!catalogReady || busy || loading || checking || !selectedCustomer || !selectedSale || !selectedService || !wallet || balance === null || !saleDetails || !mileage || Boolean(session)} className="mt-4 w-full rounded-lg bg-[#e60012] px-4 py-3 text-[11px] font-bold text-white hover:bg-[#c90010] disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Preparando canje…" : "Generar QR para autorizar el canje"}</button>

      {showQrModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto overscroll-contain bg-[#171b20]/55 p-4 backdrop-blur-md">
          <section role="dialog" aria-modal="true" aria-labelledby="service-redemption-qr-title" className="my-auto max-h-[92vh] w-full max-w-2xl touch-pan-y overflow-y-auto overscroll-contain rounded-2xl border border-[#e9ebee] bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-[#eff0f2] px-5 py-4 sm:px-6">
              <div>
                <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">FIDELIZACIÓN · TOKEN-2022</p>
                <h2 id="service-redemption-qr-title" className="mt-1 text-[17px] font-bold text-[#252a30]">Autorizar canje de puntos</h2>
                <p className="mt-1 text-[10px] text-[#858d96]">{selectedCustomerRecord?.data.nombreCliente ?? "Cliente"} · {selectedServiceRecord?.nombre ?? "Servicio"}</p>
              </div>
              <button type="button" onClick={() => receipt ? setShowQrModal(false) : setShowCancelConfirm(true)} aria-label="Cerrar solicitud de canje" className="rounded-lg border border-[#e2e5e8] px-3 py-1.5 text-[12px] text-[#68717b] hover:bg-[#f7f8fa]">✕</button>
            </div>
            {receipt ? (
              <div className="p-8 text-center">
                <div className="relative mx-auto flex h-20 w-20 items-center justify-center">
                  <span className="absolute inset-0 animate-ping rounded-full bg-[#d8f4e4] opacity-60" />
                  <span className="relative flex h-16 w-16 animate-bounce items-center justify-center rounded-full bg-[#e7f8ee] text-3xl font-bold text-[#168354]">✓</span>
                </div>
                <h3 className="mt-5 text-lg font-bold text-[#252a30]">¡Canje confirmado correctamente!</h3>
                <p className="mt-2 text-[11px] leading-relaxed text-[#68717b]">La transacción fue confirmada en Solana, el recibo on-chain fue verificado y los puntos se quemaron correctamente.</p>
                <div className="mx-auto mt-5 max-w-md rounded-xl border border-[#e8ecef] bg-[#fafbfc] p-4 text-left">
                  <p className="text-[9px] font-bold tracking-wider text-[#9299a1]">CANJE COMPLETADO</p>
                  <p className="mt-1 text-[12px] font-semibold text-[#252a30]">{selectedServiceRecord?.nombre ?? "Servicio"}</p>
                  <p className="mt-1 text-[10px] text-[#68717b]">{receipt.points.toLocaleString("es-VE")} puntos quemados · {selectedCustomerRecord?.data.nombreCliente ?? "Cliente"}</p>
                  <p className="mt-3 break-all font-mono text-[9px] text-[#68717b]">Recibo: {receipt.address}</p>
                </div>
                <a className="mt-4 inline-block break-all text-[10px] font-semibold text-[#168354] underline" href={`https://explorer.solana.com/tx/${receipt.signature}?cluster=${cluster === "mainnet" ? "mainnet-beta" : cluster}`} target="_blank" rel="noopener noreferrer">Ver transacción en Solana Explorer ↗</a>
                <p className="mt-4 text-[10px] text-[#68717b]">El proceso finalizó. Ya puedes cerrar esta ventana.</p>
                <button type="button" onClick={() => setShowQrModal(false)} className="mt-5 rounded-lg bg-[#252a30] px-5 py-2.5 text-[10px] font-semibold text-white">Cerrar ventana</button>
              </div>
            ) : !session ? (
              <div className="p-8 text-center">
                <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-[#f2c6ca] border-t-[#e60012]" />
                <p className="mt-4 text-[12px] font-semibold text-[#252a30]">{busy ? "Preparando solicitud segura…" : "No se pudo preparar la solicitud"}</p>
                {qrError && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-[10px] text-red-700">{qrError}</p>}
                {qrError && <button type="button" onClick={() => { setShowQrModal(false); setQrError(null); }} className="mt-4 rounded-lg border border-[#e2e5e8] px-4 py-2 text-[10px] font-semibold text-[#424950]">Cerrar</button>}
              </div>
            ) : (
              <div className="grid gap-6 p-5 sm:grid-cols-[190px_1fr] sm:p-6">
                <div className="flex flex-col items-center">
                  <div className="rounded-xl border border-[#e9ebee] bg-white p-3 shadow-sm"><QRCodeSVG value={session.url} size={164} level="M" includeMargin /></div>
                  <p className="mt-3 text-center text-[10px] font-bold text-[#252a30]">Escanea con la wallet del cliente</p>
                  <a href={session.url} target="_blank" rel="noreferrer" className="mt-1 break-all text-center text-[9px] text-[#d90011] underline">{session.url}</a>
                  <p className={`mt-3 text-[11px] font-bold tabular-nums ${remaining <= 30 ? "text-red-600" : "text-[#68717b]"}`}>Tiempo de sesión: {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] leading-relaxed text-[#737b84]">El cliente escanea el QR, conecta la wallet vinculada y autoriza la quema. El concesionario enviará la transacción y verificará el recibo directamente en Solana.</p>
                  <div className="mt-4 space-y-3">
                    <div className="rounded-lg border border-[#ccebd9] bg-[#f3fbf6] p-3">
                      <p className="text-[9px] font-bold tracking-wider text-[#168354]">1 · SOLICITUD PREPARADA</p>
                      <p className="mt-1 text-[10px] font-semibold text-[#424950]">Servicio: {selectedServiceRecord?.nombre} · {selectedServiceRecord?.puntos.toLocaleString("es-VE")} puntos.</p>
                    </div>
                    <div className={`rounded-lg border p-3 ${session.status === "signed" ? "border-[#ccebd9] bg-[#f3fbf6]" : "border-[#e9ebee] bg-[#fafbfc]"}`}>
                      <p className="text-[9px] font-bold tracking-wider text-[#9299a1]">2 · FIRMA DEL CLIENTE</p>
                      <p className="mt-1 text-[10px] font-semibold text-[#424950]">{session.status === "signed" ? "Firma recibida correctamente." : session.status === "waiting_customer_signature" ? "Transacción nueva preparada. Esperando la firma del cliente…" : session.status === "ready_to_prepare" ? "Wallet del cliente detectada. Preparando transacción nueva…" : "Esperando que el cliente escanee y conecte su wallet…"}</p>
                    </div>
                    <div className={`rounded-lg border p-3 ${receipt ? "border-[#ccebd9] bg-[#f3fbf6]" : "border-[#e9ebee] bg-[#fafbfc]"}`}>
                      <p className="text-[9px] font-bold tracking-wider text-[#9299a1]">3 · CONFIRMACIÓN EN SOLANA</p>
                      <p className="mt-1 text-[10px] font-semibold text-[#424950]">{receipt ? "Canje confirmado y recibo verificado en blockchain." : "Pendiente de envío y confirmación on-chain."}</p>
                    </div>
                  </div>
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[10px] leading-relaxed text-amber-900">
                    La sesión QR dura hasta 5 minutos. La transacción usa un blockhash de Solana con una vigencia menor, que empieza a contar antes de que el cliente firme. Si caduca, habrá que generar una nueva solicitud; los 5 minutos no extienden la vigencia de la transacción.
                  </div>
                  {receipt && <button type="button" onClick={() => setShowQrModal(false)} className="mt-4 rounded-lg bg-[#252a30] px-4 py-2.5 text-[10px] font-semibold text-white">Cerrar ventana</button>}
                  {!receipt && <button type="button" onClick={() => setShowCancelConfirm(true)} disabled={session.status === "signed"} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-[10px] font-bold text-red-700 shadow-sm transition hover:border-red-300 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50">Cancelar proceso y cerrar</button>}
                </div>
              </div>
            )}
          </section>
          {showCancelConfirm && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#171b20]/65 p-4 backdrop-blur-sm">
              <section role="alertdialog" aria-modal="true" aria-labelledby="cancel-service-redemption-title" className="w-full max-w-md overflow-hidden rounded-2xl border border-red-100 bg-white shadow-2xl">
                <div className="border-b border-red-100 bg-red-50 px-5 py-4">
                  <p className="text-[9px] font-bold tracking-[0.16em] text-red-700">CONFIRMACIÓN REQUERIDA</p>
                  <h3 id="cancel-service-redemption-title" className="mt-1 text-[16px] font-bold text-[#252a30]">¿Cancelar el canje?</h3>
                </div>
                <div className="space-y-3 p-5">
                  <p className="text-[11px] leading-relaxed text-[#535c66]">Se cerrará esta solicitud y el QR dejará de estar disponible. No se quemarán puntos si el cliente todavía no ha firmado.</p>
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setShowCancelConfirm(false)} className="rounded-lg border border-[#e2e5e8] px-4 py-2.5 text-[10px] font-semibold text-[#424950]">Volver</button>
                    <button type="button" onClick={() => { void (async () => {
                      try {
                        if (session) {
                          const response = await fetch(`/api/service-redemption/${session.token}`, { method: "DELETE", cache: "no-store" });
                          const payload = await response.json() as { error?: string };
                          if (!response.ok) throw new Error(payload.error ?? "No se pudo cancelar el QR.");
                        }
                        setSession(null); setShowCancelConfirm(false); setShowQrModal(false); setQrError(null);
                      } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo cancelar la solicitud."); }
                    })(); }} className="rounded-lg bg-red-600 px-4 py-2.5 text-[10px] font-bold text-white hover:bg-red-700">Sí, cancelar solicitud</button>
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
      )}



      {receipt && <div className="mt-4 rounded-lg border border-[#ccebdc] bg-[#f3fbf6] p-4 text-xs">
        <p className="font-bold text-[#168451]">Canje confirmado en blockchain</p>
        <p className="mt-1 text-[#424950]">{receipt.points.toLocaleString("es-VE")} puntos quemados.</p>
        <p className="mt-2 break-all font-mono text-[10px] text-[#68717b]">Recibo: {receipt.address}</p>
        <a className="mt-2 inline-block text-[10px] font-semibold text-[#d90011] underline" href={`https://explorer.solana.com/tx/${receipt.signature}?cluster=${cluster === "mainnet" ? "mainnet-beta" : cluster}`} target="_blank" rel="noreferrer">Ver transacción confirmada ↗</a>
      </div>}
    </section>
  );
}
