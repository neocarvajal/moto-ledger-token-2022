import "./silenciarAvisos";
import "./cargarEnv";
import { Keypair } from "@solana/web3.js";
import { SolanaAgentKit, KeypairWallet } from "solana-agent-kit";
import { resumenConcesionario } from "./plugins/moto-ledger/tools/resumenConcesionario";

const wallet = new KeypairWallet(Keypair.generate(), process.env.RPC_URL!);
const agente = new SolanaAgentKit(wallet, process.env.RPC_URL!, {});

console.log("=== 1) Sin argumento: usa NOMBRE_CONCESIONARIO de .env ===");
console.log(JSON.stringify(await resumenConcesionario(agente), null, 2));

console.log("\n=== 2) Con parámetro: BERA MOTORS ===");
console.log(
  JSON.stringify(
    await resumenConcesionario(agente, {
      nombreConcesionario: "BERA MOTORS",
    }),
    null,
    2
  )
);

console.log("\n=== 3) Con parámetro: MOTOS TORO ===");
console.log(
  JSON.stringify(
    await resumenConcesionario(agente, {
      nombreConcesionario: "MOTOS TORO",
    }),
    null,
    2
  )
);

console.log("\n=== 4) Caso inexistente: CONCESIONARIO QUE NO EXISTE ===");
console.log(
  JSON.stringify(
    await resumenConcesionario(agente, {
      nombreConcesionario: "CONCESIONARIO QUE NO EXISTE",
    }),
    null,
    2
  )
);
