# MotoLedger

**Gestión de concesionarios y trazabilidad de motocicletas sobre Solana.**

<p align="center">
  <img src="assets/moto-ledger-preview-.gif" alt="Demostración animada del dashboard de MotoLedger" width="100%">
</p>

MotoLedger es una dApp que permite a un concesionario administrar su operación desde un dashboard web y registrar información clave directamente en la blockchain. Cada concesionario, motocicleta, cliente, venta y servicio se representa mediante cuentas on-chain y direcciones determinísticas (PDA), lo que facilita consultar y verificar el historial de las operaciones.

> **Red actual:** Solana Devnet  
> **Programa:** `64dHKqRTBciEidqLJqCvTWEGWkR1QqyYDZgomMt9AWCj`  
> **Aplicación:** [moto-ledger-eta.vercel.app](https://moto-ledger-eta.vercel.app/)

## Ruta del proyecto y aporte propio

**Ruta elegida: proyecto propio.** MotoLedger parte de una propuesta propia para digitalizar la operación de un concesionario de motocicletas y aportar trazabilidad verificable mediante Solana. El propósito es centralizar la gestión del inventario, clientes, ventas y servicios, manteniendo en la blockchain los registros relevantes de cada operación.

El aporte propio comprende el diseño y desarrollo de la solución de extremo a extremo: definición del modelo de cuentas y PDAs, integración del programa desplegado en Solana Devnet, construcción de la interfaz web, conexión de wallets, generación e integración del cliente del programa con Codama, lectura y escritura de datos on-chain, y pruebas unitarias, de interfaz e integración. También se implementaron flujos de gestión para concesionarios, motocicletas, clientes, ventas y servicios, junto con la consulta de operaciones y sus enlaces de verificación.

## Funcionalidades

### Concesionarios
- Conectar una wallet compatible con Solana.
- Detectar automáticamente los concesionarios asociados a la wallet.
- Registrar y seleccionar varios concesionarios.
- Consultar sus datos, propietario, PDA y métricas on-chain.

### Inventario de motocicletas
- Registrar motocicletas con serial N.I.V., placa, marca, modelo y color.
- Crear la cuenta de la motocicleta y su cuenta de garantía asociada en la misma operación.
- Consultar el catálogo del concesionario.
- Eliminar motocicletas cuando cumplen las condiciones definidas por el programa.
- Actualizar el catálogo después de registrar o eliminar una motocicleta.

### Clientes y ventas
- Registrar clientes asociados a la wallet.
- Registrar ventas vinculando concesionario, cliente y motocicleta.
- Consultar el historial de ventas y abrir el detalle de cada operación.

### Posventa y servicios
- Registrar mantenimientos y reparaciones, incluso para motocicletas vendidas.
- Consultar el historial y el detalle de los servicios.
- Validar las condiciones de garantía cuando se registra un servicio de tipo garantía.

### Configuración y trazabilidad
- Consultar la identidad on-chain del concesionario.
- Configurar la duración y el kilometraje máximo de la cobertura para futuras motocicletas.
- Abrir las cuentas y transacciones en Solana Explorer.
- Recibir notificaciones persistentes con el enlace de la transacción confirmada.

**Nota sobre garantías:** la configuración de cobertura se aplica a las nuevas garantías creadas al registrar motocicletas; no modifica retroactivamente las cuentas existentes. El acceso al módulo de garantías permanece desactivado en la navegación mientras se completa esa funcionalidad.

## Arquitectura y tecnologías

| Capa | Tecnologías |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript |
| Estilos | Tailwind CSS v4 |
| Blockchain | Solana |
| Cliente Solana | `@solana/kit` v8 |
| Wallet | `@solana/kit-plugin-wallet`, `@solana/react` |
| RPC | `@solana/kit-plugin-rpc` |
| Cliente del programa | Codama, `@solana/program-client-core` |
| Notificaciones | Sonner |

La interfaz utiliza **Solana Kit y el cliente generado con Codama** para consultar cuentas, derivar PDAs, construir instrucciones y enviar transacciones firmadas por la wallet conectada. El frontend consume un programa ya desplegado; este repositorio no requiere un workspace local de Anchor para ejecutar la aplicación.

## Modelo on-chain

Las principales cuentas utilizadas por el programa son:

- **RegistroGlobal:** registro global del sistema.
- **Concesionario:** propietario, identidad comercial, contadores y política de garantía.
- **Moto:** datos de identificación de la motocicleta y contadores de posventa.
- **Garantía:** cobertura asociada a la motocicleta.
- **Cliente:** identidad del cliente y contador de motocicletas.
- **Venta:** relación entre concesionario, cliente y motocicleta, con fecha y precio.
- **Servicio:** historial de mantenimiento, reparación o servicio de garantía.
- **Reclamación:** estructura prevista para el flujo de reclamaciones de garantía.

Las cuentas se derivan mediante **Program Derived Addresses (PDA)**, utilizando semillas determinísticas definidas por el programa. La aplicación muestra direcciones relevantes y enlaces al explorador de Solana para facilitar la verificación.

## Requisitos

- Node.js **24 o superior**.
- npm.
- Una wallet compatible con Solana, por ejemplo Phantom o Solflare.
- SOL de Devnet para cubrir las comisiones de las transacciones.

## Ejecución local

Clona el repositorio e instala las dependencias:

```bash
git clone https://github.com/neocarvajal/moto-ledger.git
cd moto-ledger
npm install
```

Inicia el servidor de desarrollo:

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000), conecta tu wallet y selecciona la red Devnet desde el selector de cluster de la aplicación.

Puedes obtener SOL de prueba desde el [faucet oficial de Solana](https://faucet.solana.com/).

## Pruebas

Las pruebas unitarias y de interfaz se ejecutan sin conectarse a la blockchain:

```bash
npm run test
```

Las pruebas de integración de Devnet son **opt-in y de solo lectura**. Comprueban que el programa desplegado exista como cuenta ejecutable y que la PDA del registro global exista, pertenezca al programa y pueda decodificarse con el decoder generado por Codama. No firman ni envían transacciones y no requieren una wallet ni claves privadas.

En PowerShell:

```powershell
$env:MOTO_LEDGER_DEVNET_RPC_URL="https://api.devnet.solana.com"
npm run test:devnet
```

En macOS/Linux:

```bash
MOTO_LEDGER_DEVNET_RPC_URL=https://api.devnet.solana.com npm run test:devnet
```

Si no se configura `MOTO_LEDGER_DEVNET_RPC_URL`, la suite de integración queda omitida durante la ejecución normal de `npm run test`.

## Pruebas y evidencias

### Transacción verificable en Solana Devnet

La siguiente transacción corresponde al **registro de un cliente** desde MotoLedger. Puedes abrirla en Solana Explorer para consultar su estado, instrucciones, firma y detalles on-chain:

<p align="center">
  <a href="https://explorer.solana.com/tx/VXJqHCWf4Y5bPC7r9SWDFWSotY2HRkteiLtQJtrRPe7ussezbS88nWnRyV37zTEjiUzHseYpUreiTdHshh88Lpj?cluster=devnet" target="_blank" rel="noopener noreferrer">
    Ver transacción de registro de cliente en Solana Explorer
  </a>
</p>

### Cómo probar el proyecto

1. Instala las dependencias y ejecuta la aplicación siguiendo la sección [Ejecución local](#ejecución-local).
2. Abre la aplicación y conecta una wallet compatible con Solana que tenga SOL de prueba en Devnet.
3. Confirma que el selector de red esté configurado en **Devnet**.
4. Selecciona o registra un concesionario y prueba los módulos disponibles: inventario, clientes, ventas y servicios.
5. Al confirmar una operación on-chain, abre el enlace de transacción que muestra la aplicación o consulta la transacción de ejemplo enlazada arriba.
6. Ejecuta las pruebas automatizadas con `npm run test`. Para comprobar la integración de solo lectura con el programa desplegado, configura `MOTO_LEDGER_DEVNET_RPC_URL` y ejecuta `npm run test:devnet`, tal como se explica en la sección [Pruebas](#pruebas).

## Scripts

```bash
npm run dev          # Servidor local
npm run build        # Compilación de producción
npm run start        # Servidor de producción
npm run typecheck    # Verificación de TypeScript de la app (excluye agente/)
npm run typecheck:agente # Verificación del agente (requiere npm install en agente/)
npm run lint         # ESLint
npm run format       # Formatear con Prettier
npm run format:check # Comprobar formato
npm run test         # Pruebas unitarias y de interfaz
npm run test:devnet  # Pruebas de integración read-only contra Devnet
npm run ci           # Build, typecheck, lint, formato y tests
```

`agente/` es un proyecto Node independiente con sus propias dependencias. La compilación y el `typecheck` de la app (incluido el build en Vercel) no lo incluyen: instala sus dependencias con `cd agente && npm install` y verifícalo con `npm run typecheck:agente`.

## Alcance actual

MotoLedger se encuentra en desarrollo sobre Devnet. El dashboard integra la gestión de concesionarios, inventario, clientes, ventas, servicios y configuración de garantía. El módulo de reclamaciones y la gestión completa del ciclo de garantías están pendientes de implementación.

Las operaciones que modifican el estado se envían al programa desplegado y requieren firma de la wallet conectada. La disponibilidad de las funciones depende de las instrucciones implementadas por el programa on-chain.
