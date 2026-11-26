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

La vinculación requerirá dos firmas: la del concesionario que autoriza la asociación y la wallet del comprador que demuestra que controla la dirección que recibirá los puntos. El programa comprobará que el concesionario es el propietario de la cuenta Cliente y que todavía no existe una vinculación para ese cliente.

### Registro de puntos por venta

Cada emisión tendrá una cuenta PDA derivada de la venta. Esta cuenta registrará la venta, el cliente, la wallet beneficiaria y la cantidad emitida. La existencia de esa PDA impedirá otorgar puntos dos veces por la misma venta.

La emisión se realiza mediante la instrucción `otorgar_puntos`. Cuando el comprador ya tiene su wallet vinculada, esta instrucción debe incluirse en la misma transacción que `registrar_venta`, de modo que ambas operaciones se confirmen o reviertan juntas.

La primera compra tiene un flujo distinto: el cliente puede no tener todavía una wallet vinculada. En ese caso registro primero la venta; después, el comprador firma la vinculación de su wallet junto con el concesionario y, finalmente, el concesionario acredita los puntos de esa primera venta. La PDA `PuntosVenta` impide que esa recompensa se emita más de una vez. La validación on-chain exige que el cliente tenga al menos una compra registrada antes de permitir la vinculación. Los metadatos del mint quedan fuera de esta primera versión del programa.

## Token-2022

El activo de fidelización se implementará con el programa Token-2022, separado de los tokens SPL clásicos que ya aparecen en la demostración actual de la aplicación. El mint se crea desde el cliente antes de configurar el programa, porque su autoridad debe establecerse desde el inicio con la PDA del programa.

Criterios previstos:

- Un mint de puntos por concesionario.
- Cero decimales para representar puntos enteros.
- Extensión NonTransferable para impedir transferencias entre wallets.
- La autoridad de emisión será la PDA derivada de `["autoridad_fidelidad", concesionario]`; el cliente debe asignarla como mint authority al crear el mint.
- La instrucción de configuración comprueba que el mint pertenece a Token-2022, tiene cero decimales, usa esa PDA como mint authority y contiene la extensión `NonTransferable`.
- El programa emite los puntos mediante CPI a Token-2022.
- El programa emite los puntos a la cuenta de tokens asociada a la wallet vinculada al cliente.
- La extensión `NonTransferable` se inicializa antes de `InitializeMint`; la creación, inicialización de extensión e inicialización del mint deben prepararse en el orden exigido por Token-2022.

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
- Derivar las PDA de fidelización y las ATA usando explícitamente la dirección del programa Token-2022.
- Pasar `TOKEN_2022_PROGRAM_ADDRESS` de forma explícita a las instrucciones Codama `configurarProgramaFidelidad` y `otorgarPuntos`. Los clientes generados por programa pueden conservar por defecto la dirección del SPL Token clásico; no es necesario editar esos archivos generados para resolverlo.
- Calcular el tamaño del mint con las extensiones seleccionadas y solicitar el rent correspondiente; no asumir los 82 bytes del mint clásico.
- Solicitar las firmas de las wallets correspondientes.
- Consultar las cuentas y balances on-chain.
- Mostrar el saldo y las transacciones verificables.
- Informar si un rechazo ocurrió en validación local, simulación o ejecución en la red.

La aplicación no decidirá la cantidad definitiva de puntos ni podrá emitirlos por su cuenta.

## Compatibilidad y despliegue

El repositorio contiene el código fuente de referencia en `programs/registro/src/lib.rs`, el IDL en `idl.json` y el cliente TypeScript generado por Codama en `app/lib/moto-ledger/generated`. El frontend consume el programa ya desplegado y no contiene actualmente un workspace Anchor completo para compilarlo.

El código ahora importa `anchor-spl` con soporte para `token_2022` y usa sus interfaces de CPI. Antes de compilar debo habilitar esa dependencia y su feature correspondiente en el entorno de Solana Playground. Antes de desplegar la actualización debo confirmar el entorno de compilación utilizado para el programa original y que conservo su upgrade authority. La actualización del IDL y del cliente Codama se hará después de definir y validar las nuevas instrucciones del programa.

## Alcance que no se presupone

No se considerará implementada la recuperación de tokens mientras no exista una instrucción real que la ejecute. Tampoco se afirmará que hay emisión, consulta de saldo o transacciones Devnet hasta completar y verificar esas operaciones.


## Metadata del mint mediante IPFS

La imagen y el JSON descriptivo del programa de fidelización se almacenarán en IPFS mediante Pinata. El endpoint de Next.js `POST /api/ipfs/upload` realiza ambas subidas y devuelve `imageUri` y `metadataUri` con formato `ipfs://<CID>`. El JSON contiene `name`, `symbol`, `description` e `image`; la URI del JSON será la que se asocie a la extensión `TokenMetadata` del mint Token-2022.

La variable `PINATA_JWT` se configura en el entorno del servidor (por ejemplo, Vercel) y nunca debe exponerse mediante una variable `NEXT_PUBLIC_*`. La integración utiliza el SDK oficial `pinata` (PinataSDK), inicializado en un módulo server-only. También puede configurarse `NEXT_PUBLIC_GATEWAY_URL` con el dominio del gateway para resolver contenido desde la aplicación.

Antes de subir, el endpoint exige una firma Ed25519 de la wallet y verifica en la red seleccionada que la cuenta indicada sea una cuenta `Concesionario` del programa MotoLedger y que su campo `owner` coincida con la wallet firmante. El mensaje firmado tiene este formato exacto, con saltos de línea:

```text
MotoLedger IPFS metadata upload
wallet:<WALLET>
dealership:<PDA_CONCESIONARIO>
cluster:<devnet|mainnet-beta>
timestamp:<UNIX_MILLISECONDS>
nonce:<HEX_ALEATORIO>
```

El timestamp debe estar dentro de una ventana de cinco minutos y el nonce debe ser hexadecimal de 32 a 64 caracteres. El formulario debe enviar esos campos, la firma codificada en Base64 y el archivo bajo el campo `image`. Se aceptan imágenes PNG, JPEG y WEBP de hasta 5 MB. El endpoint devuelve error si falta `PINATA_JWT`, si la firma no es válida o si la wallet no es propietaria del concesionario.

La firma prueba el control de la wallet y la consulta RPC comprueba la propiedad on-chain; ninguna de las dos sustituye la validación de permisos que hace el programa al configurar el mint. La integración del formulario cliente y la inicialización de `MetadataPointer`/`TokenMetadata` en el mint son pasos separados: la subida IPFS por sí sola no crea ni modifica un token.


### Organización de archivos por concesionario en Pinata

Decidí utilizar los grupos de archivos de Pinata para mantener juntos los recursos IPFS de cada concesionario. La API del SDK para administrar estos grupos se expone bajo `pinata.groups.public`, mientras que el contenido se sube mediante `pinata.upload.public`. El grupo se identifica con un nombre determinista basado en la PDA: `MotoLedger-<PDA_CONCESIONARIO>`. Antes de crear uno nuevo, el servidor busca un grupo con ese nombre exacto y reutiliza su `id`; de esta manera no necesito una base de datos adicional para resolver el grupo en cada subida.

La imagen y el JSON de metadata se suben al mismo grupo público. Cada archivo incluye los siguientes `keyvalues` para facilitar su búsqueda y administración:

- `dealership`: PDA del concesionario.
- `cluster`: `devnet` o `mainnet-beta`.
- `category`: `loyalty-image` o `loyalty-token-metadata`.

El endpoint devuelve también `groupId`, además de los CID, las URI IPFS y los identificadores internos de archivo de Pinata (`imageFileId` y `metadataFileId`). Los identificadores internos permiten administrar o retirar archivos mediante la API de Pinata; no sustituyen al CID que se utiliza en la URI IPFS. Los grupos son una herramienta de organización y administración de Pinata; no crean carpetas dentro de IPFS ni modifican el contenido direccionado por los CID.

La búsqueda y creación del grupo se realiza en el servidor. Si dos primeras subidas del mismo concesionario ocurren simultáneamente, Pinata podría recibir dos intentos de creación antes de que cualquiera vea el grupo recién creado. Si en el futuro necesito garantizar unicidad estricta bajo concurrencia, guardaré el `groupId` en una base de datos con una restricción única por PDA de concesionario.

El endpoint comprueba también la firma, la propiedad on-chain y la firma binaria del archivo (PNG, JPEG o WEBP), además del MIME type y el límite de 5 MB. El nonce todavía no tiene almacenamiento persistente anti-replay: la ventana temporal limita su vigencia, pero no impide reutilizar una misma solicitud firmada dentro de esos cinco minutos. Esa protección queda pendiente antes de considerar el endpoint listo para producción.


### Módulo de Fidelización: subida desde el dashboard

El módulo `Fidelización` permite preparar el nombre, símbolo, descripción e imagen del token. Antes de enviar el archivo, la aplicación consulta la cuenta del concesionario y confirma que su propietario coincide con la wallet conectada. Luego solicita a la wallet una firma de mensaje sin transacción y envía el mensaje firmado junto con el archivo a `POST /api/ipfs/upload`.

El mensaje firmado conserva exactamente el formato validado por el endpoint. El cliente convierte la firma a Base64 y envía los datos mediante `FormData`. El dashboard muestra y permite copiar las URI IPFS, los CID, los identificadores de archivo de Pinata y el identificador del grupo.

La subida no crea el mint ni inicializa `MetadataPointer` o `TokenMetadata`. La URI devuelta queda preparada para una siguiente operación on-chain. La selección de red se limita a Devnet y Mainnet, que son las redes admitidas por la validación RPC del endpoint.

La versión del SDK declarada en el proyecto es `pinata@^2.5.6`. El lockfile registra la versión publicada `2.5.6`; no se debe inventar un número de versión ni un integrity hash para el paquete. Si se modifica la dependencia, se debe regenerar el lockfile con `npm install`.


## Referencias IPFS persistidas on-chain

La cuenta existente `ProgramaFidelidad` conserva su layout para no invalidar las cuentas ya creadas. Las referencias de contenido se guardan en una PDA independiente `MetadataFidelidad`, derivada con las seeds `["metadata_fidelidad", programa_fidelidad]`.

La cuenta almacena `metadata_cid` e `image_cid` (hasta 100 caracteres alfanuméricos cada uno), además de la PDA del programa al que pertenece y su bump. La instrucción `registrar_metadata_fidelidad` crea esa cuenta para programas existentes; `actualizar_metadata_fidelidad` permite cambiar ambos CID sin recrear el mint. Ambas instrucciones validan la propiedad del concesionario, la relación con la cuenta ProgramaFidelidad, la dirección del mint y que la autoridad del mint corresponda a la PDA de fidelización.

La aplicación reconstruye las URLs usando los CID on-chain y el gateway configurado en el cliente. El gateway no se considera una referencia permanente: puede cambiar sin modificar las cuentas de Solana. El JSON de metadata continúa conteniendo el CID/URI de la imagen, mientras que TokenMetadata del mint conserva la URI del JSON.
