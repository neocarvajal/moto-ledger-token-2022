#!/usr/bin/env node
/**
 * Reconstruct dealership/customer associations from existing on-chain sales.
 *
 * Default mode is DRY RUN. Pass --execute to submit transactions.
 * Optional CUSTOMER_ASSOCIATION_MAPPING points to a JSON file containing
 * additional, manually verified associations:
 * [{ "concesionario": "<pubkey>", "cliente": "<pubkey>" }]
 *
 * Required: SOLANA_KEYPAIR_PATH (defaults to ~/.config/solana/id.json).
 * Optional: SOLANA_RPC_URL (defaults to Solana Devnet).
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  clusterApiUrl,
} from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("64dHKqRTBciEidqLJqCvTWEGWkR1QqyYDZgomMt9AWCj");
const RPC_URL = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
const KEYPAIR_PATH = process.env.SOLANA_KEYPAIR_PATH || path.join(os.homedir(), ".config/solana/id.json");
const MAPPING_PATH = process.env.CUSTOMER_ASSOCIATION_MAPPING;
const EXECUTE = process.argv.includes("--execute");
const COMMITMENT = "confirmed";

const discriminator = (namespace, name) =>
  createHash("sha256").update(`${namespace}:${name}`).digest().subarray(0, 8);
const same = (a, b) => a.equals(b);
const readU32 = (data, offset) => data.readUInt32LE(offset);
const readString = (data, offset) => {
  const length = readU32(data, offset);
  const start = offset + 4;
  return { value: data.subarray(start, start + length).toString("utf8"), next: start + length };
};

function decodeCustomerOwner(data) {
  if (data.length < 40) throw new Error("Cliente account is truncated");
  return new PublicKey(data.subarray(8, 40));
}

function decodeDealership(data) {
  if (data.length < 74) throw new Error("Concesionario account is truncated");
  return { owner: new PublicKey(data.subarray(8, 40)) };
}

function decodeSale(data) {
  if (data.length < 112) throw new Error("Venta account is truncated");
  return {
    dealership: new PublicKey(data.subarray(8, 40)),
    customer: new PublicKey(data.subarray(40, 72)),
  };
}

function deriveAssociation(dealership, customer) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("asociacion_cliente"), dealership.toBuffer(), customer.toBuffer()],
    PROGRAM_ID
  )[0];
}

function createAssociationInstruction(owner, dealership, customer, association) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: dealership, isSigner: false, isWritable: true },
      { pubkey: customer, isSigner: false, isWritable: false },
      { pubkey: association, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: discriminator("global", "registrar_asociacion_cliente"),
  });
}

async function main() {
  const secret = JSON.parse(await readFile(KEYPAIR_PATH, "utf8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
  const connection = new Connection(RPC_URL, COMMITMENT);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Owner/payer: ${payer.publicKey.toBase58()}`);
  console.log(`Mode: ${EXECUTE ? "EXECUTE" : "DRY RUN"}`);

  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    commitment: COMMITMENT,
    dataSlice: undefined,
  });

  const dealerDisc = discriminator("account", "Concesionario");
  const customerDisc = discriminator("account", "Cliente");
  const saleDisc = discriminator("account", "Venta");
  const associationDisc = discriminator("account", "AsociacionCliente");

  const dealerships = new Map();
  const customers = new Map();
  const sales = [];
  let existingAssociations = 0;

  for (const item of accounts) {
    const data = item.account.data;
    if (data.length < 8) continue;
    const disc = data.subarray(0, 8);
    if (same(disc, dealerDisc)) dealerships.set(item.pubkey.toBase58(), decodeDealership(data).owner);
    else if (same(disc, customerDisc)) customers.set(item.pubkey.toBase58(), decodeCustomerOwner(data));
    else if (same(disc, saleDisc)) sales.push(decodeSale(data));
    else if (same(disc, associationDisc)) existingAssociations++;
  }

  const proposed = new Map();
  const unresolvedSales = [];
  for (const sale of sales) {
    const dealership = sale.dealership.toBase58();
    const customer = sale.customer.toBase58();
    if (!dealerships.has(dealership) || !customers.has(customer)) {
      unresolvedSales.push({ dealership, customer });
      continue;
    }
    proposed.set(`${dealership}:${customer}`, { dealership: sale.dealership, customer: sale.customer, source: "sale" });
  }

  if (MAPPING_PATH) {
    const manual = JSON.parse(await readFile(MAPPING_PATH, "utf8"));
    if (!Array.isArray(manual)) throw new Error("Mapping file must contain a JSON array.");
    for (const entry of manual) {
      const dealership = new PublicKey(entry.concesionario);
      const customer = new PublicKey(entry.cliente);
      if (!dealerships.has(dealership.toBase58())) throw new Error(`Unknown dealership in mapping: ${dealership}`);
      if (!customers.has(customer.toBase58())) throw new Error(`Unknown customer in mapping: ${customer}`);
      proposed.set(`${dealership}:${customer}`, { dealership, customer, source: "manual" });
    }
  }

  const notAssigned = [];
  for (const customer of customers.keys()) {
    const linked = [...proposed.values()].some((item) => item.customer.toBase58() === customer);
    if (!linked) notAssigned.push(customer);
  }

  console.log("\nOn-chain inventory");
  console.log(`  Dealerships: ${dealerships.size}`);
  console.log(`  Global customers: ${customers.size}`);
  console.log(`  Sales: ${sales.length}`);
  console.log(`  Existing association accounts: ${existingAssociations}`);
  console.log(`  Candidate associations: ${proposed.size}`);
  console.log(`  Sales with missing dealership/customer records: ${unresolvedSales.length}`);
  console.log(`  Customers with no recoverable dealership association: ${notAssigned.length}`);

  const report = [];
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of proposed.values()) {
    const dealershipAddress = entry.dealership.toBase58();
    const customerAddress = entry.customer.toBase58();
    const dealershipOwner = dealerships.get(dealershipAddress);
    if (!dealershipOwner.equals(payer.publicKey)) {
      report.push({ dealership: dealershipAddress, customer: customerAddress, status: "skipped-owner-mismatch" });
      skipped++;
      continue;
    }

    const [association] = PublicKey.findProgramAddressSync(
      [Buffer.from("asociacion_cliente"), entry.dealership.toBuffer(), entry.customer.toBuffer()],
      PROGRAM_ID
    );
    const current = await connection.getAccountInfo(association, COMMITMENT);
    if (current) {
      report.push({ dealership: dealershipAddress, customer: customerAddress, association: association.toBase58(), status: "already-exists" });
      skipped++;
      continue;
    }

    if (!EXECUTE) {
      report.push({ dealership: dealershipAddress, customer: customerAddress, association: association.toBase58(), source: entry.source, status: "would-create" });
      continue;
    }

    try {
      const instruction = createAssociationInstruction(payer.publicKey, entry.dealership, entry.customer, association);
      const transaction = new Transaction().add(instruction);
      const signature = await sendAndConfirmTransaction(connection, transaction, [payer], {
        commitment: COMMITMENT,
        preflightCommitment: COMMITMENT,
      });
      report.push({ dealership: dealershipAddress, customer: customerAddress, association: association.toBase58(), source: entry.source, signature, status: "created" });
      created++;
      console.log(`Created ${association.toBase58()} (${signature})`);
    } catch (error) {
      report.push({ dealership: dealershipAddress, customer: customerAddress, association: association.toBase58(), status: "failed", error: error instanceof Error ? error.message : String(error) });
      failed++;
      console.error(`Failed ${dealershipAddress} / ${customerAddress}:`, error);
    }
  }

  const output = {
    cluster: "devnet",
    programId: PROGRAM_ID.toBase58(),
    payer: payer.publicKey.toBase58(),
    dryRun: !EXECUTE,
    totals: {
      dealerships: dealerships.size,
      customers: customers.size,
      sales: sales.length,
      candidateAssociations: proposed.size,
      created,
      skipped,
      failed,
      unresolvedSales: unresolvedSales.length,
      customersWithoutRecoveredAssociation: notAssigned.length,
    },
    unresolvedSales,
    customersWithoutRecoveredAssociation: notAssigned,
    associations: report,
  };
  const reportPath = path.resolve("customer-association-migration-report.json");
  await (await import("node:fs/promises")).writeFile(reportPath, JSON.stringify(output, null, 2) + "\n");
  console.log(`\nReport: ${reportPath}`);
  console.log(`Created: ${created}; skipped: ${skipped}; failed: ${failed}`);
  if (!EXECUTE) console.log("\nDry run only. Review the report, then rerun with --execute to submit transactions.");
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
