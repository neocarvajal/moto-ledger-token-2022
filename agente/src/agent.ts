import "./silenciarAvisos";
import "./cargarEnv";
import * as readline from "readline";
import { Keypair } from "@solana/web3.js";
import { ChatGoogle } from "@langchain/google/node";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import {
  SolanaAgentKit,
  createLangchainTools,
  KeypairWallet,
} from "solana-agent-kit";
import MotoLedgerPlugin from "./plugins/moto-ledger";

/** Spinner minimalista: solo se anima cuando la salida es una terminal real. */
function iniciarCargando(texto: string): () => void {
  if (!process.stdout.isTTY) return () => {};

  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const inicio = Date.now();
  let indice = 0;
  let activo = true;

  const limpiar = () => {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
  };
  const dibujar = () => {
    const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
    process.stdout.write(`${frames[indice]} ${texto} ${segundos}s`);
  };

  dibujar();
  const temporizador = setInterval(() => {
    if (!activo) return;
    indice = (indice + 1) % frames.length;
    limpiar();
    dibujar();
  }, 100);

  return () => {
    if (!activo) return;
    activo = false;
    clearInterval(temporizador);
    limpiar();
  };
}

type ErrorModelo = {
  url?: string;
  status?: number;
  statusCode?: number;
  message?: string;
  data?: { error?: { code?: number; status?: string; message?: string } };
};

/** Solo cambia de modelo ante fallos del servicio de Gemini, no ante errores RPC. */
function esErrorDelModelo(error: unknown): boolean {
  const e = (error ?? {}) as ErrorModelo;
  const url = e.url ?? "";
  const texto = [e.message, e.data?.error?.status, e.data?.error?.message]
    .filter(Boolean)
    .join(" ");
  if (/generativelanguage\.googleapis\.com/i.test(url)) return true;
  const codigo = e.statusCode ?? e.status ?? e.data?.error?.code;
  if (codigo === 503) return true;
  return (
    codigo === 429 &&
    /RESOURCE_EXHAUSTED|quota|rate limit|high demand/i.test(texto)
  );
}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("Falta GEMINI_API_KEY en agente/.env.");
}

const modeloPrincipal = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const modelosRespaldo = (
  process.env.GEMINI_MODEL_FALLBACKS ??
  "gemini-flash-lite-latest,gemini-3.1-flash-lite,gemini-3.5-flash"
)
  .split(",")
  .map((modelo) => modelo.trim())
  .filter(Boolean);
const modelos = [...new Set([modeloPrincipal, ...modelosRespaldo])];

const wallet = new KeypairWallet(Keypair.generate(), process.env.RPC_URL!);
const solanaAgent = new SolanaAgentKit(wallet, process.env.RPC_URL!, {}).use(
  MotoLedgerPlugin
);
const tools = createLangchainTools(solanaAgent, solanaAgent.actions);

const instrucciones = `Eres el asistente de consulta de MotoLedger, un concesionario de motocicletas sobre Solana.
Para cualquier pregunta sobre el estado actual, usa SIEMPRE la herramienta
MOTOLEDGER_RESUMEN_CONCESIONARIO y responde solo con los datos que devuelva.

Si el usuario menciona un nombre de concesionario, pásalo como nombreConcesionario.
La herramienta compara los nombres sin distinguir mayúsculas, así que no hace falta
pedir al usuario que los escriba en mayúsculas ni corregir su casing.
Si dice "mi concesionario" o no especifica cuál, omite el parámetro para usar
NOMBRE_CONCESIONARIO del entorno (actualmente ${process.env.NOMBRE_CONCESIONARIO ?? "sin configurar"}).
Si menciona un nombre distinto, consúltalo igualmente; la herramienta indicará si no existe.

La herramienta siempre devuelve concesionariosDelOwner con el total y el detalle
(nombre, dirección e id) de TODOS los concesionarios creados por el Owner.
Para preguntas como "¿cuántos concesionarios hay registrados por el Owner?" o
"¿qué concesionarios pertenecen a esta pubkey?", responde usando ese bloque;
no inventes nombres ni te limites a los ejemplos EK EMPIRE, BERA MOTORS y MOTOS TORO.

No inventes cuentas, importes, fechas ni resultados. Si la herramienta falla o
devuelve existe: false, comunícalo sin presentar un resumen como válido.
Los importes son precios de venta o costos de servicio registrados on-chain;
no son saldos de una wallet ni facturación histórica. Las fechas son marcas de
tiempo Unix devueltas por la herramienta.
Para clientes, distingue siempre dos cifras: clientes.declarados es el total
registrado en la cuenta del concesionario; clientes.desdeVentas es cuántas
cuentas Cliente se pudieron vincular desde sus ventas. Cuando pregunten
"cuántos clientes tiene", responde primero con clientes.declarados y después
menciona cuántos están vinculados por ventas. Si declarados > 0 y desdeVentas = 0,
explica que el concesionario declara clientes pero no hay ventas que permitan
identificar cuentas Cliente concretas; nunca respondas que tiene 0 clientes.
Las cuentas Cliente pertenecen a la autoridad indicada en OWNER, no al concesionario.
Los datos de cada cliente son los que devuelve el cliente generado: dirección, id,
nombre, cédula y totalMotosCliente. No inventes otros atributos ni un "cliente destacado".
Cuando pidan "los datos del cliente" o el nombre de un cliente del concesionario,
usa clientes.delConcesionario.detalle, que incluye a los clientes registrados por
ese concesionario aunque no tengan ventas. Muestra nombre, cédula, id y
totalMotosCliente; el campo concesionario se obtiene de la instrucción de registro.
Si clientes.delOwner.sinAtribuir es mayor que cero, aclara que algunos clientes del
Owner no se pudieron atribuir y que el listado de delConcesionario puede estar incompleto.
Nunca respondas que no hay datos si delConcesionario contiene clientes.
Responde en español y menciona la dirección del concesionario cuando corresponda.`;

// Un agente por modelo: createReactAgent enlaza las herramientas dentro del
// propio modelo, así que el respaldo debe construirse también como agente.
const agentes = modelos.map((modelo) => ({
  modelo,
  agente: createReactAgent({
    llm: new ChatGoogle({ model: modelo, apiKey, maxRetries: 1 }),
    tools: tools as any,
    messageModifier: instrucciones,
  }),
}));

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: ">>>> Tú: ",
});

let entradaAbierta = true;
rl.on("close", () => {
  entradaAbierta = false;
});

console.log(
  `Agente de MotoLedger listo. Concesionario por defecto: "${
    process.env.NOMBRE_CONCESIONARIO ?? "sin configurar"
  }". Escribe 'exit' para salir.`
);
console.log(`Modelos: ${modelos.join(" → ")}.`);
rl.prompt();

// El historial se lleva en memoria para que todos los agentes vean la misma
// conversación si hace falta cambiar de modelo a mitad de la sesión.
let historial: BaseMessage[] = [];

for await (const input of rl) {
  if (input.toLowerCase() === "exit") break;

  const detenerCarga = iniciarCargando("Pensando y consultando…");
  const mensajes = [...historial, new HumanMessage(input)];
  const avisos: string[] = [];
  let respuesta: { messages: BaseMessage[] } | undefined;
  let ultimoError: unknown;

  try {
    for (let i = 0; i < agentes.length; i += 1) {
      const { modelo, agente } = agentes[i];
      try {
        respuesta = await agente.invoke({ messages: mensajes });
        if (i > 0) {
          avisos.push(`Modelo principal no disponible; se usó ${modelo}.`);
        }
        break;
      } catch (error) {
        ultimoError = error;
        if (!esErrorDelModelo(error) || i === agentes.length - 1) {
          throw error;
        }
        avisos.push(`Modelo ${modelo} no disponible; probando el siguiente.`);
      }
    }

    if (!respuesta) throw ultimoError;
    detenerCarga();
    for (const aviso of avisos) console.error(aviso);
    historial = respuesta.messages;
    const ultimo = historial[historial.length - 1];
    console.log(`\nAgente: ${ultimo.text}\n`);
  } catch (error) {
    detenerCarga();
    console.error("Error:", error);
  }

  if (entradaAbierta) rl.prompt();
}

rl.close();
