import { address } from "@solana/kit";
import type { AppClient } from "./solana-client";
import { deriveCatalogoServiciosPda, deriveProgramaFidelidadPda, deriveWalletClientePda } from "./moto-ledger/pdas";

export type RedemptionIntent = {
  owner: string;
  concesionario: string;
  cliente: string;
  clienteNombre: string;
  clienteCedula: string;
  walletAddress: string;
  mint: string;
  servicioId: number;
  puntos: string;
};

export async function validateRedemptionIntentOnChain(client: AppClient, intent: RedemptionIntent) {
  const [programPda] = await deriveProgramaFidelidadPda(address(intent.concesionario));
  const [catalogPda] = await deriveCatalogoServiciosPda(address(intent.concesionario));
  const [walletPda] = await deriveWalletClientePda(address(intent.cliente));
  const [program, catalog, customer, linkedWallet, dealer] = await Promise.all([
    client.registro.accounts.programaFidelidad.fetch(programPda),
    client.registro.accounts.catalogoServicios.fetch(catalogPda),
    client.registro.accounts.cliente.fetch(address(intent.cliente)),
    client.registro.accounts.walletCliente.fetch(walletPda),
    client.registro.accounts.concesionario.fetch(address(intent.concesionario)),
  ]);
  const service = catalog.data.servicios.find((item) => item.id === intent.servicioId);
  if (
    dealer.data.owner !== intent.owner ||
    program.data.concesionario !== intent.concesionario ||
    program.data.mint !== intent.mint ||
    catalog.data.concesionario !== intent.concesionario ||
    !service || !service.activo || service.puntos !== BigInt(intent.puntos) ||
    linkedWallet.data.cliente !== intent.cliente ||
    linkedWallet.data.wallet !== intent.walletAddress ||
    customer.data.nombreCliente !== intent.clienteNombre ||
    String(customer.data.cedulaCliente) !== intent.clienteCedula
  ) {
    throw new Error("La solicitud no coincide con los datos actuales del concesionario en Solana. No firmes esta transacción.");
  }
  return { service, mint: program.data.mint, wallet: linkedWallet.data.wallet };
}
