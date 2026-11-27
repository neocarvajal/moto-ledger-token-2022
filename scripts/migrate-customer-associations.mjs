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
 * Run only after regenerating Codama clients from the updated Anchor IDL.
 */
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  address,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  getBase64Encoder,
  getUtf8Encoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
} from "@solana/kit";
import { getConcesionarioDecoder, getConcesionarioDiscriminatorBytes } from "../app/lib/moto-ledger/src/generated/accounts/concesionario.ts";
import { getClienteDecoder, getClienteDiscriminatorBytes } from "../app/lib/moto-ledger/src/generated/accounts/cliente.ts";
import { getVentaDecoder, getVentaDiscriminatorBytes } from "../app/lib/moto-ledger/src/generated/accounts/venta.ts";
import { getAsociacionClienteDecoder, getAsociacionClienteDiscriminatorBytes } from "../app/lib/moto-ledger/src/generated/accounts/asociacionCliente.ts";
import { getRegistrarAsociacionClienteInstruction } from "../app/lib/moto-ledger/src/generated/instructions/registrarAsociacionCliente.ts";
import { REGISTRO_PROGRAM_ADDRESS } from "../app/lib/moto-ledger/src/generated/programs/index.ts";

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const WS_URL = RPC_URL.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
const KEYPAIR_PATH = process.env.SOLANA_KEYPAIR_PATH || path.join(os.homedir(), ".config/solana/id.json");
const MAPPING_PATH = process.env.CUSTOMER_ASSOCIATION_MAPPING;
const EXECUTE = process.argv.includes("--execute");
const utf8 = getUtf8Encoder();
const addressEncoder = getAddressEncoder();
const seed = (value) => utf8.encode(value);
const key = (value) => addressEncoder.encode(value as ReturnType<typeof address>);

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
  const dealerDisc = getConcesionarioDiscriminatorBytes();
  const customerDisc = getClienteDiscriminatorBytes();
  const saleDisc = getVentaDiscriminatorBytes();
  const associationDisc = getAsociacionClienteDiscriminatorBytes();
  const dealers = new Map();
  const customers = new Map();
  const sales = [];
  let associationCount = 0;

  for (const account of rawAccounts) {
    const encoded = account.account.data[0];
    const bytes = getBase64Encoder().encode(encoded);
    const discriminator = bytes.subarray(0, 8);
    const pubkey = account.pubkey;

    if (discriminator.every((value, index) => value === dealerDisc[index])) {
      const decoded = getConcesionarioDecoder().decode(bytes);
      dealers.set(pubkey, { owner: decoded.owner });
    } else if (discriminator.every((value, index) => value === customerDisc[index])) {
      const decoded = getClienteDecoder().decode(bytes);
      customers.set(pubkey, { owner: decoded.owner });
    } else if (discriminator.every((value, index) => value === saleDisc[index])) {
      const decoded = getVentaDecoder().decode(bytes);
      sales.push({ dealership: decoded.concesionario, customer: decoded.cliente });
    } else if (discriminator.every((value, index) => value === associationDisc[index])) {
      getAsociacionClienteDecoder().decode(bytes);
      associationCount++;
    }
  }

  const candidates = new Map();
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
    const dealer = dealers.get(dealership)!;
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
      const instruction = getRegistrarAsociacionClienteInstruction({
        owner: payer,
        concesionario: address(dealership),
        cliente: address(customer),
        asociacionCliente: association,
      });
      const latest = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
      let message = createTransactionMessage({ version: 0 });
      message = setTransactionMessageFeePayerSigner(payer, message);
      message = setTransactionMessageLifetimeUsingBlockhash(latest.value, message);
      message = appendTransactionMessageInstruction(instruction, message);
      const signed = await signTransactionMessageWithSigners(message);
      const result = await sendAndConfirm(signed, { commitment: "confirmed" });
      report.push({ dealership, customer, association, source: item.source, signature: result, status: "created" });
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
