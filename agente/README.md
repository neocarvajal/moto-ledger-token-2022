# Agente de consulta MotoLedger

Asistente de **solo lectura** para consultar el registro de MotoLedger en Solana (Devnet). Corre en Node.js/terminal, separado del frontend Next.js: no firma transacciones, no envía tokens ni modifica cuentas.

Usa **Gemini** mediante el conector oficial de LangChain (`@langchain/google` / `ChatGoogle`). No hay servidor local ni endpoint compatible con OpenAI: el SDK de Google gestiona automáticamente las firmas de razonamiento (`thought_signature`) que Gemini 3 exige en el function calling.

<p align="center">
  <img src="../assets/moto-ledger-solana-gent-kit.gif" alt="Demostración animada del agente de MotoLedger" width="100%">
</p>


La implementación está adaptada del taller *Solana Agent: asistente de consulta para el registro de ventas*. El material original se conserva en `GUIA TALLER.md` como referencia; ese archivo no interviene en la ejecución.

## Requisitos

- Node.js 18+ (probado con Node 24).
- Un RPC de Devnet accesible desde el proceso.
- Una API key de Gemini con acceso al modelo configurado; se crea en [Google AI Studio](https://aistudio.google.com/).
- La prueba directa (`npm run prueba`) **no necesita modelo**: solo lee la blockchain.

## Instalación

```bash
cd agente
npm install
```

Crea `agente/.env` con este contenido (sin comillas y sin espacios):

```env
RPC_URL=https://api.devnet.solana.com
OWNER=CCF4CnM99mXSxz2sFffxT4A4CZxpWNsKNPbwueJThGMo
NOMBRE_CONCESIONARIO=EK EMPIRE

GEMINI_API_KEY=TuClaveDeGemini
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_MODEL_FALLBACKS=gemini-flash-lite-latest,gemini-3.1-flash-lite,gemini-3.5-flash
```

Puedes crear el API KEY de GEMINI acá: https://aistudio.google.com/api-keys

`agente/.env.example` es la plantilla versionable (sin secretos): copiarla como `.env` y rellenar los valores reales. El `.env` real está ignorado por Git (`.gitignore` → `.env*`); nunca subirlo. Si una clave fue compartida en un chat o commit, rotarla.

`src/cargarEnv.ts` carga `agente/.env` mediante una ruta calculada desde el propio archivo. Funciona con `npm start` desde `agente/` y con `tsx agente/src/prueba.ts` desde la raíz del repositorio.

### Variables de entorno

| Variable | Descripción |
| --- | --- |
| `RPC_URL` | Endpoint RPC de Devnet. |
| `OWNER` | Dirección pública de la autoridad que creó los concesionarios. No es el Program ID ni una clave privada. |
| `NOMBRE_CONCESIONARIO` | Concesionario por defecto cuando la pregunta no indica uno. |
| `GEMINI_API_KEY` | Clave de la API de Gemini, creada en [Google AI Studio](https://aistudio.google.com/). |
| `GEMINI_MODEL` | Modelo principal. Por defecto `gemini-3.5-flash-lite`. |
| `GEMINI_MODEL_FALLBACKS` | Modelos de respaldo, separados por comas y en orden de preferencia. Por defecto `gemini-flash-lite-latest,gemini-3.1-flash-lite,gemini-3.5-flash`. |

### Modelos de respaldo

Si el modelo principal responde `503 UNAVAILABLE` ("high demand") o un `429` de cuota, el agente prueba los modelos de `GEMINI_MODEL_FALLBACKS` en el orden indicado. Cada modelo se inicializa como agente con las mismas herramientas, así que el function calling sigue funcionando; el historial de la conversación se conserva al cambiar de modelo. Solo se cambia de modelo ante errores de Gemini: un fallo del RPC se reporta tal cual.

Los modelos `gemini-2.5-*` aparecen en el listado de la API, pero las cuentas nuevas reciben `404`: conviene no usarlos como respaldo. Los modelos `*-pro-*` pueden devolver `429` por cuota.

Concesionarios registrados para el `OWNER` configurado (la tool compara el nombre sin distinguir mayúsculas ni espacios repetidos):

- `EK EMPIRE` — por defecto en el ejemplo.
- `BERA MOTORS`
- `MOTOS TORO`

Si se consulta un nombre no registrado, la herramienta devuelve `existe: false` con el motivo, sin inventar datos.

## Ejecución

```bash
cd agente

# Asistente conversacional por terminal
npm start

# Prueba directa sin modelo (cuatro casos)
npm run prueba

# Comprobación de tipos
npm run typecheck
```

La salida es limpia: `.npmrc` desactiva los `npm notice` y `silenciarAvisos.ts` filtra el único aviso inofensivo de `bigint-buffer`. En `npm start` solo verás el saludo, el prompt, el spinner y la respuesta.

En el asistente, escribe `exit` para salir. Ejemplos de preguntas:

- `¿Cuál es el resumen de mi concesionario?` → usa `NOMBRE_CONCESIONARIO`.
- `Dame el estado de BERA MOTORS` → pasa `nombreConcesionario: "BERA MOTORS"`.
- `¿Cuántas motos tiene MOTOS TORO?` → consulta ese concesionario por su nombre exacto.
- `¿Cuántos concesionarios hay registrados por el Owner?` → responde con `concesionariosDelOwner.total` (3 en Devnet).
- `¿Cuántos clientes tiene BERA MOTORS?` → 3 declarados y 0 vinculados por ventas; se explica la diferencia.

El agente responde en español y cita la dirección del concesionario cuando corresponde.

## Estructura

```
agente/
├── GUIA TALLER.md                     # referencia del taller original
├── README.md
├── .env.example                       # plantilla versionable, sin secretos
├── .npmrc                             # loglevel=silent: sin npm notice
├── package.json
├── tsconfig.json
└── src/
    ├── agent.ts                       # ChatGoogle + agente ReAct + readline
    ├── prueba.ts                      # prueba directa de la herramienta
    ├── cargarEnv.ts                   # carga .env relatives al código
    ├── silenciarAvisos.ts             # filtra el aviso de bigint-buffer
    └── plugins/moto-ledger/
        ├── index.ts                   # plugin MotoLedgerPlugin
        ├── actions/resumenConcesionario.ts
        └── tools/resumenConcesionario.ts
```

- **Tool** (`resumenConcesionario`): resuelve el nombre (parámetro opcional o `.env`), deriva la PDA del concesionario con `deriveConcesionarioPda` y lee el registro. Devuelve los totales ya calculados junto con el detalle de motos, ventas, servicios y clientes. Los `bigint` se entregan como `string` para no perder precisión.
- **Concesionarios del Owner**: toda respuesta incluye `concesionariosDelOwner` con `total` y `detalle` (id, nombre y dirección) de **todos** los concesionarios creados por `OWNER`. Se obtiene con `getProgramAccounts` filtrando por discriminador de `Concesionario` y por `owner` en `offset: 8n`, y se cachea 30 segundos por proceso para no saturar el RPC. Así se pueden responder preguntas de conteo o listado sin depender de una lista fija de nombres.
- **Action** (`MOTOLEDGER_RESUMEN_CONCESIONARIO`): expone la tool al modelo con `z.object({ nombreConcesionario: z.string().trim().min(1).optional() })` y convierte errores en `{ status: "error", message }`.
- **Plugin** (`MotoLedgerPlugin`): registra `methods` e `initialize`, haciendo `bind(null, agent)` para que la tool reciba la conexión del kit.

### ¿Por qué la tool importa decoders?

El cliente generado ofrece `fetchMaybeConcesionario` y `fetchAllMaybeCliente`, que se usan cuando la dirección ya se conoce. En cambio, `Concesionario` **no guarda listas** de motos, ventas ni servicios: esas cuentas se descubren con `getProgramAccounts` filtrando por discriminador (y por concesionario en `offset: 8n` cuando aplica). Los bytes crudos devueltos por RPC deben decodificarse con `get*Decoder`, de ahí esos imports.

Cada `Venta` incluye la dirección del `Cliente`, así que esas direcciones se consultan con `fetchAllMaybeCliente`. Además se listan todas las cuentas `Cliente` del `Owner` con `getProgramAccounts` filtrando por discriminador y por `owner` en `offset: 8n`.

### Nota sobre los clientes

La instrucción `registrar_cliente` se ejecuta para un concesionario del `Owner`, pero la cuenta `Cliente` resultante guarda únicamente al `owner`, el `id` y los datos personales: no guarda el concesionario. El nombre del concesionario se recupera decodificando la instrucción de registro de la transacción con `getRegistrarClienteInstructionDataDecoder()`, también del cliente generado. Esa atribución es inmutable y se guarda en memoria.

Por eso el resumen distingue:

- `clientes.declarados`: lo que indica la cuenta `Concesionario`.
- `clientes.desdeVentas`: clientes vinculados al concesionario a través de sus ventas.
- `clientes.detalle`: clientes vinculados por ventas, con dirección, `id`, `nombre`, `cedula` y `totalMotosCliente`.
- `clientes.delOwner`: todas las cuentas `Cliente` del `Owner`, con su concesionario de registro cuando se pudo resolver (`sinAtribuir` cuenta los que no).
- `clientes.delConcesionario`: los clientes registrados por el concesionario consultado, aunque no tengan ventas. Es el bloque que responde a «dame los datos del cliente registrado en MOTOS TORO».

Los nombres de cliente, cédulas y totals salen del cliente generado; no se calcula un "cliente destacado" ni un empate. Cuando `clientes.declarados` es mayor que cero y `clientes.desdeVentas` es cero, la respuesta correcta usa `clientes.delConcesionario` y muestra los datos. Decir que el concesionario tiene 0 clientes sería incorrecto.

## Evidencia de la prueba directa

Salida de `npm run prueba` contra Devnet:

| Caso | Concesionario | Motos (declaradas / total / disp. / vend.) | Ventas (decl. / cant. / monto) | Clientes (decl. / desde ventas) | Servicios (decl. / cant.) |
| --- | --- | --- | --- | --- | --- |
| Sin argumento | EK EMPIRE | 4 / 4 / 2 / 2 | 2 / 2 / 7800 | 1 / 1 (Erick Carvajal, 2 motos) | 2 / 2 |
| Con parámetro | BERA MOTORS | 3 / 3 / 3 / 0 | 0 / 0 / 0 | 3 / 0 | 0 / 0 |
| Con parámetro | MOTOS TORO | 3 / 3 / 3 / 0 | 0 / 0 / 0 | 1 / 0 | 0 / 0 |
| Nombre inexistente | — | — | — | — | — |

Detalles relevantes:

- `concesionariosDelOwner.total` → **3** en los cuatro casos (BERA MOTORS, EK EMPIRE y MOTOS TORO), también cuando el nombre consultado no existe.
- `EK EMPIRE` → PDA `E6huXEfqSdaroxkDnfpxyqHqtZDJwMxz7Vdjs7ygG74x`.
- `BERA MOTORS` → PDA `7n7tA4N999UpXc6vfV7odSVek4JydyMEfUZNdGsbsc7o`.
- `MOTOS TORO` → PDA `8WQjh7p1vmnPRVicWVvS5gXxZmibd5YfTfmkGRwufYKS`.
- Caso inexistente → `{ "existe": false, "nombre": "...", "motivo": "No existe el concesionario ... para la autoridad <OWNER>" }`.

`npm run typecheck` pasa. Durante `npm install` pueden aparecer avisos de vulnerabilidades y de scripts bloqueados (`esbuild`, `bufferutil`, `utf-8-validate`, `bigint-buffer`); la tool funciona igualmente con la implementación pura de JS para bigint.

## Problemas frecuentes

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| `Falta GEMINI_API_KEY en agente/.env.` | No se creó el `.env` o falta la clave. | Añade `GEMINI_API_KEY`. |
| `Please pass a valid API key` | Clave inválida o rotada. | Genera una clave nueva en AI Studio y actualiza `.env`. |
| `429 Too Many Requests` | Cuota gratuita agotada. | Espera y reintenta; `ChatGoogle` ya reintenta dos veces. |
| `503 ... high demand` | Modelo temporalmente saturado. | Reintenta o cambia `GEMINI_MODEL`. |
| `404 ... no longer available to new users` | Modelo antiguo (por ejemplo `gemini-2.5-flash`). | Usa `gemini-3.5-flash-lite`. |
| `"existe": false` | El nombre no coincide o `OWNER` no es la autoridad correcta. | Revisa ambos valores en `.env`. |
| `bigint: Failed to load bindings` | Aviso inofensivo de `bigint-buffer` al no encontrar su binding nativo. | Ya se filtra en `src/silenciarAvisos.ts`; no afecta las consultas. |

## Seguridad y alcance

- El agente solo lee: la wallet es efímera (`Keypair.generate()`), no tiene fondos ni autoridad sobre el programa.
- La clave de Gemini vive solo en `agente/.env`, ignorado por Git. No la copies al repositorio ni al chat.
- Los importes son precios de venta o costos de servicio registrados on-chain; no son saldos de wallet ni facturación histórica.
