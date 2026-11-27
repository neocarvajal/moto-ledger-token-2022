# MotoLedger

**Gestión de concesionarios, trazabilidad de motocicletas y fidelización con Solana y Token-2022.**

<p align="center">
  <img src="assets/moto-ledger-preview-.gif" alt="Dashboard de MotoLedger" width="100%">
</p>

> **Red:** Solana Devnet  
> **Programa:** `64dHKqRTBciEidqLJqCvTWEGWkR1QqyYDZgomMt9AWCj`  
> **Aplicación:** [moto-ledger-token-2022.vercel.app](https://moto-ledger-token-2022.vercel.app/)

## Prueba rápida en la aplicación desplegada (recomendada)

Para evaluar el proyecto **no necesitas clonar el repositorio ni configurar Node.js, Redis/Upstash o variables de entorno**. La aplicación ya está desplegada y esos servicios están configurados en el entorno de Vercel.

1. Abre **[MotoLedger – aplicación en vivo](https://moto-ledger-token-2022.vercel.app/)**.
2. Asegúrate de utilizar **Solana Devnet** en tu wallet y en la aplicación.
3. Conecta la wallet owner de un concesionario de prueba. Para probar como comprador, utiliza una segunda wallet distinta.
4. Sigue el [flujo de prueba de extremo a extremo](#flujo-de-prueba-de-extremo-a-extremo) descrito abajo.

**Qué necesitas:** un navegador compatible con una wallet Solana (por ejemplo, Solflare o Phantom), dos wallets para owner y comprador, y SOL de Devnet para pagar las transacciones. No compartas claves privadas ni frases semilla.

**Importante: las wallets owner y comprador tienen funciones distintas.** La aplicación desplegada utiliza el programa y los datos de **Devnet**, que son compartidos y persistentes, pero el dashboard carga los concesionarios registrados por la wallet conectada. Por eso, para explorar y administrar el concesionario de demostración debes conectar la **misma wallet owner** con la que fue registrado. Si conectas una wallet nueva o distinta que no haya registrado concesionarios, verás el mensaje **“No encontramos concesionarios para esta wallet”** y la opción de registrar uno nuevo. Esto no significa que los datos de Devnet hayan desaparecido: esa wallet simplemente no es la autoridad de los concesionarios existentes.

Utiliza una **segunda wallet distinta como comprador**. El comprador no necesita tener concesionarios ni registros propios en el dashboard: su wallet se conecta en el flujo de vinculación y firma las operaciones que le corresponden, como la vinculación y el canje. No uses la wallet del comprador para intentar administrar el concesionario.

Antes de crear registros, ventas o canjes con la wallet owner, revisa si el concesionario de demostración ya tiene motos disponibles, clientes y un programa de fidelización configurado. No registres datos duplicados ni vendas una moto que ya figure como vendida. Para el flujo completo de recompensa necesitarás dos motos disponibles y una wallet distinta para el comprador.

La URL pública utiliza la configuración de servidor ya provisionada para los flujos QR. El evaluador no necesita una cuenta propia de Upstash ni configurar Redis. Si la aplicación desplegada no está disponible temporalmente, o deseas ejecutar y modificar el proyecto en tu entorno, utiliza la instalación local que se documenta más adelante.

## Preparar datos de demostración

La aplicación incluye dos herramientas opcionales para acelerar las pruebas desde el dashboard. Ambas crean registros reales en **Solana Devnet**; no son datos ficticios guardados en el navegador.

### Precargar motocicletas

1. Conecta la wallet owner y selecciona el concesionario que vas a utilizar.
2. Abre el módulo **Motos**.
3. Comprueba que el concesionario tenga configurada su garantía.
4. Pulsa **Precargar 3 motos** y aprueba las transacciones que solicite la wallet.
5. Espera a que finalice la operación y revisa el inventario del concesionario.

La precarga utiliza un catálogo de demostración según el nombre del concesionario: Motos Toro incluye TORO FOX TR180, CYCLONE RT3S y ASIAWING NC250E; BERA incluye COBRA 150, MILLAN 150 y SBR 150. Consulta primero las motos que ya existen en la cadena y omite los modelos repetidos para ese concesionario. Cada moto y su garantía se crean mediante una transacción independiente que debe firmar el owner. Si el concesionario no coincide con uno de esos catálogos, puedes registrar motos manualmente.

### Precargar clientes

1. Mantén seleccionado el concesionario correspondiente y abre el módulo **Clientes**.
2. En la sección **Registrar cliente**, pulsa **Precargar 3 clientes**.
3. Aprueba las transacciones que solicite la wallet.
4. Al finalizar, actualiza el directorio y comprueba que los clientes aparecen asociados al concesionario seleccionado.

Se crean tres perfiles de demostración con nombres y cédulas sintéticas. La herramienta genera identificadores de prueba diferenciados por concesionario, consulta las cuentas on-chain y evita duplicar los clientes que ya estén asociados allí. Cada cliente se registra en su propia transacción.

**Importante sobre la identidad de clientes:** la cuenta Cliente es global para la wallet owner y la cédula, mientras que la asociación con un concesionario es independiente. La precarga no reutiliza automáticamente una identidad que ya exista en otro concesionario. Si una misma persona debe estar registrada en varios concesionarios, búscala por cédula y realiza manualmente su asociación desde cada concesionario. Para datos reales, utiliza siempre el formulario de registro manual y la cédula correcta.

## Integración de recompensas con Token-2022

MotoLedger es un proyecto propio al que incorporé un sistema de fidelización conectado con las ventas reales de cada concesionario. Cada concesionario configura su propio mint de puntos bajo **Token-2022**. Los puntos son unidades enteras (0 decimales) y el mint utiliza la extensión **NonTransferable**, por lo que no se pueden transferir entre wallets.

### Flujo de prueba de extremo a extremo

Para reproducir el recorrido completo utiliza la **misma wallet owner que registró el concesionario** (con SOL de Devnet), una wallet distinta para el comprador y al menos **dos motos disponibles** en el mismo concesionario. Si conectas una wallet sin concesionarios registrados, el selector aparecerá vacío; eso es el comportamiento esperado porque la aplicación muestra los concesionarios asociados a la wallet conectada. Vuelve a conectar la wallet owner para administrar los registros existentes. La wallet del comprador no necesita tener concesionarios ni datos propios en el dashboard. Una moto solo puede venderse una vez.

1. **Conectar y seleccionar el concesionario.** Abre la aplicación en Devnet, conecta la wallet que administra el concesionario y selecciona el concesionario que tiene configurado el programa de fidelización. Si aún no existe, regístralo.
2. **Preparar inventario.** En el módulo **Motos**, registra al menos dos motocicletas disponibles manualmente o utiliza el botón opcional **Precargar 3 motos**. La precarga selecciona un pequeño catálogo de demostración según el nombre del concesionario (actualmente Motos Toro y BERA), consulta el inventario on-chain y omite modelos que ya estén registrados para ese concesionario. Para Motos Toro incluye TORO FOX TR180, CYCLONE RT3S y ASIAWING NC250E; para BERA incluye COBRA 150, MILLAN 150 y SBR 150. Cada unidad crea su cuenta de moto y garantía en una transacción que requiere firma. El concesionario debe tener configurada su garantía. Si el nombre no coincide con un catálogo disponible, el botón no inventa marcas: puedes continuar con el registro manual.
3. **Registrar el cliente.** En **Clientes**, selecciona el concesionario y registra nombre y cédula manualmente, o utiliza **Precargar 3 clientes** para crear datos sintéticos de demostración asociados a ese concesionario. La precarga deriva cédulas de prueba distintas según la dirección del concesionario, consulta las cuentas on-chain antes de crear cada registro y es idempotente: si ya existen los clientes precargados, no los duplica. La identidad Cliente es global para la wallet owner y la cédula; una PDA `AsociacionCliente` vincula esa identidad con un concesionario. Por seguridad, la precarga nunca toma un cliente global ya existente para asociarlo automáticamente a otro concesionario. Si necesitas que la misma persona esté registrada en varios concesionarios, búscala por cédula y realiza el registro/asociación manual desde cada concesionario. Solo clientes asociados pueden seleccionarse en Ventas.
4. **Primera venta.** En **Ventas**, selecciona la primera moto disponible y el cliente, introduce el precio y confirma. Esta compra habilita la vinculación de wallet. Si el comprador todavía no tiene wallet vinculada, la venta se registra sin recompensa.
5. **Vincular la wallet.** Regresa a **Clientes**, selecciona/busca el mismo cliente y genera el QR. El comprador abre el enlace en un navegador compatible con su wallet, conecta su wallet y firma; el owner también autoriza desde el dashboard. El programa exige ambas firmas y valida que el cliente ya tenga al menos una moto comprada. El QR es de un solo uso y expira a los cinco minutos.
6. **Segunda venta con recompensa.** Vuelve a **Ventas**, selecciona la segunda moto y el mismo cliente. Si existe wallet vinculada y el concesionario tiene un programa activo, la aplicación prepara una única transacción con: creación idempotente de la ATA Token-2022, `registrar_venta` y `otorgar_puntos`. Es atómica: si falla una instrucción, no se confirma ninguna. La cantidad se toma de la configuración on-chain `ProgramaFidelidad.puntos_por_venta`.
7. **Consultar saldo.** En **Clientes**, selecciona el comprador. La ficha consulta `WalletCliente`, deriva la ATA con el programa Token-2022 y obtiene el saldo directamente desde RPC. No se usa un saldo local como fuente de verdad.
8. **Canjear puntos.** Abre el módulo de **Fidelización / Canje**, selecciona cliente, una de sus ventas, un servicio y el kilometraje actual. El owner inicia el canje y genera un QR; el comprador escanea y firma desde su wallet vinculada. Cuando están ambas firmas, la aplicación envía la transacción. El programa valida cliente, wallet, venta, moto, concesionario, garantía, servicio activo y saldo; después quema los puntos mediante Token-2022 y crea un recibo on-chain `CanjeServicio`.

### Videos demostrativos

Los siguientes videos muestran los dos procesos que requieren la interacción coordinada entre el dashboard y la wallet del comprador. Los enlaces se pueden completar cuando los videos estén publicados.

**1. Vinculación de la wallet del cliente**

Muestra el flujo completo desde el dashboard del concesionario y el dispositivo móvil: generar el QR, abrir el enlace, conectar la wallet del comprador, firmar la solicitud desde el móvil y completar la autorización del owner.

<!-- Sustituir el marcador por el enlace del video de vinculación de wallet. -->
**Video:** [Agregar aquí el enlace del video de vinculación de wallet]

**2. Reclamo de servicios y quema de puntos**

Muestra el proceso de canje de un servicio: seleccionar cliente, venta y servicio desde el dashboard, indicar el kilometraje, generar y escanear el QR, firmar desde la wallet del comprador y completar la operación. La demostración incluye la quema de los tokens Token-2022 y el registro del canje en Solana.

<!-- Sustituir el marcador por el enlace del video de canje y quema de tokens. -->
**Video:** [Agregar aquí el enlace del video de reclamo de servicios y quema de tokens]

**Importante:** la primera venta habilita la vinculación, pero no genera puntos si aún no existe wallet vinculada. La segunda venta debe usar otra moto. El concesionario debe tener su mint y programa de fidelización configurados antes de intentar emitir recompensas.

### Catálogo inicial

Al inicializar el catálogo de un concesionario, el programa crea estos servicios:

| Servicio | Coste |
| --- | ---: |
| Ajuste de frenos | 60 puntos |
| Cambio de aceite | 80 puntos |
| Revisión general | 120 puntos |
| Mantenimiento preventivo | 150 puntos |

Con 200 puntos por venta, por ejemplo, un cliente podría canjear un cambio de aceite y un ajuste de frenos, si cumple las demás condiciones del programa.

## Configuración del mint y las instrucciones

Desde la sección de fidelización, el owner carga la metadata y crea el mint Token-2022. El mint se configura con 0 decimales, extensión `NonTransferable`, Metadata Pointer y Token Metadata. Su mint authority es la PDA `autoridad_fidelidad` derivada por el programa para el concesionario.

La instrucción `configurar_programa_fidelidad` comprueba que el token program sea Token-2022, que el mint tenga cero decimales, que incluya `NonTransferable` y que la mint authority sea la PDA esperada. `actualizar_puntos_fidelidad` permite al owner cambiar la cantidad fija por venta (debe ser mayor que cero).

| Instrucción | Responsabilidad |
| --- | --- |
| `configurar_programa_fidelidad` | Registra el mint y los puntos por venta; valida token program, decimales, extensión y autoridad. |
| `actualizar_puntos_fidelidad` | Actualiza la recompensa fija por venta. |
| `vincular_wallet_cliente` | Vincula la wallet del comprador después de una compra; requiere owner y comprador. |
| `desvincular_wallet_cliente` | Elimina el vínculo sin borrar identidad ni historial del cliente. |
| `otorgar_puntos` | Emite puntos mediante CPI a Token-2022 y crea un recibo `PuntosVenta`. |
| `inicializar_catalogo_servicios` | Crea el catálogo inicial de canjes. |
| `actualizar_servicio_catalogo` | Modifica los datos o disponibilidad de un servicio. |
| `canjear_servicio` | Valida el canje, quema puntos mediante Token-2022 y crea `CanjeServicio`. |

## Qué valida la red y qué hace la aplicación

**Validaciones on-chain (programa y Token-2022):**

- El owner debe ser propietario del concesionario y firmar las instrucciones que lo requieren.
- El cliente debe pertenecer al owner y tener una asociación activa con el concesionario.
- La wallet vinculada debe firmar; el programa exige que el cliente ya haya comprado al menos una moto.
- La venta usada para emitir puntos debe corresponder al mismo concesionario y cliente.
- El mint debe ser el configurado para ese concesionario, pertenecer a Token-2022, tener 0 decimales y usar la PDA de fidelización como mint authority.
- `PuntosVenta` es una PDA derivada de la venta: su inicialización impide emitir una segunda recompensa por la misma venta.
- Para canjear, el programa valida cliente, wallet, venta, moto, garantía, servicio activo y saldo. El comprador firma como autoridad de su cuenta de tokens para autorizar el burn.
- La quema y el recibo del canje ocurren en una transacción atómica; si falla una validación o el CPI, Solana revierte los cambios de esa transacción.

**Responsabilidades de la aplicación:**

- Presenta formularios, selecciona cuentas, deriva PDAs/ATAs, prepara instrucciones y coordina firmas.
- Consulta el saldo Token-2022 mediante RPC; no mantiene un saldo paralelo.
- Presenta la cantidad configurada y el coste del servicio. El programa vuelve a leer y validar esos valores desde las cuentas on-chain.
- Coordina temporalmente los QR; un QR no sustituye las firmas ni las validaciones de la red.

**Datos que se conservan:**

- `Venta`: relación entre concesionario, cliente y moto, además de fecha y precio.
- `PuntosVenta`: venta, cliente, wallet receptora, cantidad y fecha de emisión. No guarda una copia del saldo acumulado ni una conversión monetaria.
- El saldo agregado vive en la cuenta de tokens Token-2022 del comprador.
- `CanjeServicio`: concesionario, catálogo, cliente, wallet, mint, venta, moto, kilometraje, servicio, puntos quemados, fecha e identificador del canje.
- El precio de venta no determina la recompensa. No se almacena una tasa de cambio entre precio y puntos; la recompensa es fija por concesionario.

## Autoridades y limitaciones

- **Owner del concesionario:** administra el programa y actualiza los puntos por venta.
- **PDA `autoridad_fidelidad`:** mint authority; firma el CPI `MintTo` mediante las seeds del programa. No existe una clave privada exportable para esta PDA.
- **Wallet del comprador:** autoridad de su cuenta de tokens; firma el canje para autorizar el burn.
- **Token-2022:** valida las operaciones del mint y de las cuentas de tokens, incluida la restricción de no transferencia.

Esta entrega **no implementa `PermanentDelegate`, recuperación administrativa de tokens ni reversión de recompensas por anulación de ventas**. Tampoco incluye NFT. No debe afirmarse que existe recuperación privilegiada de puntos: los tokens son no transferibles y el canje los quema con autorización del comprador.

## Rechazos y cómo reportarlos

Al probar una operación inválida, identifica la capa exacta:

1. **Validación local:** la interfaz bloquea datos incorrectos antes de construir/enviar la transacción. No hay firma on-chain.
2. **Simulación / preflight:** el RPC devuelve un error durante la simulación. No debe reportarse como transacción fallida confirmada en la red.
3. **Ejecución on-chain:** existe una firma y Solana Explorer/RPC muestra `meta.err` distinto de `null`. Incluye la firma y el error del programa.

Un caso negativo relevante es intentar canjear un servicio cuyo coste supere el saldo. El programa exige `token_account.amount >= puntos` y devuelve `SaldoInsuficiente` si no se cumple. También valida que el servicio exista y esté activo, y que las cuentas de venta, moto y garantía correspondan al mismo contexto. No describas un rechazo como on-chain si solo lo bloqueó la interfaz o la simulación.

## Evidencias de Devnet

Las siguientes direcciones y firmas corresponden a datos compartidos durante las pruebas. Las firmas se incluyen solo cuando se conoce qué operación representan.

| Evidencia | Dirección / firma | Alcance comprobado |
| --- | --- | --- |
| Programa MotoLedger | `64dHKqRTBciEidqLJqCvTWEGWkR1QqyYDZgomMt9AWCj` | Programa desplegado en Devnet. |
| Mint Token-2022 MTTR | `Bd4QqZEnVDRLMrTjgwVo2RRW9GZwTao9w7UKGhqtNAPF` | Mint mostrado por el dashboard como **MOTOS TORO REWARDS (MTTR)**; la configuración visible indicaba 200 puntos por venta. |
| PDA de concesionario mostrada con ese programa | `8WQjh7p1vmnPRVicWVvS5gXxZmibd5YfTfmkGRwufYKS` | Dirección mostrada durante la revisión de la configuración. |
| Registro de Juan Perez | [`4hCUGJUJFynExwZY323trz2aSYGnvgyxNhwqB6iqHpVNPARQrTtR8Ncpz6k7Gjd1UCjKg6r4S9bkdRvz2Xohc5pS`](https://explorer.solana.com/tx/4hCUGJUJFynExwZY323trz2aSYGnvgyxNhwqB6iqHpVNPARQrTtR8Ncpz6k7Gjd1UCjKg6r4S9bkdRvz2Xohc5pS?cluster=devnet) | Transacción confirmada de `RegistrarCliente`; logs: BERA MOTORS, Juan Perez y su PDA de cliente. **No es una transacción de emisión de puntos.** |

**Evidencias de fidelización que aún deben adjuntarse para cerrar la demostración:** firma de creación/configuración del mint, firma de una venta con recompensa, consulta verificable del saldo de la ATA, firma de un canje con burn y evidencia de una operación inválida. Si el rechazo ocurre en validación local o simulación, se debe indicar esa capa y adjuntar el mensaje; no inventar una firma.

- [Mint MTTR en Solana Explorer](https://explorer.solana.com/address/Bd4QqZEnVDRLMrTjgwVo2RRW9GZwTao9w7UKGhqtNAPF?cluster=devnet)
- [Programa MotoLedger en Solana Explorer](https://explorer.solana.com/address/64dHKqRTBciEidqLJqCvTWEGWkR1QqyYDZgomMt9AWCj?cluster=devnet)

## Requisitos e instalación

- Node.js **24 o superior** y npm.
- Wallet compatible con Solana, como Solflare o Phantom.
- SOL de Devnet para el owner y las wallets que deban pagar rent/fees.
- Acceso a Solana Devnet.

```bash
git clone https://github.com/neocarvajal/moto-ledger-token-2022.git
cd moto-ledger-token-2022
npm install
```

Crea `.env.local` para la URL pública y el almacenamiento temporal de las sesiones QR:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
UPSTASH_REDIS_REST_URL=https://<tu-base-de-datos>.upstash.io
UPSTASH_REDIS_REST_TOKEN=<tu-token-rest>
```

Configura Upstash Redis para el intercambio temporal entre el dashboard y el teléfono. Mantén el token como secreto del servidor; nunca uses el prefijo `NEXT_PUBLIC_` para secretos. Para escanear QR desde un teléfono, la aplicación debe ser accesible mediante HTTPS público. Establece `NEXT_PUBLIC_APP_URL` con esa URL y reinicia Next.js después de cambiarla. Las sesiones QR expiran a los cinco minutos.

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000), conecta el owner y selecciona **Devnet**. Puedes obtener SOL desde el [faucet oficial](https://faucet.solana.com/).

## Arquitectura y cuentas on-chain

| Capa | Tecnología |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript |
| Estilos | Tailwind CSS v4 |
| Blockchain | Solana Devnet |
| Cliente Solana | `@solana/kit` |
| Token | `@solana-program/token-2022` |
| Cliente del programa | Codama |
| Almacenamiento efímero QR | Upstash Redis |
| Metadata del token | Pinata / IPFS |

Cuentas de la integración: `ProgramaFidelidad` (concesionario, mint y puntos por venta), `WalletCliente` (cliente-wallet), `PuntosVenta` (recibo único por venta), `CatalogoServicios` (catálogo y coste), `CanjeServicio` (recibo de quema) y `AsociacionCliente` (relación cliente-concesionario).

Las PDAs se derivan con semillas determinísticas en el programa y en `app/lib/moto-ledger/pdas.ts`. El frontend consulta las cuentas desde RPC; los datos on-chain no dependen de localStorage.

## Pruebas automatizadas

```bash
npm run test
npm run typecheck
npm run lint
npm run build
```

Las pruebas de integración Devnet existentes son de solo lectura: verifican que el programa desplegado y la PDA del registro global puedan consultarse y decodificarse. No crean mints, ventas ni recompensas.

macOS/Linux:
```bash
MOTO_LEDGER_DEVNET_RPC_URL=https://api.devnet.solana.com npm run test:devnet
```

PowerShell:
```powershell
$env:MOTO_LEDGER_DEVNET_RPC_URL="https://api.devnet.solana.com"
npm run test:devnet
```

## Migración de asociaciones de clientes existentes

`scripts/migrate-customer-associations.mjs` es una utilidad para instalaciones antiguas que tenían clientes globales sin una PDA por relación cliente/concesionario. Reconstruye relaciones a partir de ventas y acepta un mapeo manual verificado. Por defecto ejecuta un **dry run**; solo crea asociaciones con `--execute`.

La migración histórica de esta instalación Devnet ya se completó: se crearon cinco asociaciones y una ejecución posterior de dry run confirmó cinco existentes, cero pendientes y cero errores. No es necesario repetirla.

## Scripts

```bash
npm run dev          # Servidor local
npm run build        # Compilación de producción
npm run start        # Servidor de producción
npm run typecheck    # Verificación TypeScript
npm run lint         # ESLint
npm run test         # Pruebas unitarias y de interfaz
npm run test:devnet  # Pruebas Devnet de solo lectura
npm run ci           # Build, typecheck, lint, formato y tests
```

## Seguridad

- Nunca incluyas claves privadas, keypairs JSON, frases semilla ni tokens de Upstash/Pinata en el repositorio, README, capturas o evidencias.
- Los QR usan tokens aleatorios temporales; no contienen la cédula ni el nombre del cliente.
- El QR coordina firmas, pero no firma por el usuario. Las firmas requeridas deben autorizarse en las wallets.
- La red y el programa son la fuente de verdad para emisión, saldo y canje.
