import { z } from "zod";
import type { Action } from "solana-agent-kit";
import { resumenConcesionario } from "../tools/resumenConcesionario";

const ResumenConcesionarioAction: Action = {
  name: "MOTOLEDGER_RESUMEN_CONCESIONARIO",
  description:
    "Consulta el estado on-chain de un concesionario de MotoLedger en Solana: " +
    "detalle de motos, ventas y monto total, clientes declarados, vinculados desde las ventas " +
    "y registrados por el concesionario con nombre y cédula, detalle de servicios y el " +
    "listado/cantidad de concesionarios del Owner. " +
    "Úsala tanto para preguntas sobre un concesionario concreto (o el configurado " +
    "por defecto) como para saber cuántos concesionarios hay registrados por el Owner. " +
    "Los importes y fechas son datos del registro, no saldos de una wallet ni facturación histórica.",
  similes: [
    "resumen del concesionario",
    "mis motos",
    "inventario de motocicletas",
    "ventas del concesionario",
    "clientes y servicios",
    "cuántos clientes tiene el concesionario",
    "datos del cliente registrado",
    "nombre y cédula del cliente",
    "estado de EK EMPIRE",
    "estado de BERA MOTORS",
    "estado de MOTOS TORO",
    "cuántos concesionarios hay registrados por el owner",
    "listado de concesionarios",
  ],
  examples: [
    [
      {
        input: {},
        output: {
          status: "success",
          result: {
            existe: true,
            nombre: "EK EMPIRE",
            motos: { total: 4, disponibles: 2, vendidas: 2 },
          },
        },
        explanation:
          "Fragmento ilustrativo del concesionario configurado por defecto en .env.",
      },
    ],
    [
      {
        input: { nombreConcesionario: "BERA MOTORS" },
        output: {
          status: "success",
          result: { existe: true, nombre: "BERA MOTORS" },
        },
        explanation:
          "El modelo indicó explícitamente qué concesionario quiere consultar.",
      },
    ],
    [
      {
        input: {},
        output: {
          status: "success",
          result: {
            existe: true,
            concesionariosDelOwner: {
              total: 3,
              detalle: [
                { nombre: "BERA MOTORS", direccion: "7n7tA4N...", id: 1 },
                { nombre: "EK EMPIRE", direccion: "E6huXEf...", id: 2 },
                { nombre: "MOTOS TORO", direccion: "8WQjh7p...", id: 3 },
              ],
            },
          },
        },
        explanation:
          "Pregunta sobre la cantidad de concesionarios del Owner; se responde con concesionariosDelOwner.total.",
      },
    ],
  ],
  schema: z.object({
    nombreConcesionario: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "Nombre del concesionario; se compara sin distinguir mayúsculas. Si se omite, se usa NOMBRE_CONCESIONARIO de .env."
      ),
  }),
  handler: async (agent, input) => {
    try {
      const nombreConcesionario =
        typeof input?.nombreConcesionario === "string"
          ? input.nombreConcesionario
          : undefined;
      return {
        status: "success",
        result: await resumenConcesionario(agent, { nombreConcesionario }),
      };
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export default ResumenConcesionarioAction;
