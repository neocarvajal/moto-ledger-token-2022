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

**Qué necesitas:** un navegador compatible con una wallet Solana (por ejemplo, Solflare o Phantom), dos wallets (owner y comprador), y SOL de Devnet para las transacciones que deban pagar comisiones. Es recomendable tener el dashboard abierto en un equipo y utilizar el teléfono para abrir los QR como comprador. No compartas claves privadas ni frases semilla.

> [!IMPORTANT]
> **Las wallets owner y comprador tienen funciones distintas.** El dashboard carga los concesionarios registrados por la wallet conectada. Para explorar y administrar el concesionario de demostración, conecta la **misma wallet owner** con la que fue creado. Si conectas una wallet nueva que no haya registrado concesionarios, verás **“No encontramos concesionarios para esta wallet”**. Esto es esperado: los datos siguen en Devnet, pero esa wallet no es la autoridad de esos concesionarios.
>
> | Wallet | Dónde se utiliza | Qué hace |
> | --- | --- | --- |
> | **Owner** | Dashboard de MotoLedger | Administra el concesionario, registra ventas y genera los QR. Debe permanecer conectada durante el proceso. |
> | **Comprador** | Ventana, pestaña o dispositivo aparte al abrir el QR | Conecta su wallet para firmar la vinculación y el canje. No necesita concesionarios ni registros propios en el dashboard. |
>
> **No necesitas desconectar la wallet owner para utilizar la wallet del comprador.** Al generar un QR desde el dashboard, abre su enlace en el móvil o en otra ventana/pestaña del navegador y conecta allí la wallet del comprador. La sesión del dashboard permanece abierta con el owner conectado.


## Organización del dashboard

El dashboard comienza en **Configuración**, que concentra el registro y la selección de concesionarios, junto con la política de garantía de cada uno. Una vez preparado el concesionario, el trabajo operativo se distribuye en este orden:

1. **Configuración:** registrar o seleccionar el concesionario y establecer la duración y el kilometraje máximo de garantía.
2. **Inventario:** registrar motos o precargar el catálogo de demostración.
3. **Clientes:** registrar o precargar clientes y administrar sus asociaciones con el concesionario.
4. **Ventas:** registrar las ventas utilizando motos disponibles y clientes registrados.
5. **Fidelización:** configurar el programa Token-2022, consultar recompensas y gestionar canjes.
6. **Servicios:** administrar el catálogo y los trabajos de posventa.

El registro de concesionarios solo se realiza desde **Configuración**. Los demás módulos conservan el selector del concesionario; si la wallet conectada no tiene uno registrado, muestran un acceso a Configuración en lugar de repetir el formulario. Si la garantía todavía no está configurada, el estado on-chain lo indica y ofrece ir directamente a su configuración antes de registrar motos.

## Preparar datos de demostración

La aplicación incluye herramientas opcionales para configurar la cobertura de posventa y acelerar las pruebas desde el dashboard. Los cambios de configuración y los registros se guardan en **Solana Devnet**; no son datos ficticios guardados en el navegador.

### Configurar la garantía de cada concesionario

Cada concesionario mantiene su propia política de garantía. La wallet owner puede consultar y actualizar estos parámetros desde el módulo **Configuración**:

1. Conecta la wallet owner y selecciona el concesionario que deseas administrar.
2. Abre **Configuración** en el menú del dashboard.
3. En la sección **Configuración de garantía**, define:
   - **Duración de garantía:** cantidad de días de cobertura (entero entre 1 y 65.535).
   - **Kilometraje máximo cubierto:** límite de kilometraje (entero positivo, sin decimales).
4. Pulsa **Guardar configuración** y aprueba la transacción con la wallet owner.
5. Espera la confirmación en Solana. El dashboard actualizará los valores que muestra para ese concesionario.

La configuración se almacena on-chain en la cuenta del concesionario y requiere la firma de su owner. Si administras varios concesionarios, selecciona cada uno y configura sus parámetros por separado. Los valores actuales se muestran en **Estado on-chain**.

> [!IMPORTANT]
> **La política se aplica a las próximas motos que registres.** Cambiar los días o el kilometraje no modifica retroactivamente las cuentas de garantía de las motos que ya estaban registradas; esas garantías conservan los parámetros con los que fueron creadas. Configura la cobertura antes de registrar o precargar el inventario de demostración.

La garantía de posventa es independiente del programa de puntos Token-2022: el vencimiento de la garantía no elimina ni invalida los puntos que el cliente haya acumulado. Las reglas de canje de puntos se validan por separado.

### Precargar motocicletas

1. Conecta la wallet owner y selecciona el concesionario que vas a utilizar.
2. Abre el módulo **Motos**.
3. Comprueba que el concesionario tenga configurada su garantía.
4. Pulsa **Precargar 3 motos** y aprueba las transacciones que solicite la wallet.
5. Espera a que finalice la operación y revisa el inventario del concesionario.

La precarga utiliza un único grupo genérico de tres motos (HONDA XR 150L, YAMAHA FZ 2.0 y SUZUKI GN 125), sin depender del nombre ni de la marca del concesionario. Este catálogo compartido solo puede cargarse una vez entre los concesionarios de una misma wallet owner: si alguna de esas motos ya está registrada en otro concesionario de esa wallet, la precarga se bloquea para evitar duplicar el grupo. Los registros de otros usuarios de Devnet no afectan la precarga. En el mismo concesionario, las unidades ya creadas se omiten al reintentar. Para que otro concesionario de la misma wallet tenga motos iguales o distintas, regístralas manualmente. Cada moto y su garantía se crean mediante una transacción independiente que debe firmar el owner.

### Precargar clientes

1. Mantén seleccionado el concesionario correspondiente y abre el módulo **Clientes**.
2. En la sección **Registrar cliente**, pulsa **Precargar 3 clientes**.
3. Aprueba las transacciones que solicite la wallet.
4. Al finalizar, actualiza el directorio y comprueba que los clientes aparecen asociados al concesionario seleccionado.

Se crean tres perfiles de demostración con nombres y cédulas sintéticas. La herramienta genera identificadores de prueba diferenciados por concesionario, consulta las cuentas on-chain y evita duplicar los clientes que ya estén asociados allí. Cada cliente se registra en su propia transacción.

> [!IMPORTANT]
> **Identidad de clientes:** la cuenta Cliente es global para la wallet owner y la cédula, mientras que la asociación con un concesionario es independiente. La precarga no reutiliza automáticamente una identidad que ya exista en otro concesionario. Si una misma persona debe estar registrada en varios concesionarios, búscala por cédula y realiza manualmente su asociación desde cada concesionario. Para datos reales, utiliza siempre el formulario de registro manual y la cédula correcta.

## Integración de recompensas con Token-2022

MotoLedger es un proyecto propio al que incorporé un sistema de fidelización conectado con las ventas reales de cada concesionario. Cada concesionario configura su propio mint de puntos bajo **Token-2022**. Los puntos son unidades enteras (0 decimales) y el mint utiliza la extensión **NonTransferable**, por lo que no se pueden transferir entre wallets.

### Flujo de prueba de extremo a extremo

> [!TIP]
> **Preparación de wallets:** conecta en el dashboard la misma wallet owner que registró el concesionario y mantenla conectada durante toda la prueba. Utiliza una segunda wallet como comprador, pero ábrela únicamente desde el enlace QR en otra pestaña, ventana o dispositivo (por ejemplo, un teléfono). Así puedes completar las firmas del comprador **sin desconectar ni cambiar la wallet owner del dashboard**.
>
> Si conectas una wallet distinta directamente al dashboard y no tiene concesionarios registrados, el selector aparecerá vacío. Vuelve a conectar la wallet owner para administrar los registros. La wallet del comprador no necesita concesionarios ni datos propios en el dashboard.
>
> **Antes de comenzar:** confirma que hay al menos **dos motos disponibles** en el mismo concesionario. Cada moto solo puede venderse una vez.

1. **Conectar y seleccionar el concesionario.** Abre la aplicación en Devnet, conecta la wallet que administra el concesionario y selecciona el concesionario que tiene configurado el programa de fidelización. Si aún no existe, regístralo.
2. **Preparar inventario.** En el módulo **Inventario**, registra al menos dos motos disponibles manualmente o utiliza el botón opcional **Precargar 3 motos**. La precarga ofrece un catálogo genérico (HONDA XR 150L, YAMAHA FZ 2.0 y SUZUKI GN 125), independiente del nombre y la marca del concesionario. El catálogo compartido solo puede cargarse una vez entre los concesionarios de la misma wallet owner; los registros de otros usuarios de Devnet no afectan esta validación. Si ya existe en otro concesionario de esa wallet, no se vuelve a cargar y las motos de los demás concesionarios deben registrarse manualmente. Si se reintenta en el concesionario que ya lo recibió, se omiten las unidades existentes. Cada unidad crea su cuenta de moto y garantía en una transacción que requiere firma. El concesionario debe tener configurada su garantía.
3. **Registrar el cliente.** En **Clientes**, selecciona el concesionario y registra nombre y cédula manualmente, o utiliza **Precargar 3 clientes** para crear datos sintéticos de demostración asociados a ese concesionario. La precarga deriva cédulas de prueba distintas según la dirección del concesionario, consulta las cuentas on-chain antes de crear cada registro y es idempotente: si ya existen los clientes precargados, no los duplica. La identidad Cliente es global para la wallet owner y la cédula; una PDA `AsociacionCliente` vincula esa identidad con un concesionario. Por seguridad, la precarga nunca toma un cliente global ya existente para asociarlo automáticamente a otro concesionario. Si necesitas que la misma persona esté registrada en varios concesionarios, búscala por cédula y realiza el registro/asociación manual desde cada concesionario. Solo clientes asociados pueden seleccionarse en Ventas.
4. **Primera venta.** En **Ventas**, selecciona la primera moto disponible y el cliente, introduce el precio y confirma. Esta compra habilita la vinculación de wallet. Si el comprador todavía no tiene wallet vinculada, la venta se registra sin recompensa.
5. **Vincular la wallet del comprador.** En el dashboard (que permanece conectado con la wallet owner), regresa a **Clientes**, selecciona el mismo cliente y genera el QR. Desde el teléfono del comprador —o desde otra pestaña/ventana del navegador— escanea el QR y abre el enlace. Allí conecta la wallet del comprador y firma la solicitud. Mientras tanto, el owner continúa en el dashboard y completa su autorización. **No desconectes la wallet owner ni la reemplaces por la del comprador.** El programa exige ambas firmas y valida que el cliente ya tenga al menos una moto comprada. El QR es de un solo uso y expira a los cinco minutos.
6. **Segunda venta con recompensa.** Vuelve a **Ventas**, selecciona la segunda moto y el mismo cliente. Si existe wallet vinculada y el concesionario tiene un programa activo, la aplicación prepara una única transacción con: creación idempotente de la ATA Token-2022, `registrar_venta` y `otorgar_puntos`. Es atómica: si falla una instrucción, no se confirma ninguna. La cantidad se toma de la configuración on-chain `ProgramaFidelidad.puntos_por_venta`.
7. **Consultar saldo.** En **Clientes**, selecciona el comprador. La ficha consulta `WalletCliente`, deriva la ATA con el programa Token-2022 y obtiene el saldo directamente desde RPC. No se usa un saldo local como fuente de verdad.
8. **Canjear puntos y quemar tokens.** En el dashboard del owner, abre **Fidelización / Canje**, selecciona cliente, una de sus ventas, un servicio y el kilometraje actual. El owner inicia el canje y genera un QR. El comprador abre ese QR desde el mismo teléfono/ventana que utiliza para su wallet (o desde otro dispositivo), conecta la wallet vinculada y firma. El owner permanece conectado en el dashboard y completa la autorización desde allí. Una vez reunidas ambas firmas, la aplicación envía la transacción. El programa valida cliente, wallet, venta, moto, concesionario, garantía, servicio activo y saldo; después quema los puntos mediante Token-2022 y crea un recibo on-chain `CanjeServicio`.

### Videos demostrativos

> [!NOTE]
> En ambos videos, el dashboard permanece abierto con la **wallet owner** conectada. La wallet del comprador se utiliza desde el teléfono o desde otra pestaña/ventana al abrir el enlace QR; no hace falta desconectar el owner.

Los siguientes videos muestran la interacción coordinada entre el dashboard y la wallet del comprador. Añade los enlaces cuando los videos estén publicados.

**1. Vinculación de la wallet del cliente**

Muestra el flujo desde el dashboard del concesionario (wallet owner conectada) y el teléfono del comprador: generar el QR, abrir el enlace en el móvil, conectar la wallet del comprador, firmar la solicitud y completar la autorización del owner sin cerrar la sesión del dashboard.

<!-- Sustituir el marcador por el enlace del video de vinculación de wallet. -->
**Video:** [Agregar aquí el enlace del video de vinculación de wallet]

**2. Reclamo de servicios y quema de puntos**

Muestra el proceso de canje de un servicio: seleccionar cliente, venta y servicio desde el dashboard owner, indicar el kilometraje, generar y escanear el QR, abrirlo en el teléfono/ventana del comprador y firmar con su wallet. El owner permanece conectado y completa su parte desde el dashboard. La demostración incluye la quema de los tokens Token-2022 y el registro del canje en Solana.

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

Para una instalación local, crea una base de datos en [Upstash Redis](https://console.upstash.com/) y configura sus credenciales REST. Consulta la [documentación oficial de Redis REST API](https://upstash.com/docs/redis/features/restapi) para obtener la URL y el token. Usa el **Standard REST Token** (no el Read-Only Token), o un usuario ACL personalizado que permita las operaciones de lectura y escritura que necesita la aplicación. Como mínimo, el usuario debe tener permitido el comando `SET`; si aparece `NOPERM` o `SET` está denegado, revisa sus permisos ACL. Para una regla ACL personalizada que permita las operaciones habituales de lectura y escritura sobre las claves, puedes partir de `+@read +set +del +expire ~*` y ajustarla según las restricciones de tu base de datos.

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
