import {
  generateKeyPairSigner,
  type Address,
  type TransactionSigner,
} from "@solana/kit";
import {
  AuthorityType,
  extension,
  getInitializeMintInstruction,
  getMintSize,
  getPostInitializeInstructionsForMintExtensions,
  getPreInitializeInstructionsForMintExtensions,
  getSetAuthorityInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { getCreateAccountInstruction } from "@solana-program/system";
import type { AppClient } from "../solana-client";
import {
  deriveAutoridadFidelidadPda,
  deriveProgramaFidelidadPda,
} from "./pdas";

export type CreateLoyaltyMintInput = {
  client: AppClient;
  owner: TransactionSigner;
  concesionario: Address;
  nombreConcesionario: string;
  name: string;
  symbol: string;
  description: string;
  metadataUri: string;
  puntosPorVenta: bigint;
};

/**
 * Creates the dealership's Token-2022 loyalty mint and registers it on MotoLedger.
 *
 * The mint is created with MetadataPointer and NonTransferable before
 * InitializeMint. TokenMetadata is initialized after the mint, then the mint
 * authority is transferred to the dealership's program-derived authority.
 * All instructions are sent atomically in one transaction.
 */
export async function createLoyaltyMint({
  client,
  owner,
  concesionario,
  nombreConcesionario,
  name,
  symbol,
  description,
  metadataUri,
  puntosPorVenta,
}: CreateLoyaltyMintInput) {
  if (puntosPorVenta <= 0n) {
    throw new Error("Los puntos por venta deben ser mayores a cero.");
  }

  const [programaFidelidad] = await deriveProgramaFidelidadPda(concesionario);
  const [autoridadFidelidad] =
    await deriveAutoridadFidelidadPda(concesionario);

  const existingProgram = await client.registro.accounts.programaFidelidad
    .fetch(programaFidelidad)
    .catch(() => null);

  if (existingProgram) {
    throw new Error("Este concesionario ya tiene un programa de fidelización configurado.");
  }

  const mint = await generateKeyPairSigner();

  const metadataPointerExtension = extension("MetadataPointer", {
    authority: owner.address,
    metadataAddress: mint.address,
  });
  const nonTransferableExtension = extension("NonTransferable", {});
  const tokenMetadataExtension = extension("TokenMetadata", {
    updateAuthority: owner.address,
    mint: mint.address,
    name,
    symbol,
    uri: metadataUri,
    additionalMetadata: new Map<string, string>([["description", description]]),
  });

  const extensions = [
    metadataPointerExtension,
    nonTransferableExtension,
    tokenMetadataExtension,
  ];

  // TokenMetadata is initialized after InitializeMint, so the account is
  // allocated without its variable-length TLV data but funded for the full size.
  const mintSpace = BigInt(
    getMintSize([metadataPointerExtension, nonTransferableExtension])
  );
  const fullMintSpace = BigInt(getMintSize(extensions));
  const mintRent = await client.rpc
    .getMinimumBalanceForRentExemption(fullMintSpace)
    .send();

  const configureProgramInstruction =
    client.registro.instructions.configurarProgramaFidelidad({
      owner,
      concesionario,
      programaFidelidad,
      autoridadFidelidad,
      mint: mint.address,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      nombreConcesionario,
      puntosPorVenta,
    });

  const instructions = [
    getCreateAccountInstruction({
      payer: owner,
      newAccount: mint,
      lamports: mintRent,
      space: mintSpace,
      programAddress: TOKEN_2022_PROGRAM_ADDRESS,
    }),
    ...getPreInitializeInstructionsForMintExtensions(mint.address, extensions),
    getInitializeMintInstruction({
      mint: mint.address,
      decimals: 0,
      mintAuthority: owner.address,
      freezeAuthority: null,
    }),
    ...getPostInitializeInstructionsForMintExtensions(
      mint.address,
      owner,
      extensions
    ),
    getSetAuthorityInstruction({
      owned: mint.address,
      owner,
      authorityType: AuthorityType.MintTokens,
      newAuthority: autoridadFidelidad,
    }),
    configureProgramInstruction,
  ];

  const result = await client.sendTransaction(instructions);

  return {
    mint: mint.address,
    programaFidelidad,
    autoridadFidelidad,
    signature: result.context.signature,
  };
}
