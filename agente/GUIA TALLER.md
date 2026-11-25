# Taller 1 · Solana Agent: asistente de consulta para el Registro de Ventas

Guía paso a paso para integrar un agente de IA de terminal que consulta en Solana Devnet el registro de ventas creado con **Registro-Ventas-Solana-App**. El agente se construye adaptando archivos del repositorio **WayLearn-Solana-Agent**.

## Objetivo

Al terminar, tendrás una carpeta `agente/` dentro de la app con un plugin `registro-ventas`. Su tool `REGISTRO_RESUMEN_NEGOCIO` deriva la PDA del registro, lee las cuentas Registro → Cliente → Venta con el cliente generado por Codama y entrega al modelo un resumen del negocio: clientes, ventas activas, monto total y mejor cliente.

## Decisiones de diseño

| Decisión | Motivo |
|---|---|
| El programa on-chain no cambia | El agente se adapta al programa: solo lee las cuentas que ya existen. |
| El agente vive en `agente/` dentro de la app | Reutiliza `idl.json` y el cliente de Codama (`clients/js`) de la app, sin copiarlos. |
| Una sola tool de lectura | Sesión breve y menos herramientas para un modelo local de 7B. |
| `NEGOCIO` y `OWNER` en `.env` | Son las seeds de la PDA del registro; el modelo no tiene que pedirlos ni inventarlos. |
| Los cálculos se hacen en la tool | Los modelos pequeños se equivocan al sumar; el modelo solo explica. |
| Wallet efímera (`Keypair.generate()`) | Leer no requiere firma: el agente no guarda ninguna llave privada. |
| ESM con `tsx` | El cliente de Codama es ESM y no puede importarse con `ts-node` en CommonJS. |

## Requisitos

- Node.js 22.12 o superior, menor que 25 (el rango que pide la app).
- Programa del registro de ventas desplegado en Devnet y su IDL exportado desde Solana Playground.
- Un registro creado desde la app con al menos un cliente y una venta. Anota el **nombre exacto del negocio** y la **wallet** que lo creó.
- LM Studio con un modelo compatible con tool calling (recomendado: Qwen2.5 7B Instruct), o una API compatible con OpenAI.

## Estructura final

```
proyecto/
├── WayLearn-Solana-Agent/            ← referencia (solo se copian archivos)
└── Registro-Ventas-Solana-App/
    ├── clients/js/src/generated/     ← cliente de Codama (lo usa el agente)
    ├── idl.json
    └── agente/
        ├── .env
        ├── .gitignore
        ├── package.json
        ├── tsconfig.json
        └── src/
            ├── agent.ts
            ├── prueba.ts
            └── plugins/registro-ventas/
                ├── index.ts
                ├── actions/resumenNegocio.ts
                └── tools/resumenNegocio.ts
```

---

## Paso 1. Crear la carpeta del proyecto

```bash
mkdir proyecto
cd proyecto
```

## Paso 2. Clonar la app

```bash
git clone https://github.com/WayLearnLatam/Registro-Ventas-Solana-App.git
```

## Paso 3. Clonar el repositorio del agente en el mismo directorio

```bash
git clone https://github.com/WayLearnLatam/WayLearn-Solana-Agent.git
```

Basta con clonar; no hace falta fork, porque solo se copian archivos de este repositorio.

## Paso 4. Preparar la app

Antes necesitas el programa desplegado y su IDL. Desde la raíz de `Registro-Ventas-Solana-App`:

```bash
cd Registro-Ventas-Solana-App
npm install
npm run configurar:idl -- ./tmp-idl/registro.json   # importa tu IDL; agrega --program-id TU_PROGRAM_ID si el IDL no lo incluye
npm run cliente
```

> ℹ️ Usa `npm install` en lugar de `npm ci`: el `package-lock.json` del repositorio no está sincronizado y `npm ci` falla.

Si todavía no tienes un registro, créalo desde la app (`npm run dev`) con la wallet del navegador.

## Paso 5. Copiar los archivos que se van a adaptar

Desde la raíz de `Registro-Ventas-Solana-App`:

```bash
mkdir -p agente/src/plugins/registro-ventas/{tools,actions}

cp ../WayLearn-Solana-Agent/package.json ../WayLearn-Solana-Agent/tsconfig.json agente/
cp ../WayLearn-Solana-Agent/src/agent.ts agente/src/
cp ../WayLearn-Solana-Agent/src/plugins/solana-reader/index.ts agente/src/plugins/registro-ventas/index.ts
cp ../WayLearn-Solana-Agent/src/plugins/solana-reader/tools/getSolBalance.ts agente/src/plugins/registro-ventas/tools/resumenNegocio.ts
cp ../WayLearn-Solana-Agent/src/plugins/solana-reader/actions/getSolBalance.ts agente/src/plugins/registro-ventas/actions/resumenNegocio.ts
printf 'node_modules\n.env\n' > agente/.gitignore
```

No se copian el `.env` (contiene una llave privada), los archivos de pnpm ni los plugins `binance` y `solana-manager`. La plantilla del nuevo plugin es `getSolBalance`, la tool más sencilla de `solana-reader`.

## Paso 6. Adaptar `agente/package.json`

**Cambios respecto al original:**

- `"type": "module"`: el cliente de Codama es ESM.
- `start` se ejecuta con `tsx` en lugar de `ts-node`.
- Se eliminan las dependencias de Metaplex, SPL y los plugins de `solana-agent-kit` que no se usan.
- Se agrega `@solana/kit`, la biblioteca que usa el cliente de Codama.
- Se elimina el bloque `pnpm.overrides`, porque se usa npm.

```json
{
  "name": "registro-ventas-agente",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "tsx src/agent.ts"
  },
  "dependencies": {
    "@langchain/core": "^1.1.46",
    "@langchain/langgraph": "^1.3.0",
    "@langchain/openai": "^1.4.5",
    "@solana/kit": "^8.6.0",
    "@solana/web3.js": "^1.98.4",
    "dotenv": "^17.4.2",
    "solana-agent-kit": "^2.0.10",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.20.0",
    "typescript": "^5.9.0"
  }
}
```

Instala las dependencias:

```bash
cd agente
npm install
```

> A partir de aquí, todos los comandos se ejecutan desde `agente/`.

## Paso 7. Adaptar `agente/tsconfig.json`

**Cambios respecto al original:** `"module": "commonjs"` pasa a `"ESNext"`, se agregan `skipLibCheck` y `noEmit`, y se elimina `ignoreDeprecations`.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "strict": false,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

## Paso 8. Adaptar la tool: `src/plugins/registro-ventas/tools/resumenNegocio.ts`

**Cambios respecto a `getSolBalance`:**

- Se conserva la firma `(agent: SolanaAgentKit, ...)`, pero ya no recibe `input`: el negocio y el owner vienen del `.env`.
- En lugar de `connection.getBalance`, deriva la PDA del registro con las mismas seeds que el programa en Rust y lee Registro → Clientes → Ventas con el cliente de Codama.
- Devuelve un objeto plano con los totales ya calculados. Si el registro no existe, devuelve un motivo claro en lugar de fallar.

```ts
import { PublicKey } from "@solana/web3.js";
import { address, createSolanaRpc } from "@solana/kit";
import { SolanaAgentKit } from "solana-agent-kit";
import {
  REGISTRO_PROGRAM_ADDRESS,
  fetchMaybeRegistro,
  fetchAllCliente,
  fetchAllVenta,
} from "../../../../../clients/js/src/generated";

export async function resumenNegocio(agent: SolanaAgentKit) {
  const negocio = process.env.NEGOCIO!;
  const owner = process.env.OWNER!;
  const rpc = createSolanaRpc(agent.connection.rpcEndpoint);

  // Mismas seeds que en Rust: [b"registro", nombre_negocio, owner]
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registro"), Buffer.from(negocio), new PublicKey(owner).toBuffer()],
    new PublicKey(REGISTRO_PROGRAM_ADDRESS)
  );

  const registro = await fetchMaybeRegistro(rpc, address(pda.toBase58()));
  if (!registro.exists) {
    return { existe: false, motivo: `No existe el registro "${negocio}" para la wallet ${owner}` };
  }

  const cuentasCliente = await fetchAllCliente(rpc, registro.data.clientes);
  const clientes = await Promise.all(
    cuentasCliente.map(async (c) => {
      const ventas = await fetchAllVenta(rpc, c.data.historial);
      return {
        id: c.data.idCliente,
        nombre: c.data.nombre,
        compras: c.data.compras,
        direccion: c.address,
        ventas: ventas.map((v) => ({ sku: v.data.sku, descripcion: v.data.descripcion, monto: v.data.monto })),
      };
    })
  );

  // Los calculos se hacen aqui, no en el modelo
  const ventas = clientes.flatMap((c) => c.ventas);
  const mejor = [...clientes].sort((a, b) => b.compras - a.compras)[0];

  return {
    existe: true,
    negocio: registro.data.nombreNegocio,
    direccion: pda.toBase58(),
    total_clientes: clientes.length,
    total_ventas_activas: ventas.length,
    monto_total: ventas.reduce((suma, v) => suma + v.monto, 0),
    mejor_cliente: mejor ? { id: mejor.id, nombre: mejor.nombre, compras: mejor.compras } : null,
    clientes,
  };
}
```

> El import del cliente sube cinco niveles (`tools` → `registro-ventas` → `plugins` → `src` → `agente`) hasta la raíz de la app.

## Paso 9. Crear `agente/.env`

```env
RPC_URL=https://api.devnet.solana.com
NEGOCIO=Nombre exacto de tu negocio
OWNER=TuWalletPublica

# LLM local con LM Studio
LLM_BASE_URL=http://localhost:1234/v1
LLM_MODEL=qwen2.5-7b-instruct
LLM_API_KEY=lm-studio

# Alternativa con OpenAI (comenta el bloque anterior)
# LLM_BASE_URL=https://api.openai.com/v1
# LLM_MODEL=gpt-4o-mini
# LLM_API_KEY=sk-...
```

- `NEGOCIO` debe coincidir exactamente (mayúsculas y espacios) con el nombre usado al crear el registro.
- `OWNER` es la dirección pública de la wallet que creó el registro: sin comillas ni espacios.
- No se necesita ninguna llave privada.

## Paso 10. Adaptar la action: `src/plugins/registro-ventas/actions/resumenNegocio.ts`

**Cambios respecto a `GetSolBalanceAction`:** el `name`, la `description`, los `similes` y los `examples`. El `schema` queda vacío (`z.object({})`) porque la tool no recibe parámetros. El tipo `AgentAction` y la forma del `handler` se conservan.

La `description` es lo que lee el modelo para decidir cuándo usar la tool, así que debe ser explícita.

```ts
import { z } from "zod";
import { resumenNegocio } from "../tools/resumenNegocio";

type AgentAction = {
  name: string; description: string; similes: string[];
  examples: any[]; schema: any;
  handler: (agent: any, input: any) => Promise<any>;
};

const ResumenNegocioAction: AgentAction = {
  name: "REGISTRO_RESUMEN_NEGOCIO",
  description:
    "Lee en Solana el registro de ventas del negocio del usuario: clientes, compras, ventas activas, " +
    "monto total y mejor cliente. Usala para CUALQUIER pregunta sobre el negocio, sus clientes o sus ventas.",
  similes: ["mis ventas", "mis clientes", "resumen del negocio", "mejor cliente", "cuanto he vendido"],
  examples: [[{
    input: {},
    output: { status: "success", result: { existe: true, total_clientes: 2 } },
    explanation: "Resumen del registro configurado en .env",
  }]],
  schema: z.object({}),
  handler: async (agent: any) => {
    try {
      return { status: "success", result: await resumenNegocio(agent) };
    } catch (e) {
      return { status: "error", message: (e as Error).message };
    }
  },
};

export default ResumenNegocioAction;
```

## Paso 11. Adaptar el plugin: `src/plugins/registro-ventas/index.ts`

**Cambios respecto a `solana-reader/index.ts`:** el `name`, y que `methods` y `actions` contienen solo la nueva tool. El `initialize` se conserva.

```ts
import { SolanaAgentKit } from "solana-agent-kit";
import { resumenNegocio } from "./tools/resumenNegocio";
import ResumenNegocioAction from "./actions/resumenNegocio";

const RegistroVentasPlugin = {
  name: "registro-ventas",
  methods: {
    resumenNegocio,
  },
  actions: [
    ResumenNegocioAction,
  ],
  initialize(agent: SolanaAgentKit) {
    Object.entries(this.methods).forEach(([name, fn]) => {
      if (typeof fn === "function") {
        (this.methods as any)[name] = fn.bind(null, agent);
      }
    });
  },
};

export default RegistroVentasPlugin;
```

## Paso 12. Adaptar `src/agent.ts`

**Cambios respecto al original:**

| Original | Adaptado | Motivo |
|---|---|---|
| `import * as dotenv` y `dotenv.config()` | `import "dotenv/config"` | En ESM, las variables deben cargarse antes que los demás imports. |
| `baseURL` y modelo fijos para LM Studio | `LLM_BASE_URL`, `LLM_MODEL` y `LLM_API_KEY` desde `.env` | Cambiar de proveedor solo requiere editar el `.env`. |
| Keypair desde `SOLANA_PRIVATE_KEY` | `Keypair.generate()` | El agente solo lee; no necesita una llave real. |
| 8 plugins importados, 3 activos | Solo `RegistroVentasPlugin` | Menos tools, mejor elección del modelo. |
| Prompt de trading y wallet | Prompt del negocio | Obliga a usar la tool y a no inventar datos. |
| `rl.question` recursivo | `for await` sobre `rl` | El original falla con entrada por pipe; en uso interactivo funcionan igual. |

```ts
import "dotenv/config";
import * as readline from "readline";
import { Keypair } from "@solana/web3.js";
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { SolanaAgentKit, createLangchainTools, KeypairWallet } from "solana-agent-kit";
import RegistroVentasPlugin from "./plugins/registro-ventas";

// 1. LLM: LM Studio por defecto; cualquier API compatible con OpenAI cambiando el .env
const llm = new ChatOpenAI({
  model: process.env.LLM_MODEL || "qwen2.5-7b-instruct",
  configuration: {
    baseURL: process.env.LLM_BASE_URL || "http://localhost:1234/v1",
    apiKey: process.env.LLM_API_KEY || "lm-studio",
  },
  temperature: 0,
});

// 2. Wallet efimera: el agente solo lee, no necesita una llave real
const wallet = new KeypairWallet(Keypair.generate(), process.env.RPC_URL!);

// 3. Agente con un solo plugin
const solanaAgent = new SolanaAgentKit(wallet, process.env.RPC_URL!, {}).use(RegistroVentasPlugin);
const tools = createLangchainTools(solanaAgent, solanaAgent.actions);

const agent = createReactAgent({
  llm,
  tools: tools as any,
  checkpointSaver: new MemorySaver(),
  messageModifier: `Eres el asistente del negocio "${process.env.NEGOCIO}" registrado en Solana.
Para cualquier pregunta sobre el negocio, sus clientes o sus ventas usa SIEMPRE la herramienta
REGISTRO_RESUMEN_NEGOCIO y responde solo con los datos que devuelva. Nunca inventes datos.
Si la herramienta indica que el registro no existe, dilo y muestra el motivo.
Responde en espanol, breve, y menciona la direccion de la cuenta cuando sea relevante.`,
});

// 4. Chat en la terminal
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: ">>>> 👉 Tú: " });
console.log(`🤖 Agente de "${process.env.NEGOCIO}" listo. Escribe 'exit' para salir.\n`);
rl.prompt();

for await (const input of rl) {
  if (input.toLowerCase() === "exit") break;
  try {
    const r = await agent.invoke(
      { messages: [new HumanMessage(input)] },
      { configurable: { thread_id: "sesion-1" } }
    );
    console.log(`\n🤖 Agente: ${r.messages[r.messages.length - 1].content}\n`);
  } catch (err) {
    console.error("Error:", err);
  }
  rl.prompt();
}

rl.close();
```

## Paso 13. Probar la tool sin el modelo

Antes de involucrar al LLM, comprueba que la lectura en Devnet funciona. Crea `src/prueba.ts`:

```ts
import "dotenv/config";
import { Keypair } from "@solana/web3.js";
import { SolanaAgentKit, KeypairWallet } from "solana-agent-kit";
import { resumenNegocio } from "./plugins/registro-ventas/tools/resumenNegocio";

const wallet = new KeypairWallet(Keypair.generate(), process.env.RPC_URL!);
const agente = new SolanaAgentKit(wallet, process.env.RPC_URL!, {});

console.log(JSON.stringify(await resumenNegocio(agente), null, 2));
```

Desde `agente/`:

```bash
npx tsx src/prueba.ts
```

**Resultado esperado:** un objeto con `"existe": true`, la dirección del registro, sus clientes y ventas. Si aparece `"existe": false`, revisa `NEGOCIO` y `OWNER` antes de continuar.

## Paso 14. Levantar el modelo y ejecutar el agente

Con LM Studio:

```bash
lms load qwen2.5-7b-instruct --gpu max
lms server start
```

El nombre del modelo debe coincidir con `LLM_MODEL`. En Codespaces no es posible alcanzar el LM Studio de tu computadora: ejecuta el agente en local o usa la alternativa de API en el `.env`.

Desde `agente/`:

```bash
npm start
```

**Preguntas de prueba:**

- ¿Quién es mi mejor cliente?
- ¿Cuánto he vendido en total?
- ¿Qué compró el cliente 1?
- ¿Cuál es la dirección de mi registro?

**Resultado esperado:** el agente llama a `REGISTRO_RESUMEN_NEGOCIO` y responde con los datos leídos de Devnet, incluida la dirección de la cuenta cuando corresponde.

---

## Errores frecuentes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `Error: Non-base58 character` | `OWNER` no es una dirección válida: valor de ejemplo, comillas, espacios o `\r` de Windows | Pega la dirección real sin comillas. Revisa con `node -e 'require("dotenv").config(); console.log(JSON.stringify(process.env.OWNER))'` y limpia `\r` con `sed -i 's/\r$//' .env` |
| `"existe": false` | `NEGOCIO` no coincide exactamente u `OWNER` no es la wallet que creó el registro | Corrige el `.env` |
| `Cannot find module .../clients/js/src/generated` | No se ejecutó `npm run cliente` en la raíz de la app | Ejecútalo desde `Registro-Ventas-Solana-App` |
| Error de `require`, ESM o `import` al arrancar | Falta `"type": "module"` o se usó `ts-node` | Revisa el paso 6 |
| Variables vacías (`undefined`) | El comando se ejecutó fuera de `agente/` y no se encontró el `.env` | Ejecuta los comandos desde `agente/` |
| `ECONNREFUSED 127.0.0.1:1234` | El servidor de LM Studio no está activo | `lms server start` |
| El agente responde sin usar la tool | El modelo no maneja bien tool calling | Usa un modelo más grande o la API externa |
| `npm ci` falla en la app | `package-lock.json` desincronizado | Usa `npm install` |

## Seguridad y alcance

- **Lectura y firma separadas:** el agente lee cualquier registro con una wallet efímera, sin fondos ni autoridad, y no puede modificar ninguna cuenta.
- **Sin secretos en el repositorio:** `.env` está en `.gitignore`. No copies el `.env` del repositorio de referencia.
- **La seguridad está en el programa:** si en una extensión el agente intentara escribir con una wallet que no es la autoridad, el programa la rechazaría (`has_one = owner`), sin importar lo que diga el prompt.
- **Alcance educativo:** la tool lee hasta 10 clientes por registro, el límite del programa del ejercicio. No es una implementación para producción.

## Extensión opcional

Agregar una segunda tool de escritura (por ejemplo, `registrar_venta`) que construya la instrucción con el cliente de Codama y pida confirmación (s/n) antes de firmar. Requiere una wallet real que sea la autoridad del registro.
