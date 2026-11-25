// Carga agente/.env sea cual sea el directorio desde el que se ejecute el
// proceso (por ejemplo, al usar tsx directamente desde la raíz del repo).
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

config({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
  quiet: true,
});
