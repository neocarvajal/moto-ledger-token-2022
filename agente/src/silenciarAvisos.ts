// bigint-buffer no encuentra su binding nativo y avisa por consola aunque la
// implementación pura de JS funciona correctamente. Se importa primero para
// filtrar solo ese aviso; cualquier otro warning sigue viéndose.
const AVISO = "bigint: Failed to load bindings";
const warnOriginal = console.warn.bind(console);

console.warn = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes(AVISO)) return;
  warnOriginal(...args);
};
