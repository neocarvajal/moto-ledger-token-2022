#!/usr/bin/env node
/**
 * Rebuild dealership/customer links from existing on-chain sales.
 *
 * Default: dry-run. Add --execute to submit missing association PDAs.
 * Optional CUSTOMER_ASSOCIATION_MAPPING: JSON array of manually verified
 * pairs [{ "concesionario": "<address>", "cliente": "<address>" }].
 *
 * SOLANA_KEYPAIR_PATH defaults to ~/.config/solana/id.json.
 * SOLANA_RPC_URL defaults to Devnet.
 *
 * This utility uses raw account layouts and does not depend on generated Codama clients.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AccountRole,
  address,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  getAddressEncoder,
  getBase58Decoder,
  getBase64Encoder,
  getUtf8Encoder,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
} from "@solana/kit";
const REGISTRO_PROGRAM_ADDRESS = address("64dHKqRTBciEidqLJqCvTWEGWkR1QqyYDZgomMt9AWCj");
const accountDiscriminator = (name) =>
  new Uint8Array(createHash("sha256").update(`account:${name}`).digest().subarray(0, 8));
const instructionDiscriminator = new Uint8Array(
  createHash("sha256").update("global:registrar_asociacion_cliente").digest().subarray(0, 8)
);
const accountDiscriminators = {
  dealership: accountDiscriminator("Concesionario"),
  customer: accountDiscriminator("Cliente"),
  sale: accountDiscriminator("Venta"),
  association: accountDiscriminator("AsociacionCliente"),
};
const base58 = getBase58Decoder();
const readAddress = (bytes, offset) => base58.decode(bytes.subarray(offset, offset + 32));

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const WS_URL = RPC_URL.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
const KEYPAIR_PATH = process.env.SOLANA_KEYPAIR_PATH || path.join(os.homedir(), ".config/solana/id.json");
const MAPPING_PATH = process.env.CUSTOMER_ASSOCIATION_MAPPING;
const EXECUTE = process.argv.includes("--execute");
const utf8 = getUtf8Encoder();
const addressEncoder = getAddressEncoder();
const seed = (value) => utf8.encode(value);
const key = (value) => addressEncoder.encode(address(value));

async function deriveAssociation(dealership, customer) {
  return getProgramDerivedAddress({
    programAddress: REGISTRO_PROGRAM_ADDRESS,
    seeds: [seed("asociacion_cliente"), key(dealership), key(customer)],
  });
}

async function main() {
  const secret = JSON.parse(await readFile(KEYPAIR_PATH, "utf8"));
  const payer = await createKeyPairSignerFromBytes(new Uint8Array(secret));
  const rpc = createSolanaRpc(RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Owner/payer: ${payer.address}`);
  console.log(`Mode: ${EXECUTE ? "EXECUTE" : "DRY RUN"}`);

  const rawAccounts = await rpc.getProgramAccounts(REGISTRO_PROGRAM_ADDRESS, { encoding: "base64" }).send();
  const dealerDisc = accountDiscriminators.dealership;
  const customerDisc = accountDiscriminators.customer;
  const saleDisc = accountDiscriminators.sale;
  const associationDisc = accountDiscriminators.association;
  const dealers = new Map();
  const customers = new Map();
  const sales = [];
  const existingPairs = [];
  let associationCount = 0;

  for (const account of rawAccounts) {
    const encoded = account.account.data[0];
    const bytes = getBase64Encoder().encode(encoded);
    const discriminator = bytes.subarray(0, 8);
    const pubkey = account.pubkey;

    if (discriminator.every((value, index) => value === dealerDisc[index])) {
      dealers.set(pubkey, { owner: readAddress(bytes, 8) });
    } else if (discriminator.every((value, index) => value === customerDisc[index])) {
      customers.set(pubkey, { owner: readAddress(bytes, 8) });
    } else if (discriminator.every((value, index) => value === saleDisc[index])) {
      sales.push({ dealership: readAddress(bytes, 8), customer: readAddress(bytes, 40) });
    } else if (discriminator.every((value, index) => value === associationDisc[index])) {
      existingPairs.push({ dealership: readAddress(bytes, 40), customer: readAddress(bytes, 72), source: "existing" });
      associationCount++;
    }
  }

  const candidates = new Map();
  for (const pair of existingPairs) {
    candidates.set(`${pair.dealership}:${pair.customer}`, pair);
  }
  const unresolvedSales = [];
  for (const sale of sales) {
    if (!dealers.has(sale.dealership) || !customers.has(sale.customer)) {
      unresolvedSales.push(sale);
      continue;
    }
    candidates.set(`${sale.dealership}:${sale.customer}`, { ...sale, source: "sale" });
  }

  if (MAPPING_PATH) {
    const manual = JSON.parse(await readFile(MAPPING_PATH, "utf8"));
    if (!Array.isArray(manual)) throw new Error("Mapping file must contain a JSON array.");
    for (const entry of manual) {
      const dealership = address(entry.concesionario);
      const customer = address(entry.cliente);
      if (!dealers.has(dealership)) throw new Error(`Unknown dealership in mapping: ${dealership}`);
      if (!customers.has(customer)) throw new Error(`Unknown customer in mapping: ${customer}`);
      candidates.set(`${dealership}:${customer}`, { dealership, customer, source: "manual" });
    }
  }

  const customersWithoutAssociation = [...customers.keys()].filter(
    (customer) => ![...candidates.values()].some((item) => item.customer === customer)
  );
  const report = [];
  let created = 0;
  let skipped = 0;
  let failed = 0;

  console.log("\nOn-chain inventory");
  console.log(`  Dealerships: ${dealers.size}`);
  console.log(`  Global customers: ${customers.size}`);
  console.log(`  Sales: ${sales.length}`);
  console.log(`  Existing associations: ${associationCount}`);
  console.log(`  Candidate associations: ${candidates.size}`);
  console.log(`  Customers without a recoverable dealership link: ${customersWithoutAssociation.length}`);
  console.log(`  Sales with missing related accounts: ${unresolvedSales.length}`);

  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  for (const item of candidates.values()) {
    const dealership = item.dealership;
    const customer = item.customer;
    const dealer = dealers.get(dealership);
    if (dealer.owner !== payer.address) {
      report.push({ dealership, customer, status: "skipped-owner-mismatch" });
      skipped++;
      continue;
    }

    const [association] = await deriveAssociation(dealership, customer);
    const existing = await rpc.getAccountInfo(association, { encoding: "base64" }).send();
    if (existing.value) {
      report.push({ dealership, customer, association, status: "already-exists" });
      skipped++;
      continue;
    }

    if (!EXECUTE) {
      report.push({ dealership, customer, association, source: item.source, status: "would-create" });
      continue;
    }

    try {
      const instruction = {
        programAddress: REGISTRO_PROGRAM_ADDRESS,
        accounts: [
          { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
          { address: address(dealership), role: AccountRole.WRITABLE },
          { address: address(customer), role: AccountRole.READONLY },
          { address: association, role: AccountRole.WRITABLE },
          { address: address("11111111111111111111111111111111"), role: AccountRole.READONLY },
        ],
        data: instructionDiscriminator,
      };
      const latest = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
      let message = createTransactionMessage({ version: 0 });
      message = setTransactionMessageFeePayerSigner(payer, message);
      message = setTransactionMessageLifetimeUsingBlockhash(latest.value, message);
      message = appendTransactionMessageInstruction(instruction, message);
      const signed = await signTransactionMessageWithSigners(message);
      const signature = getSignatureFromTransaction(signed);
      await sendAndConfirm(signed, { commitment: "confirmed" });
      report.push({ dealership, customer, association, source: item.source, signature, status: "created" });
      created++;
      console.log(`Created association ${association}`);
    } catch (error) {
      report.push({ dealership, customer, association, status: "failed", error: error instanceof Error ? error.message : String(error) });
      failed++;
      console.error(`Failed ${dealership} / ${customer}:`, error);
    }
  }

  const output = {
    cluster: "devnet",
    programId: REGISTRO_PROGRAM_ADDRESS,
    payer: payer.address,
    dryRun: !EXECUTE,
    totals: {
      dealerships: dealers.size,
      customers: customers.size,
      sales: sales.length,
      existingAssociations: associationCount,
      candidateAssociations: candidates.size,
      created,
      skipped,
      failed,
      customersWithoutRecoverableAssociation: customersWithoutAssociation.length,
      unresolvedSales: unresolvedSales.length,
    },
    customersWithoutRecoverableAssociation: customersWithoutAssociation,
    unresolvedSales,
    associations: report,
  };
  const reportPath = path.resolve("customer-association-migration-report.json");
  await writeFile(reportPath, JSON.stringify(output, null, 2) + "\n");
  console.log(`\nReport: ${reportPath}`);
  console.log(`Created: ${created}; skipped: ${skipped}; failed: ${failed}`);
  if (!EXECUTE) console.log("\nDry run only. Review the report, then rerun with --execute.");
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
