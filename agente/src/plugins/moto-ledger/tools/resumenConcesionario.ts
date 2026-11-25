import {
  address,
  createSolanaRpc,
  getBase58Decoder,
  getBase58Encoder,
  getBase64Encoder,
  type Address,
  type Base58EncodedBytes,
  type GetProgramAccountsMemcmpFilter,
  type ReadonlyUint8Array,
} from "@solana/kit";
import type { SolanaAgentKit } from "solana-agent-kit";
import {
  fetchMaybeConcesionario,
  getConcesionarioDecoder,
  getConcesionarioDiscriminatorBytes,
} from "../../../../../app/lib/moto-ledger/generated/src/generated/accounts/concesionario";
import {
  fetchAllMaybeCliente,
  getClienteDecoder,
  getClienteDiscriminatorBytes,
  type Cliente,
} from "../../../../../app/lib/moto-ledger/generated/src/generated/accounts/cliente";
import {
  getMotoDecoder,
  getMotoDiscriminatorBytes,
} from "../../../../../app/lib/moto-ledger/generated/src/generated/accounts/moto";
import {
  getServicioDecoder,
  getServicioDiscriminatorBytes,
} from "../../../../../app/lib/moto-ledger/generated/src/generated/accounts/servicio";
import {
  getVentaDecoder,
  getVentaDiscriminatorBytes,
} from "../../../../../app/lib/moto-ledger/generated/src/generated/accounts/venta";
import {
  getRegistrarClienteInstructionDataDecoder,
  REGISTRAR_CLIENTE_DISCRIMINATOR,
} from "../../../../../app/lib/moto-ledger/generated/src/generated/instructions/registrarCliente";
import { REGISTRO_PROGRAM_ADDRESS } from "../../../../../app/lib/moto-ledger/generated/src/generated/programs/registro";
import { TipoServicio } from "../../../../../app/lib/moto-ledger/generated/src/generated/types/tipoServicio";
import { deriveConcesionarioPda } from "../../../../../app/lib/moto-ledger/pdas";

export type ResumenConcesionarioInput = {
  nombreConcesionario?: string;
};

type RegistroProgramAccount<T> = {
  address: Address;
  data: T;
};

type AccountDecoder<T> = {
  decode(value: ReadonlyUint8Array): T;
};

type DetalleMoto = {
  direccion: Address;
  serial: string;
  placa: string;
  marca: string;
  modelo: string;
  color: string;
  vendida: boolean;
  servicios: string;
};

type DetalleVenta = {
  direccion: Address;
  moto: Address;
  cliente: Address;
  fechaVenta: string;
  precioVenta: string;
};

type DetalleCliente = {
  direccion: Address;
  id: number;
  nombre: string;
  cedula: number;
  totalMotosCliente: number;
  concesionario: string | null;
};

function aDetalleCliente(
  cliente: { address: Address; data: Cliente },
  concesionario: string | null = null
): DetalleCliente {
  return {
    direccion: cliente.address,
    id: cliente.data.idCliente,
    nombre: cliente.data.nombreCliente,
    cedula: cliente.data.cedulaCliente,
    totalMotosCliente: cliente.data.totalMotosCliente,
    concesionario,
  };
}

type DetalleServicio = {
  direccion: Address;
  moto: Address;
  descripcion: string;
  tipo: string;
  fechaServicio: string;
  kilometraje: string;
  costo: string;
};

type ConcesionariosDelOwner = {
  total: number;
  detalle: {
    id: number;
    nombre: string;
    direccion: Address;
  }[];
};

type ClientesDelOwner = {
  total: number;
  detalle: DetalleCliente[];
  sinAtribuir: number;
  nota: string;
};

type ClientesDelConcesionario = {
  total: number;
  detalle: DetalleCliente[];
  nota: string;
};

type ResumenConcesionario = {
  existe: true;
  concesionariosDelOwner: ConcesionariosDelOwner;
  nombre: string;
  direccion: Address;
  owner: Address;
  idConcesionario: number;
  rif: string;
  motos: {
    declaradas: string;
    total: number;
    disponibles: number;
    vendidas: number;
    detalle: DetalleMoto[];
  };
  ventas: {
    declaradas: string;
    cantidad: number;
    montoTotal: string;
    ultimaFecha: string | null;
    detalle: DetalleVenta[];
  };
  clientes: {
    declarados: number;
    desdeVentas: number;
    nota: string;
    detalle: DetalleCliente[];
    delOwner: ClientesDelOwner;
    delConcesionario: ClientesDelConcesionario;
  };
  servicios: {
    declarados: string;
    cantidad: number;
    detalle: DetalleServicio[];
  };
};

export type ResumenConcesionarioResult =
  | ResumenConcesionario
  | {
      existe: false;
      nombre: string;
      motivo: string;
      concesionariosDelOwner: ConcesionariosDelOwner;
    };

type Rpc = ReturnType<typeof createSolanaRpc>;

// El listado del Owner es común a todas las preguntas de una sesión: se guarda
// 30 s para no repetir un getProgramAccounts por cada consulta.
const TTL_LISTADO_MS = 30_000;
const TTL_CLIENTES_MS = 300_000;
let cacheListado:
  | { owner: Address; expira: number; datos: ConcesionariosDelOwner }
  | null = null;

async function listarConcesionariosDelOwner(
  rpc: Rpc,
  owner: Address
): Promise<ConcesionariosDelOwner> {
  const ahora = Date.now();
  if (cacheListado && cacheListado.owner === owner && cacheListado.expira > ahora) {
    return cacheListado.datos;
  }

  const cuentas = await listarCuentasDelPrograma(
    rpc,
    getConcesionarioDiscriminatorBytes(),
    getConcesionarioDecoder(),
    owner
  );
  const datos: ConcesionariosDelOwner = {
    total: cuentas.length,
    detalle: cuentas
      .map((cuenta) => ({
        id: cuenta.data.idConcesionario,
        nombre: cuenta.data.nombreConcesionario,
        direccion: cuenta.address,
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre)),
  };
  cacheListado = { owner, expira: ahora + TTL_LISTADO_MS, datos };
  return datos;
}

const NOTA_CLIENTES_OWNER =
  "La cuenta Cliente no guarda el concesionario: el nombre se obtiene de la instrucción " +
  "registrar_cliente de la transacción que creó la cuenta.";

// La atribución no cambia después del registro, así que se guarda sin TTL.
const cacheOrigenCliente = new Map<Address, string>();

async function concesionarioDeCliente(
  rpc: Rpc,
  direccionCliente: Address
): Promise<string | null> {
  const guardado = cacheOrigenCliente.get(direccionCliente);
  if (guardado) return guardado;

  const firmas = await rpc
    .getSignaturesForAddress(direccionCliente, { limit: 20 })
    .send();
  for (const firma of firmas) {
    const tx = (await rpc
      .getTransaction(firma.signature, {
        encoding: "jsonParsed",
        maxSupportedTransactionVersion: 1,
      })
      .send()) as {
      transaction?: { message?: { instructions?: readonly unknown[] } };
    };
    for (const instruccion of tx.transaction?.message?.instructions ?? []) {
      const ix = instruccion as { programId?: string; data?: string };
      if (ix.programId !== REGISTRO_PROGRAM_ADDRESS || !ix.data) continue;
      const datos = getBase58Encoder().encode(ix.data);
      if (
        datos.length < 8 ||
        !Array.from(datos.slice(0, 8)).every(
          (byte, indice) => byte === REGISTRAR_CLIENTE_DISCRIMINATOR[indice]
        )
      ) {
        continue;
      }
      const registro = getRegistrarClienteInstructionDataDecoder().decode(datos);
      cacheOrigenCliente.set(direccionCliente, registro.nombreConcesionario);
      return registro.nombreConcesionario;
    }
  }
  return null;
}

async function aDetalleClienteConOrigen(
  rpc: Rpc,
  cliente: RegistroProgramAccount<Cliente>
): Promise<DetalleCliente> {
  let concesionario: string | null = null;
  try {
    concesionario = await concesionarioDeCliente(rpc, cliente.address);
  } catch {
    // Un fallo del RPC público no debe impedir mostrar los datos del cliente.
  }
  return aDetalleCliente(cliente, concesionario);
}

let cacheClientes:
  | { owner: Address; expira: number; datos: ClientesDelOwner }
  | null = null;

async function listarClientesDelOwner(
  rpc: Rpc,
  owner: Address
): Promise<ClientesDelOwner> {
  const ahora = Date.now();
  if (cacheClientes && cacheClientes.owner === owner && cacheClientes.expira > ahora) {
    return cacheClientes.datos;
  }

  const cuentas = await listarCuentasDelPrograma(
    rpc,
    getClienteDiscriminatorBytes(),
    getClienteDecoder(),
    owner
  );
  const detalle: DetalleCliente[] = [];
  for (const cuenta of cuentas) {
    detalle.push(await aDetalleClienteConOrigen(rpc, cuenta));
  }
  detalle.sort((a, b) => a.nombre.localeCompare(b.nombre));
  const datos: ClientesDelOwner = {
    total: detalle.length,
    detalle,
    sinAtribuir: detalle.filter((cliente) => !cliente.concesionario).length,
    nota: NOTA_CLIENTES_OWNER,
  };
  cacheClientes = { owner, expira: ahora + TTL_CLIENTES_MS, datos };
  return datos;
}

async function listarCuentasDelPrograma<T>(
  rpc: Rpc,
  discriminator: ReadonlyUint8Array,
  decoder: AccountDecoder<T>,
  filtroAddress?: Address
): Promise<RegistroProgramAccount<T>[]> {
  const bytes = getBase58Decoder().decode(discriminator) as Base58EncodedBytes;
  const filters: GetProgramAccountsMemcmpFilter[] = [
    {
      memcmp: {
        offset: 0n,
        bytes,
        encoding: "base58",
      },
    },
  ];

  // En todas estas cuentas el campo filtrable (concesionario u owner) va
  // justo después de los 8 bytes del discriminador.
  if (filtroAddress) {
    filters.push({
      memcmp: {
        offset: 8n,
        bytes: filtroAddress as Base58EncodedBytes,
        encoding: "base58",
      },
    });
  }

  const resultados = await rpc
    .getProgramAccounts(REGISTRO_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters,
    })
    .send();

  return resultados.map((resultado) => ({
    address: address(resultado.pubkey),
    data: decoder.decode(
      getBase64Encoder().encode(resultado.account.data[0])
    ),
  }));
}

function tipoServicioTexto(tipo: TipoServicio): string {
  return TipoServicio[tipo] ?? String(tipo);
}

function notaClientes(declarados: number, desdeVentas: number): string {
  const base =
    "Las cuentas Cliente pertenecen a la autoridad indicada en OWNER, " +
    "no al concesionario; por eso los vinculados se infieren desde las ventas. " +
    "clientes.delOwner enumera todas las cuentas Cliente del Owner y clientes.delConcesionario " +
    "las registradas por este concesionario, con nombre, cédula y totalMotosCliente aunque no haya ventas.";
  if (declarados > 0 && desdeVentas === 0) {
    return `${base} El concesionario declara ${declarados} clientes y clientes.delConcesionario los detalla.`;
  }
  return base;
}

export async function resumenConcesionario(
  agent: SolanaAgentKit,
  input: ResumenConcesionarioInput = {}
): Promise<ResumenConcesionarioResult> {
  const nombre = (
    input?.nombreConcesionario ??
    process.env.NOMBRE_CONCESIONARIO ??
    ""
  ).trim();
  if (!nombre) {
    throw new Error(
      "Falta el nombre del concesionario. Configura NOMBRE_CONCESIONARIO en agente/.env o indícalo en la pregunta."
    );
  }

  const ownerTexto = process.env.OWNER ?? "";
  if (!ownerTexto) {
    throw new Error("Falta OWNER en agente/.env.");
  }

  const rpc = createSolanaRpc(agent.connection.rpcEndpoint);
  const owner = address(ownerTexto);
  const concesionariosDelOwner = await listarConcesionariosDelOwner(rpc, owner);

  // La PDA se deriva del nombre exacto guardado on-chain. Se compara sin
  // distinguir mayúsculas para aceptar entradas como "bera motors".
  const texto = nombre.trim().replace(/\s+/g, " ").toUpperCase();
  const nombreResuelto =
    concesionariosDelOwner.detalle.find(
      (concesionario) => concesionario.nombre.toUpperCase() === texto
    )?.nombre ?? nombre;

  const [direccionConcesionario] = await deriveConcesionarioPda(
    nombreResuelto,
    owner
  );
  const concesionario = await fetchMaybeConcesionario(
    rpc,
    direccionConcesionario
  );

  if (!concesionario.exists) {
    return {
      existe: false,
      nombre: nombreResuelto,
      motivo: `No existe el concesionario "${nombreResuelto}" para la autoridad ${owner}`,
      concesionariosDelOwner,
    };
  }

  const [motos, ventas, servicios, clientesDelOwner] = await Promise.all([
    listarCuentasDelPrograma(
      rpc,
      getMotoDiscriminatorBytes(),
      getMotoDecoder()
    ),
    listarCuentasDelPrograma(
      rpc,
      getVentaDiscriminatorBytes(),
      getVentaDecoder(),
      direccionConcesionario
    ),
    listarCuentasDelPrograma(
      rpc,
      getServicioDiscriminatorBytes(),
      getServicioDecoder(),
      direccionConcesionario
    ),
    listarClientesDelOwner(rpc, owner),
  ]);

  const motosDelConcesionario = motos.filter(
    (moto) => moto.data.concesionario === direccionConcesionario
  );
  const motosVendidas = motosDelConcesionario.filter(
    (moto) => moto.data.vendida
  );

  const ventasOrdenadas = [...ventas].sort((a, b) =>
    a.data.fechaVenta > b.data.fechaVenta
      ? -1
      : a.data.fechaVenta < b.data.fechaVenta
        ? 1
        : 0
  );
  const montoTotal = ventas.reduce(
    (suma, venta) => suma + venta.data.precioVenta,
    0n
  );

  // Cada Venta conoce al Cliente, así que no hace falta buscar todas las
  // cuentas Cliente de la autoridad: se consultan solo esas direcciones.
  const direccionesClientes = [
    ...new Set(ventas.map((venta) => venta.data.cliente)),
  ];
  const clientes = direccionesClientes.length
    ? (await fetchAllMaybeCliente(rpc, direccionesClientes)).flatMap(
        (cliente) => (cliente.exists ? [cliente] : [])
      )
    : [];
  const clientesOrdenados = [...clientes].sort(
    (a, b) => b.data.totalMotosCliente - a.data.totalMotosCliente
  );
  const serviciosOrdenados = [...servicios].sort((a, b) =>
    a.data.fechaServicio > b.data.fechaServicio
      ? -1
      : a.data.fechaServicio < b.data.fechaServicio
        ? 1
        : 0
  );

  const origenPorDireccion = new Map(
    clientesDelOwner.detalle.map((cliente) => [
      cliente.direccion,
      cliente.concesionario,
    ])
  );
  const clientesDelConcesionario = clientesDelOwner.detalle.filter(
    (cliente) =>
      cliente.concesionario &&
      cliente.concesionario.toUpperCase() === texto
  );

  return {
    existe: true,
    concesionariosDelOwner,
    nombre: nombreResuelto,
    direccion: direccionConcesionario,
    owner,
    idConcesionario: concesionario.data.idConcesionario,
    rif: concesionario.data.rifConcesionario,
    motos: {
      declaradas: concesionario.data.totalMotos.toString(),
      total: motosDelConcesionario.length,
      disponibles: motosDelConcesionario.length - motosVendidas.length,
      vendidas: motosVendidas.length,
      detalle: motosDelConcesionario.map((moto) => ({
        direccion: moto.address,
        serial: moto.data.serial,
        placa: moto.data.placa,
        marca: moto.data.marca,
        modelo: moto.data.modelo,
        color: moto.data.color,
        vendida: moto.data.vendida,
        servicios: moto.data.servicios.toString(),
      })),
    },
    ventas: {
      declaradas: concesionario.data.totalVentas.toString(),
      cantidad: ventas.length,
      montoTotal: montoTotal.toString(),
      ultimaFecha: ventasOrdenadas[0]?.data.fechaVenta.toString() ?? null,
      detalle: ventasOrdenadas.map((venta) => ({
        direccion: venta.address,
        moto: venta.data.moto,
        cliente: venta.data.cliente,
        fechaVenta: venta.data.fechaVenta.toString(),
        precioVenta: venta.data.precioVenta.toString(),
      })),
    },
    clientes: {
      declarados: concesionario.data.totalClientes,
      desdeVentas: clientes.length,
      nota: notaClientes(
        concesionario.data.totalClientes,
        clientes.length
      ),
      detalle: clientesOrdenados.map((cliente) =>
        aDetalleCliente(cliente, origenPorDireccion.get(cliente.address) ?? null)
      ),
      delOwner: clientesDelOwner,
      delConcesionario: {
        total: clientesDelConcesionario.length,
        detalle: clientesDelConcesionario,
        nota:
          "Clientes registrados por este concesionario según la instrucción registrar_cliente. " +
          "Incluye nombre, cédula, id y totalMotosCliente aunque no haya ventas." +
          (clientesDelOwner.sinAtribuir > 0
            ? ` Atención: ${clientesDelOwner.sinAtribuir} cliente(s) del Owner no se pudieron atribuir; este listado puede estar incompleto.`
            : ""),
      },
    },
    servicios: {
      declarados: concesionario.data.totalServicios.toString(),
      cantidad: servicios.length,
      detalle: serviciosOrdenados.map((servicio) => ({
        direccion: servicio.address,
        moto: servicio.data.moto,
        descripcion: servicio.data.descripcion,
        tipo: tipoServicioTexto(servicio.data.tipo),
        fechaServicio: servicio.data.fechaServicio.toString(),
        kilometraje: servicio.data.kilometraje.toString(),
        costo: servicio.data.costo.toString(),
      })),
    },
  };
}
