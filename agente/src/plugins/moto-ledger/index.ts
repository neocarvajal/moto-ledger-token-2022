import type { Plugin, SolanaAgentKit } from "solana-agent-kit";
import { resumenConcesionario } from "./tools/resumenConcesionario";
import ResumenConcesionarioAction from "./actions/resumenConcesionario";

const MotoLedgerPlugin: Plugin = {
  name: "moto-ledger",
  methods: { resumenConcesionario },
  actions: [ResumenConcesionarioAction],
  initialize(agent: SolanaAgentKit) {
    Object.entries(this.methods).forEach(([name, fn]) => {
      if (typeof fn === "function") {
        (this.methods as Record<string, unknown>)[name] = fn.bind(null, agent);
      }
    });
  },
};

export default MotoLedgerPlugin;
