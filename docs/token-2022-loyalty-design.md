# Diseño de integración de fidelización con Token-2022

## Objetivo

Integrar un sistema de puntos de fidelización en MotoLedger utilizando el programa Solana existente y el estándar Token-2022. La implementación debe permitir configurar las reglas por concesionario, asociar de forma verificable una wallet con un cliente registrado, emitir puntos por ventas y consultar el saldo del comprador.

Este documento describe el diseño de implementación. No representa funcionalidades ya desplegadas ni evidencia de transacciones Devnet.

## Decisiones de arquitectura

### Ampliar el programa existente

Decidí ampliar el programa de MotoLedger en lugar de desplegar un programa independiente. La fidelización depende directamente de las cuentas `Concesionario`, `Cliente`, `Moto` y `Venta`; mantener la lógica en el mismo programa permite validar esas relaciones directamente y reduce la complejidad de integración.

Mantendré sin cambios el layout de las cuentas existentes. Añadiré nuevas instrucciones y cuentas PDA para las funciones de fidelización. Esto evita exigir una migración de las cuentas que ya existen en Devnet.

### Regla de puntos configurable por concesionario

La regla inicial será una cantidad fija de puntos por venta, configurable por el concesionario. El valor se almacenará on-chain como entero (`u64`) y el programa será responsable de aplicarlo. No usaré cálculos de punto flotante ni asumiré una moneda para el campo `precio_venta`, porque el modelo actual no define explícitamente una divisa ni sus decimales.

La configuración podrá actualizarse mediante una instrucción autorizada. Cada emisión registrará la cantidad aplicada para que un cambio posterior de configuración no altere el historial de ventas anteriores.

### Asociación entre cliente y wallet

La cuenta `Cliente` actual identifica al cliente mediante la wallet del concesionario que lo registró y su cédula. No almacena la wallet personal del comprador. Para no modificar su estructura, añadiré una cuenta PDA independiente que vincule el cliente con la wallet que acepta la asociación.

La vinculación requerirá una firma de la wallet del comprador. El programa comprobará la relación con la cuenta Cliente y evitará que una wallet o un cliente queden vinculados de forma ambigua.

### Registro de puntos por venta

Cada emisión tendrá una cuenta PDA derivada de la venta. Esta cuenta registrará la venta, el cliente, la wallet beneficiaria y la cantidad emitida. La existencia de esa PDA impedirá otorgar puntos dos veces por la misma venta.

La emisión se realizará junto con el registro de la venta en una misma transacción, de forma que ambas operaciones se confirmen o reviertan juntas. La implementación deberá validar en el programa que la venta corresponde al concesionario, cliente y motocicleta indicados.

## Token-2022

El activo de fidelización se implementará con el programa Token-2022, separado de los tokens SPL clásicos que ya aparecen en la demostración actual de la aplicación.

Criterios previstos:

- Un mint de puntos por concesionario.
- Cero decimales para representar puntos enteros.
- Extensión NonTransferable para impedir transferencias entre wallets.
- Metadatos asociados al mint mediante las extensiones compatibles de Token-2022.
- La PDA de configuración del programa controlará la autoridad de emisión mediante firmas PDA.
- El programa emitirá los puntos a la cuenta de tokens asociada a la wallet vinculada al cliente.

No añadiré PermanentDelegate por defecto. Los puntos no transferibles no requieren esa autoridad para el flujo básico de acumulación. Solo incorporaría un delegado permanente si implemento y justifico una función de recuperación o reversión que realmente lo necesite.

## Responsabilidades y validaciones

### Programa on-chain

El programa será la fuente de verdad para:

- Autorizar la configuración de puntos del concesionario.
- Validar la asociación firmada entre cliente y wallet.
- Verificar que la venta pertenece al concesionario y al cliente.
- Evitar una segunda emisión por la misma venta.
- Calcular/aplicar la cantidad configurada.
- Emitir tokens mediante CPI a Token-2022.

### Aplicación

La aplicación se encargará de:

- Preparar las instrucciones y las cuentas necesarias.
- Solicitar las firmas de las wallets correspondientes.
- Consultar las cuentas y balances on-chain.
- Mostrar el saldo y las transacciones verificables.
- Informar si un rechazo ocurrió en validación local, simulación o ejecución en la red.

La aplicación no decidirá la cantidad definitiva de puntos ni podrá emitirlos por su cuenta.

## Compatibilidad y despliegue

El repositorio contiene el código fuente de referencia en `programs/registro/src/lib.rs`, el IDL en `idl.json` y el cliente TypeScript generado por Codama en `app/lib/moto-ledger/generated`. El frontend consume el programa ya desplegado y no contiene actualmente un workspace Anchor completo para compilarlo.

Antes de desplegar la actualización debo confirmar el entorno de compilación utilizado para el programa original y que conservo su upgrade authority. La actualización del IDL y del cliente Codama se hará después de definir y validar las nuevas instrucciones del programa.

## Alcance que no se presupone

No se considerará implementada la recuperación de tokens mientras no exista una instrucción real que la ejecute. Tampoco se afirmará que hay emisión, consulta de saldo o transacciones Devnet hasta completar y verificar esas operaciones.
