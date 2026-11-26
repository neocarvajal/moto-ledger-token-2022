"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  address,
  getBase58Decoder,
  getBase64Encoder,
  type Base58EncodedBytes,
} from "@solana/kit";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import {
  getCreateAssociatedTokenIdempotentInstructionAsync,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { toast } from "sonner";
import { useAppClient } from "../../lib/client-provider";
import { notifyTransactionSuccess } from "../../lib/transaction-toast";
import {
  deriveAutoridadFidelidadPda,
  deriveClientePda,
  deriveProgramaFidelidadPda,
  derivePuntosVentaPda,
  deriveToken2022Ata,
  deriveVentaPda,
  deriveWalletClientePda,
} from "../../lib/moto-ledger/pdas";
import { REGISTRO_PROGRAM_ADDRESS } from "../../lib/moto-ledger/src/generated/programs";
import {
  getMotoDecoder,
  getMotoDiscriminatorBytes,
  type Moto,
} from "../../lib/moto-ledger/src/generated/accounts/moto";
import {
  getVentaDecoder,
  getVentaDiscriminatorBytes,
  type Venta,
} from "../../lib/moto-ledger/src/generated/accounts/venta";
import {
  getClienteDecoder,
  getClienteDiscriminatorBytes,
  type Cliente,
} from "../../lib/moto-ledger/src/generated/accounts/cliente";
import type { Concesionario } from "../../lib/moto-ledger/src/generated/accounts/concesionario";
import type { PuntosVenta } from "../../lib/moto-ledger/src/generated/accounts/puntosVenta";

type MotorcycleRecord = { address: string; data: Moto };
type CustomerRecord = { address: string; data: Cliente };
type SaleRecord = { address: string; data: Venta; reward?: PuntosVenta };
type SaleConfirmation = {
  points: bigint | null;
  wallet: string | null;
  signature: string | null;
  saleAddress: string;
  customerName: string;
  motorcycle: string;
};
type SaleDetails = {
  sale: SaleRecord;
  customer: Cliente;
  motorcycle: Moto;
  dealership: Concesionario;
};

function parseCedula(value: string) {
  const parsed = Number(value.trim());
  if (!/^[0-9]+$/.test(value.trim()) || !Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 4294967295) {
    throw new Error("Introduce una cédula válida.");
  }
  return parsed;
}

function formatAmount(value: bigint) {
  return value.toLocaleString("es-VE");
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-5)}`;
}

export function SalesManagement({
  concesionario,
  nombreConcesionario,
  onRegistered,
}: {
  concesionario: string;
  nombreConcesionario: string;
  onRegistered: () => Promise<void>;
}) {
  const client = useAppClient();
  const connected = useConnectedWallet(client);
  const [motorcycles, setMotorcycles] = useState<MotorcycleRecord[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [selectedCustomerAddress, setSelectedCustomerAddress] = useState("");
  const [customerWalletStatus, setCustomerWalletStatus] = useState<"idle" | "loading" | "linked" | "unlinked" | "error">("idle");
  const [customerWalletAddress, setCustomerWalletAddress] = useState("");
  const [serial, setSerial] = useState("");
  const [cedula, setCedula] = useState("");
  const [price, setPrice] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [saleDetails, setSaleDetails] = useState<SaleDetails | null>(null);
  const [lastSaleConfirmation, setLastSaleConfirmation] = useState<SaleConfirmation | null>(null);

  const availableMotorcycles = useMemo(
    () => motorcycles.filter((item) => !item.data.vendida),
    [motorcycles]
  );

  const loadData = useCallback(async () => {
    if (!concesionario) return;
    setLoading(true);
    try {
      const dealerAddress = address(concesionario);
      const motoDiscriminator = getBase58Decoder().decode(
        getMotoDiscriminatorBytes()
      ) as Base58EncodedBytes;
      const ventaDiscriminator = getBase58Decoder().decode(
        getVentaDiscriminatorBytes()
      ) as Base58EncodedBytes;

      const [motoResults, ventaResults] = await Promise.all([
        client.rpc.getProgramAccounts(
          REGISTRO_PROGRAM_ADDRESS,
          {
            encoding: "base64",
            filters: [
              { memcmp: { offset: 0n, bytes: motoDiscriminator, encoding: "base58" } },
            ],
          }
        ).send(),
        client.rpc.getProgramAccounts(
          REGISTRO_PROGRAM_ADDRESS,
          {
            encoding: "base64",
            filters: [
              { memcmp: { offset: 0n, bytes: ventaDiscriminator, encoding: "base58" } },
              { memcmp: { offset: 8n, bytes: dealerAddress as Base58EncodedBytes, encoding: "base58" } },
            ],
          }
        ).send(),
      ]);

      const motoRecords: MotorcycleRecord[] = motoResults
        .map((item) => ({
          address: item.pubkey,
          data: getMotoDecoder().decode(getBase64Encoder().encode(item.account.data[0])),
        }))
        .filter((item) => item.data.concesionario === concesionario)
        .sort((a, b) => a.data.serial.localeCompare(b.data.serial));

      const saleRecords: SaleRecord[] = ventaResults
        .map((item) => ({
          address: item.pubkey,
          data: getVentaDecoder().decode(getBase64Encoder().encode(item.account.data[0])),
        }))
        .sort((a, b) => Number(b.data.fechaVenta - a.data.fechaVenta));

      // Load the persistent reward receipt associated with each sale.
      const salesWithRewards = await Promise.all(saleRecords.map(async (sale) => {
        try {
          const [rewardPda] = await derivePuntosVentaPda(address(sale.address));
          const rewardInfo = await client.rpc.getAccountInfo(rewardPda, { encoding: "base64" }).send();
          if (!rewardInfo.value) return sale;
          const reward = await client.registro.accounts.puntosVenta.fetch(rewardPda);
          return { ...sale, reward: reward.data };
        } catch (error) {
          console.warn("No se pudo consultar el comprobante de puntos de la venta:", sale.address, error);
          return sale;
        }
      }));

      setMotorcycles(motoRecords);
      setSales(salesWithRewards);
      setSerial((current) =>
        motoRecords.some((item) => item.data.serial === current && !item.data.vendida)
          ? current
          : motoRecords.find((item) => !item.data.vendida)?.data.serial ?? ""
      );
    } catch (error) {
      console.error("No se pudieron cargar las ventas:", error);
      toast.error("No se pudo consultar el inventario y las ventas en Solana.");
    } finally {
      setLoading(false);
    }
  }, [client, concesionario]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const checkCustomerWallet = useCallback(async (customerPda: string) => {
    setCustomerWalletStatus("loading");
    setCustomerWalletAddress("");
    try {
      const [walletCliente] = await deriveWalletClientePda(address(customerPda));
      const walletInfo = await client.rpc.getAccountInfo(walletCliente, { encoding: "base64" }).send();
      if (!walletInfo.value) {
        setCustomerWalletStatus("unlinked");
        return;
      }
      const linkedWallet = await client.registro.accounts.walletCliente.fetch(walletCliente);
      setCustomerWalletAddress(linkedWallet.data.wallet);
      setCustomerWalletStatus("linked");
    } catch (error) {
      console.error("No se pudo consultar la wallet vinculada del cliente:", error);
      setCustomerWalletStatus("error");
    }
  }, [client]);

  const loadCustomers = useCallback(async () => {
    if (!connected?.account.address) {
      setCustomers([]);
      setSelectedCustomerAddress("");
      setCedula("");
      setCustomerName("");
      setCustomerWalletStatus("idle");
      setCustomerWalletAddress("");
      return;
    }

    setLoadingCustomers(true);
    try {
      const ownerFilter = address(connected.account.address) as Base58EncodedBytes;
      const discriminatorFilter = getBase58Decoder().decode(
        getClienteDiscriminatorBytes()
      ) as Base58EncodedBytes;
      const results = await client.rpc
        .getProgramAccounts(REGISTRO_PROGRAM_ADDRESS, {
          encoding: "base64",
          filters: [
            { memcmp: { offset: 0n, bytes: discriminatorFilter, encoding: "base58" } },
            { memcmp: { offset: 8n, bytes: ownerFilter, encoding: "base58" } },
          ],
        })
        .send();

      const found: CustomerRecord[] = results.map((result) => ({
        address: result.pubkey,
        data: getClienteDecoder().decode(
          getBase64Encoder().encode(result.account.data[0])
        ),
      }));
      found.sort((a, b) => a.data.idCliente - b.data.idCliente);
      setCustomers(found);
      const selected = found[0] ?? null;
      setSelectedCustomerAddress(selected?.address ?? "");
      setCedula(selected ? String(selected.data.cedulaCliente) : "");
      setCustomerName(selected?.data.nombreCliente ?? "");
      if (selected) void checkCustomerWallet(selected.address);
      else {
        setCustomerWalletStatus("idle");
        setCustomerWalletAddress("");
      }
    } catch (error) {
      console.error("No se pudieron cargar los clientes para ventas:", error);
      toast.error("No se pudieron consultar los clientes registrados del concesionario en Solana.");
    } finally {
      setLoadingCustomers(false);
    }
  }, [checkCustomerWallet, client, connected?.account.address]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  const lookupCustomer = async (value: string) => {
    if (!connected) throw new Error("Conecta tu wallet para consultar clientes.");
    const id = parseCedula(value);
    const [pda] = await deriveClientePda(address(connected.account.address), id);
    const account = await client.registro.accounts.cliente.fetch(pda);
    if (account.data.owner !== connected.account.address) {
      throw new Error("El cliente no pertenece a la wallet conectada.");
    }
    setCustomerName(account.data.nombreCliente);
    return { id, pda };
  };

  const handleCustomerLookup = async () => {
    try {
      const { pda } = await lookupCustomer(cedula);
      setSelectedCustomerAddress(pda);
      void checkCustomerWallet(pda);
    } catch (error) {
      setCustomerName("");
      toast.error(error instanceof Error ? error.message : "No se encontró el cliente.");
    }
  };

  const handleViewDetails = async (sale: SaleRecord) => {
    setDetailLoading(sale.address);
    setSaleDetails(null);
    try {
      const [customerAccount, motorcycleAccount, dealershipAccount] = await Promise.all([
        client.registro.accounts.cliente.fetch(address(sale.data.cliente)),
        client.registro.accounts.moto.fetch(address(sale.data.moto)),
        client.registro.accounts.concesionario.fetch(address(sale.data.concesionario)),
      ]);
      setSaleDetails({
        sale,
        customer: customerAccount.data,
        motorcycle: motorcycleAccount.data,
        dealership: dealershipAccount.data,
      });
    } catch (error) {
      console.error("No se pudieron consultar los detalles de la venta:", error);
      toast.error(error instanceof Error ? error.message : "No se pudieron consultar los datos relacionados con esta venta.");
    } finally {
      setDetailLoading(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!connected?.signer) {
      toast.error("Conecta una wallet con capacidad de firma.");
      return;
    }
    if (!serial) {
      toast.error("Selecciona una moto disponible.");
      return;
    }

    let customerId: number;
    let amount: bigint;
    try {
      customerId = parseCedula(cedula);
      if (!/^[0-9]+$/.test(price.trim())) throw new Error("Introduce un precio entero válido.");
      amount = BigInt(price.trim());
      if (amount <= 0n) throw new Error("El precio de venta debe ser mayor que cero.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Revisa los datos de la venta.");
      return;
    }

    setBusy(true);
    try {
      const owner = address(connected.account.address);
      const dealerAddress = address(concesionario);
      const [cliente] = await deriveClientePda(owner, customerId);
      const customer = await client.registro.accounts.cliente.fetch(cliente);
      if (customer.data.owner !== owner) throw new Error("El cliente no pertenece a la wallet conectada.");

      const motorcycle = motorcycles.find((item) => item.data.serial === serial);
      if (!motorcycle) throw new Error("La moto seleccionada ya no está disponible.");
      if (motorcycle.data.vendida) throw new Error("Esta moto ya fue vendida.");

      const [venta] = await deriveVentaPda(address(motorcycle.address));
      const saleInstruction = client.registro.instructions.registrarVenta({
        owner: connected.signer,
        concesionario: dealerAddress,
        cliente,
        moto: address(motorcycle.address),
        venta,
        nombreConcesionario,
        serial: motorcycle.data.serial,
        cedulaCliente: customerId,
        precioVenta: amount,
      });

      // Loyalty is optional: a sale must still be possible for customers
      // without a linked wallet or dealerships without a loyalty program.
      const [walletCliente] = await deriveWalletClientePda(cliente);
      const [programaFidelidad] = await deriveProgramaFidelidadPda(dealerAddress);
      const [walletInfo, loyaltyInfo] = await Promise.all([
        client.rpc.getAccountInfo(walletCliente, { encoding: "base64" }).send(),
        client.rpc.getAccountInfo(programaFidelidad, { encoding: "base64" }).send(),
      ]);

      const [puntosVenta] = await derivePuntosVentaPda(venta);
      let result: { context: { signature: string } } | null = null;
      let awardedPoints: bigint | null = null;
      let awardedWallet: string | null = null;
      let reconciledOnChain = false;

      try {
        if (walletInfo.value && loyaltyInfo.value) {
          const linkedWallet = await client.registro.accounts.walletCliente.fetch(walletCliente);
          const loyaltyProgram = await client.registro.accounts.programaFidelidad.fetch(programaFidelidad);
          const customerWallet = linkedWallet.data.wallet;
          const mint = loyaltyProgram.data.mint;
          const [tokenAccount] = await deriveToken2022Ata(customerWallet, mint);

          // Idempotent creation is safe whether the customer's Token-2022
          // ATA already exists or needs to be created. The dealership pays rent.
          const createAtaInstruction =
            await getCreateAssociatedTokenIdempotentInstructionAsync({
              payer: connected.signer,
              mint,
              owner: customerWallet,
              tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
            });

          const [autoridadFidelidad] = await deriveAutoridadFidelidadPda(dealerAddress);
          const rewardInstruction = client.registro.instructions.otorgarPuntos({
            owner: connected.signer,
            concesionario: dealerAddress,
            programaFidelidad,
            venta,
            cliente,
            walletCliente,
            puntosVenta,
            autoridadFidelidad,
            mint,
            tokenAccount,
            tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
          });

          // ATA creation (when needed), sale registration and reward issuance
          // are submitted atomically: any failure rolls back all three operations.
          result = await client.sendTransaction([
            createAtaInstruction,
            saleInstruction,
            rewardInstruction,
          ]);
          awardedPoints = loyaltyProgram.data.puntosPorVenta;
          awardedWallet = customerWallet;
        } else {
          result = await saleInstruction.sendTransaction();
        }
      } catch (sendError) {
        // Some wallet extensions can report "Cancelled" after the transaction
        // was already broadcast. Reconcile against the sale and reward PDAs
        // before showing an error or allowing the user to retry.
        for (let attempt = 0; attempt < 5; attempt += 1) {
          if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, 700));
          }
          try {
            const [saleInfo, rewardInfo] = await Promise.all([
              client.rpc.getAccountInfo(venta, { encoding: "base64" }).send(),
              client.rpc.getAccountInfo(puntosVenta, { encoding: "base64" }).send(),
            ]);
            if (saleInfo.value) {
              reconciledOnChain = true;
              if (rewardInfo.value) {
                const rewardRecord = await client.registro.accounts.puntosVenta.fetch(puntosVenta);
                awardedPoints = rewardRecord.data.cantidad;
                awardedWallet = rewardRecord.data.wallet;
              }
              break;
            }
          } catch (reconciliationError) {
            console.warn("No se pudo reconciliar todavía el resultado de la venta:", reconciliationError);
          }
        }
        if (!reconciledOnChain) throw sendError;
      }

      if (result) {
        notifyTransactionSuccess(
          awardedPoints === null
            ? "Venta registrada correctamente en Solana."
            : `Venta registrada y ${formatAmount(awardedPoints)} puntos de fidelización emitidos.`,
          result.context.signature
        );
      } else {
        toast.success(
          awardedPoints === null
            ? "Venta confirmada en Solana. La wallet no devolvió la firma, pero el registro ya existe."
            : `Venta confirmada y ${formatAmount(awardedPoints)} puntos emitidos. La wallet no devolvió la firma, pero ambas cuentas existen en Solana.`
        );
      }
      setLastSaleConfirmation({
        points: awardedPoints,
        wallet: awardedWallet,
        signature: result?.context.signature ?? null,
        saleAddress: venta,
        customerName: customer.data.nombreCliente,
        motorcycle: `${motorcycle.data.marca} ${motorcycle.data.modelo} · ${motorcycle.data.serial}`,
      });
      setCedula("");
      setPrice("");
      setCustomerName("");
      setSelectedCustomerAddress("");
      setCustomerWalletStatus("idle");
      setCustomerWalletAddress("");
      await Promise.all([loadData(), onRegistered()]);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "No se pudo registrar la venta.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[#e9ebee] bg-white p-6 shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">COMERCIALIZACIÓN</p>
            <h2 className="mt-2 text-[15px] font-bold text-[#252a30]">Registrar venta</h2>
            <p className="mt-1 text-[10px] text-[#858d96]">Asocia una moto disponible con un cliente registrado.</p>
          </div>
          <button type="button" onClick={() => void loadData()} disabled={loading} className="rounded-lg border border-[#e2e5e8] px-3 py-2 text-[10px] font-semibold text-[#555e68] hover:bg-[#f7f8fa] disabled:opacity-50">
            {loading ? "Actualizando…" : "Actualizar datos"}
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-[#f7f8fa] p-4">
            <p className="text-[9px] text-[#9299a1]">Unidades disponibles</p>
            <p className="mt-1 text-[22px] font-bold text-[#252a30]">{availableMotorcycles.length}</p>
          </div>
          <div className="rounded-lg bg-[#f7f8fa] p-4">
            <p className="text-[9px] text-[#9299a1]">Ventas registradas</p>
            <p className="mt-1 text-[22px] font-bold text-[#252a30]">{sales.length}</p>
          </div>
          <div className="rounded-lg bg-[#f7f8fa] p-4">
            <p className="text-[9px] text-[#9299a1]">Concesionario</p>
            <p className="mt-1 truncate text-[13px] font-bold text-[#252a30]">{nombreConcesionario}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 grid grid-cols-1 gap-x-5 gap-y-5 border-t border-[#eff0f2] pt-6 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.08em] text-[#555e68]">1. Moto disponible</span>
            <select value={serial} onChange={(event) => setSerial(event.target.value)} required className="w-full rounded-lg border border-[#e2e5e8] bg-white px-3 py-2.5 text-[11px] outline-none focus:border-[#e60012]">
              {availableMotorcycles.length === 0 ? <option value="">No hay unidades disponibles</option> : availableMotorcycles.map((item) => (
                <option key={item.address} value={item.data.serial}>
                  {item.data.marca} {item.data.modelo} · {item.data.serial} · {item.data.placa}
                </option>
              ))}
            </select>
            {availableMotorcycles.length === 0 && <span className="mt-1 block text-[9px] text-[#a0a6ad]">Registra una moto antes de crear una venta.</span>}
          </label>

          <div className="rounded-xl border border-[#edf0f2] bg-[#fcfcfd] p-4 sm:col-span-2">
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="sale-registered-customer" className="block text-[10px] font-bold uppercase tracking-[0.08em] text-[#555e68]">2. Cliente registrado</label>
              <button type="button" onClick={() => void loadCustomers()} disabled={loadingCustomers} className="text-[10px] font-semibold text-[#68717b] hover:text-[#e60012] disabled:opacity-50">
                {loadingCustomers ? "Actualizando…" : "Actualizar clientes"}
              </button>
            </div>
            {customers.length > 0 ? (
              <select
                id="sale-registered-customer"
                value={selectedCustomerAddress}
                onChange={(event) => {
                  const selected = customers.find((item) => item.address === event.target.value) ?? null;
                  setSelectedCustomerAddress(selected?.address ?? "");
                  setCedula(selected ? String(selected.data.cedulaCliente) : "");
                  setCustomerName(selected?.data.nombreCliente ?? "");
                  if (selected) void checkCustomerWallet(selected.address);
                  else {
                    setCustomerWalletStatus("idle");
                    setCustomerWalletAddress("");
                  }
                }}
                className="w-full rounded-lg border border-[#e2e5e8] bg-white px-3 py-2.5 text-[11px] text-[#252a30] outline-none focus:border-[#e60012]"
              >
                <option value="">Selecciona un cliente registrado</option>
                {customers.map((item) => (
                  <option key={item.address} value={item.address}>
                    {item.data.nombreCliente} · C.I. {item.data.cedulaCliente}
                  </option>
                ))}
              </select>
            ) : (
              <div className="rounded-lg bg-[#f7f8fa] px-3 py-3 text-[10px] text-[#858d96]">
                {loadingCustomers ? "Consultando clientes en Solana…" : "No hay clientes registrados para este concesionario."}
              </div>
            )}
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input value={cedula} onChange={(event) => { setCedula(event.target.value.replace(/[^0-9]/g, "")); setCustomerName(""); setSelectedCustomerAddress(""); setCustomerWalletStatus("idle"); setCustomerWalletAddress(""); }} inputMode="numeric" maxLength={10} required placeholder="Cédula de identidad" className="min-w-0 flex-1 rounded-lg border border-[#e2e5e8] px-3 py-2.5 font-mono text-[11px] outline-none focus:border-[#e60012]" />
              <button type="button" onClick={() => void handleCustomerLookup()} disabled={!cedula} className="rounded-lg border border-[#e2e5e8] px-4 py-2.5 text-[10px] font-semibold text-[#555e68] hover:bg-[#f7f8fa] disabled:opacity-50">Verificar cliente</button>
            </div>
            {customerName && <p className="mt-2 text-[10px] font-semibold text-[#16845a]">✓ {customerName} · Cliente verificado en Solana</p>}
            {customerName && (
              <div className={`mt-3 flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between ${customerWalletStatus === "linked" ? "border-[#ccebdc] bg-[#f0faf5]" : customerWalletStatus === "unlinked" ? "border-[#f2dfb8] bg-[#fffaf0]" : "border-[#e8eaed] bg-[#f8f9fa]"}`}>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${customerWalletStatus === "linked" ? "bg-[#16845a]" : customerWalletStatus === "unlinked" ? "bg-[#c58a20]" : "bg-[#9aa1a9]"}`} />
                  <span className="text-[10px] font-semibold text-[#454d56]">
                    {customerWalletStatus === "loading" ? "Consultando wallet del cliente…" :
                      customerWalletStatus === "linked" ? "Wallet configurada" :
                      customerWalletStatus === "unlinked" ? "Wallet no configurada" :
                      customerWalletStatus === "error" ? "No se pudo consultar el estado de la wallet" :
                      "Estado de wallet pendiente de consulta"}
                  </span>
                </div>
                {customerWalletStatus === "linked" && customerWalletAddress && (
                  <a href={`https://explorer.solana.com/address/${customerWalletAddress}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="break-all font-mono text-[9px] text-[#16845a] underline decoration-dotted underline-offset-2 hover:text-[#116b49]">
                    {shortAddress(customerWalletAddress)} ↗
                  </a>
                )}
                {customerWalletStatus === "unlinked" && (
                  <span className="text-[9px] text-[#8b6a2c]">La venta podrá registrarse, pero no recibirá puntos.</span>
                )}
              </div>
            )}
            {customers.length > 0 && <p className="mt-1 text-[9px] text-[#a0a6ad]">{customers.length} cliente(s) registrados en este concesionario.</p>}
          </div>

          <label className="block sm:col-span-2">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.08em] text-[#555e68]">3. Precio de venta</span>
            <input value={price} onChange={(event) => setPrice(event.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" required placeholder="Ej. 2500" className="w-full rounded-lg border border-[#e2e5e8] px-3 py-2.5 font-mono text-[11px] outline-none focus:border-[#e60012]" />
            <span className="mt-1 block text-[9px] text-[#9aa1a9]">Monto entero registrado en la cuenta on-chain, sin decimales.</span>
          </label>
          <div className="flex flex-col-reverse gap-3 border-t border-[#eff0f2] pt-5 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[9px] leading-relaxed text-[#9299a1]">La operación se registra en Solana. Si el cliente tiene wallet vinculada y el programa está activo, también se emitirán sus puntos.</p>
            <button type="submit" disabled={busy || loading || availableMotorcycles.length === 0} className="inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-lg bg-[#e60012] px-7 py-3 text-[11px] font-bold text-white shadow-[0_4px_12px_rgba(230,0,18,0.16)] transition hover:bg-[#c90010] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-[210px]">
              {busy ? "Registrando venta…" : "Confirmar venta"}
            </button>
          </div>
        </form>

        {lastSaleConfirmation && (
          <div className="mt-5 rounded-xl border border-[#bfe8d2] bg-[#f0faf5] p-4 sm:p-5" role="status" aria-live="polite">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#d9f3e5] text-lg font-bold text-[#16845a]">✓</span>
                <div>
                  <p className="text-[12px] font-bold text-[#176b4b]">Venta registrada correctamente</p>
                  <p className="mt-1 text-[10px] text-[#4d7664]">{lastSaleConfirmation.customerName} · {lastSaleConfirmation.motorcycle}</p>
                </div>
              </div>
              <button type="button" onClick={() => setLastSaleConfirmation(null)} className="rounded-md px-2 py-1 text-[10px] font-semibold text-[#4d7664] hover:bg-[#e1f5e9]">Cerrar</button>
            </div>
            {lastSaleConfirmation.points !== null ? (
              <div className="mt-4 rounded-lg border border-[#ccebdc] bg-white p-4">
                <p className="text-[9px] font-bold tracking-[0.12em] text-[#16845a]">RECOMPENSA ACREDITADA</p>
                <div className="mt-1 flex flex-wrap items-baseline gap-2">
                  <p className="text-[28px] font-extrabold leading-tight text-[#176b4b]">{formatAmount(lastSaleConfirmation.points)}</p>
                  <p className="text-[12px] font-bold text-[#4d7664]">BERA entregados</p>
                </div>
                {lastSaleConfirmation.wallet && (
                  <a href={"https://explorer.solana.com/address/" + lastSaleConfirmation.wallet + "?cluster=devnet"} target="_blank" rel="noopener noreferrer" className="mt-2 block break-all font-mono text-[9px] text-[#16845a] underline decoration-dotted underline-offset-2">
                    Wallet del cliente: {lastSaleConfirmation.wallet} ↗
                  </a>
                )}
                <p className="mt-2 text-[9px] text-[#6c8b7b]">La emisión también quedó asociada permanentemente al registro de esta venta en Solana.</p>
              </div>
            ) : (
              <p className="mt-3 rounded-lg bg-white px-3 py-2 text-[10px] text-[#68717b]">La venta quedó registrada, pero no se emitieron puntos porque el cliente no tenía wallet vinculada o el programa no estaba activo.</p>
            )}
            <div className="mt-3 flex flex-wrap gap-3 text-[9px] font-semibold">
              <a href={"https://explorer.solana.com/address/" + lastSaleConfirmation.saleAddress + "?cluster=devnet"} target="_blank" rel="noopener noreferrer" className="text-[#16845a] underline decoration-dotted underline-offset-2">Ver venta en Explorer ↗</a>
              {lastSaleConfirmation.signature && <a href={"https://explorer.solana.com/tx/" + lastSaleConfirmation.signature + "?cluster=devnet"} target="_blank" rel="noopener noreferrer" className="text-[#16845a] underline decoration-dotted underline-offset-2">Ver transacción ↗</a>}
            </div>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-[#e9ebee] bg-white shadow-[0_2px_8px_rgba(24,32,40,0.025)]">
        <div className="flex items-center justify-between border-b border-[#eff0f2] px-6 py-4">
          <div>
            <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">HISTORIAL ON-CHAIN</p>
            <h2 className="mt-1 text-[14px] font-bold text-[#252a30]">Ventas del concesionario</h2>
          </div>
          <span className="rounded-md bg-[#f4f5f6] px-2 py-1 text-[9px] font-bold text-[#737b84]">{sales.length} registros</span>
        </div>
        {sales.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead className="bg-[#fafbfc] text-[9px] font-bold uppercase tracking-wide text-[#9299a1]">
                <tr><th className="px-6 py-3">Fecha</th><th className="px-4 py-3">Cliente PDA</th><th className="px-4 py-3">Moto PDA</th><th className="px-4 py-3 text-right">Precio</th><th className="px-4 py-3 text-right">Puntos BERA</th><th className="px-6 py-3 text-right">Venta PDA</th><th className="px-4 py-3 text-right">Detalle</th></tr>
              </thead>
              <tbody className="divide-y divide-[#f0f1f3]">
                {sales.map((sale) => (
                  <tr key={sale.address} className="text-[10px] text-[#555e68]">
                    <td className="whitespace-nowrap px-6 py-3">{new Date(Number(sale.data.fechaVenta) * 1000).toLocaleString("es-VE")}</td>
                    <td className="px-4 py-3 font-mono">{shortAddress(sale.data.cliente)}</td>
                    <td className="px-4 py-3 font-mono">{shortAddress(sale.data.moto)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-[#252a30]">{formatAmount(sale.data.precioVenta)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {sale.reward ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#edf8f2] px-2 py-1 font-bold text-[#16845a]">+{formatAmount(sale.reward.cantidad)} BERA</span>
                      ) : <span className="text-[#a0a6ad]">No emitidos</span>}
                    </td>
                    <td className="px-6 py-3 text-right"><a href={`https://explorer.solana.com/address/${sale.address}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="font-mono text-[#68717b] underline decoration-dotted underline-offset-2 hover:text-[#e60012]">{shortAddress(sale.address)} ↗</a></td>
                    <td className="px-4 py-3 text-right"><button type="button" onClick={() => void handleViewDetails(sale)} disabled={detailLoading !== null} className="whitespace-nowrap rounded-md border border-[#e2e5e8] px-2.5 py-1.5 text-[9px] font-semibold text-[#555e68] transition hover:border-[#e60012] hover:text-[#e60012] disabled:opacity-50">{detailLoading === sale.address ? "Cargando…" : "Ver detalles"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex min-h-[150px] flex-col items-center justify-center px-6 text-center">
            <p className="text-[11px] font-semibold text-[#515962]">{loading ? "Consultando ventas…" : "Todavía no hay ventas registradas"}</p>
            <p className="mt-1 text-[10px] text-[#9aa1a9]">Las ventas confirmadas en la blockchain aparecerán aquí.</p>
          </div>
        )}
      </section>

      {detailLoading && !saleDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#171b20]/40 p-4">
          <div className="rounded-xl bg-white px-6 py-5 text-center shadow-xl">
            <p className="text-[11px] font-semibold text-[#252a30]">Consultando datos on-chain…</p>
            <p className="mt-1 text-[10px] text-[#858d96]">Leyendo las cuentas vinculadas a la venta.</p>
          </div>
        </div>
      )}

      {saleDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#171b20]/50 p-4" onClick={() => setSaleDetails(null)}>
          <section role="dialog" aria-modal="true" aria-labelledby="sale-details-title" onClick={(event) => event.stopPropagation()} className="my-auto max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-[#eff0f2] bg-white px-6 py-5">
              <div>
                <p className="text-[9px] font-bold tracking-[0.16em] text-[#e60012]">REGISTRO ON-CHAIN</p>
                <h2 id="sale-details-title" className="mt-1 text-[17px] font-bold text-[#252a30]">Detalle de la venta</h2>
                <p className="mt-1 font-mono text-[10px] text-[#858d96]">{shortAddress(saleDetails.sale.address)}</p>
              </div>
              <button type="button" onClick={() => setSaleDetails(null)} aria-label="Cerrar detalles" className="rounded-lg border border-[#e2e5e8] px-3 py-1.5 text-[12px] text-[#68717b] hover:bg-[#f7f8fa]">✕</button>
            </div>

            <div className="space-y-5 p-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-[#f7f8fa] p-4">
                  <p className="text-[9px] font-bold tracking-wide text-[#9299a1]">PRECIO DE VENTA</p>
                  <p className="mt-2 text-[24px] font-bold text-[#252a30]">{formatAmount(saleDetails.sale.data.precioVenta)}</p>
                  <p className="mt-1 text-[10px] text-[#858d96]">Monto almacenado en la cuenta Venta</p>
                </div>
                <div className="rounded-xl bg-[#f7f8fa] p-4">
                  <p className="text-[9px] font-bold tracking-wide text-[#9299a1]">FECHA DE REGISTRO</p>
                  <p className="mt-2 text-[14px] font-bold text-[#252a30]">{new Date(Number(saleDetails.sale.data.fechaVenta) * 1000).toLocaleString("es-VE")}</p>
                  <p className="mt-1 text-[10px] text-[#858d96]">Timestamp guardado on-chain</p>
                </div>
              </div>

              <div className={saleDetails.sale.reward ? "rounded-xl border border-[#bfe8d2] bg-[#f5fcf8] p-4" : "rounded-xl border border-[#eff0f2] bg-[#fafbfc] p-4"}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[11px] font-bold text-[#252a30]">Recompensa de fidelización</h3>
                  {saleDetails.sale.reward ? (
                    <span className="rounded-full bg-[#dff5e8] px-2.5 py-1 text-[9px] font-bold text-[#16845a]">PUNTOS ACREDITADOS</span>
                  ) : (
                    <span className="rounded-full bg-[#f0f1f3] px-2.5 py-1 text-[9px] font-bold text-[#858d96]">SIN EMISIÓN</span>
                  )}
                </div>
                {saleDetails.sale.reward ? (
                  <>
                    <p className="mt-2 text-[25px] font-extrabold text-[#176b4b]">+{formatAmount(saleDetails.sale.reward.cantidad)} BERA</p>
                    <div className="mt-2 grid gap-2 text-[10px] text-[#68717b] sm:grid-cols-2">
                      <p>Fecha de emisión: <strong className="text-[#252a30]">{new Date(Number(saleDetails.sale.reward.fechaEmision) * 1000).toLocaleString("es-VE")}</strong></p>
                      <p>Wallet receptora: <a href={"https://explorer.solana.com/address/" + saleDetails.sale.reward.wallet + "?cluster=devnet"} target="_blank" rel="noopener noreferrer" className="break-all font-mono text-[#16845a] underline decoration-dotted">{shortAddress(saleDetails.sale.reward.wallet)} ↗</a></p>
                    </div>
                    <p className="mt-2 break-all font-mono text-[9px] text-[#8b9690]">Wallet receptora: {saleDetails.sale.reward.wallet}</p>
                  </>
                ) : (
                  <p className="mt-2 text-[10px] leading-relaxed text-[#858d96]">Esta venta no tiene un registro de emisión de puntos asociado.</p>
                )}
              </div>

              <div className="rounded-xl border border-[#eff0f2] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[11px] font-bold text-[#252a30]">Cuenta Venta</h3>
                  <a href={`https://explorer.solana.com/address/${saleDetails.sale.address}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="text-[9px] font-semibold text-[#e60012] hover:underline">Abrir en Explorer ↗</a>
                </div>
                <p className="mt-2 break-all font-mono text-[10px] text-[#68717b]">{saleDetails.sale.address}</p>
                <div className="mt-3 grid gap-2 text-[10px] sm:grid-cols-2">
                  <p><span className="text-[#9299a1]">Concesionario:</span> <span className="break-all font-mono">{saleDetails.sale.data.concesionario}</span></p>
                  <p><span className="text-[#9299a1]">Cliente:</span> <span className="break-all font-mono">{saleDetails.sale.data.cliente}</span></p>
                  <p className="sm:col-span-2"><span className="text-[#9299a1]">Moto:</span> <span className="break-all font-mono">{saleDetails.sale.data.moto}</span></p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-[#eff0f2] p-4">
                  <h3 className="text-[11px] font-bold text-[#252a30]">Cliente</h3>
                  <p className="mt-2 text-[14px] font-bold text-[#252a30]">{saleDetails.customer.nombreCliente}</p>
                  <div className="mt-3 space-y-2 text-[10px] text-[#68717b]">
                    <p>Cédula: <strong className="text-[#252a30]">{saleDetails.customer.cedulaCliente}</strong></p>
                    <p>ID cliente: <strong className="text-[#252a30]">{saleDetails.customer.idCliente}</strong></p>
                    <p>Motos asociadas: <strong className="text-[#252a30]">{saleDetails.customer.totalMotosCliente}</strong></p>
                    <p>Owner: <span className="break-all font-mono">{saleDetails.customer.owner}</span></p>
                    <p>PDA: <a className="break-all font-mono text-[#e60012] hover:underline" href={`https://explorer.solana.com/address/${saleDetails.sale.data.cliente}?cluster=devnet`} target="_blank" rel="noopener noreferrer">{saleDetails.sale.data.cliente} ↗</a></p>
                  </div>
                </div>

                <div className="rounded-xl border border-[#eff0f2] p-4">
                  <h3 className="text-[11px] font-bold text-[#252a30]">Moto</h3>
                  <p className="mt-2 text-[14px] font-bold text-[#252a30]">{saleDetails.motorcycle.marca} {saleDetails.motorcycle.modelo}</p>
                  <div className="mt-3 space-y-2 text-[10px] text-[#68717b]">
                    <p>Serial: <strong className="font-mono text-[#252a30]">{saleDetails.motorcycle.serial}</strong></p>
                    <p>Placa: <strong className="font-mono text-[#252a30]">{saleDetails.motorcycle.placa}</strong></p>
                    <p>Color: <strong className="text-[#252a30]">{saleDetails.motorcycle.color}</strong></p>
                    <p>Vendida: <strong className="text-[#252a30]">{saleDetails.motorcycle.vendida ? "Sí" : "No"}</strong></p>
                    <p>Servicios: <strong className="text-[#252a30]">{saleDetails.motorcycle.servicios.toString()}</strong> · Reclamaciones: <strong className="text-[#252a30]">{saleDetails.motorcycle.totalReclamaciones.toString()}</strong></p>
                    <p>Garantía PDA: <span className="break-all font-mono">{saleDetails.motorcycle.garantia}</span></p>
                    <p>PDA: <a className="break-all font-mono text-[#e60012] hover:underline" href={`https://explorer.solana.com/address/${saleDetails.sale.data.moto}?cluster=devnet`} target="_blank" rel="noopener noreferrer">{saleDetails.sale.data.moto} ↗</a></p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[#eff0f2] p-4">
                <h3 className="text-[11px] font-bold text-[#252a30]">Concesionario</h3>
                <p className="mt-2 text-[14px] font-bold text-[#252a30]">{saleDetails.dealership.nombreConcesionario}</p>
                <div className="mt-3 grid gap-2 text-[10px] text-[#68717b] sm:grid-cols-2">
                  <p>RIF: <strong className="text-[#252a30]">{saleDetails.dealership.rifConcesionario}</strong></p>
                  <p>ID: <strong className="text-[#252a30]">{saleDetails.dealership.idConcesionario}</strong></p>
                  <p>Total motos: <strong className="text-[#252a30]">{saleDetails.dealership.totalMotos.toString()}</strong></p>
                  <p>Total clientes: <strong className="text-[#252a30]">{saleDetails.dealership.totalClientes}</strong></p>
                  <p>Total ventas: <strong className="text-[#252a30]">{saleDetails.dealership.totalVentas.toString()}</strong></p>
                  <p>Total servicios: <strong className="text-[#252a30]">{saleDetails.dealership.totalServicios.toString()}</strong></p>
                  <p>Garantía (días): <strong className="text-[#252a30]">{saleDetails.dealership.duracionGarantiaDias}</strong></p>
                  <p>Km máximo: <strong className="text-[#252a30]">{saleDetails.dealership.kilometrajeMaximo.toString()}</strong></p>
                  <p className="sm:col-span-2">Owner: <span className="break-all font-mono">{saleDetails.dealership.owner}</span></p>
                  <p className="sm:col-span-2">PDA: <a className="break-all font-mono text-[#e60012] hover:underline" href={`https://explorer.solana.com/address/${saleDetails.sale.data.concesionario}?cluster=devnet`} target="_blank" rel="noopener noreferrer">{saleDetails.sale.data.concesionario} ↗</a></p>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
