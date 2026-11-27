export type DemoMotorcycle = {
  code: string;
  marca: string;
  modelo: string;
  color: string;
  transmision: "Automática" | "Sincrónica";
};

/**
 * Four independent demo groups. Each dealership owned by the same wallet
 * receives a different group, with three motorcycles per group.
 */
export function getDemoMotorcycleGroups(): DemoMotorcycle[][] {
  return [
    [
      { code: "HXR", marca: "HONDA", modelo: "XR 150L", color: "Rojo / Negro", transmision: "Sincrónica" },
      { code: "YFZ", marca: "YAMAHA", modelo: "FZ 2.0", color: "Azul / Negro", transmision: "Sincrónica" },
      { code: "SGN", marca: "SUZUKI", modelo: "GN 125", color: "Negro", transmision: "Sincrónica" },
    ],
    [
      { code: "BPN", marca: "BAJAJ", modelo: "Pulsar NS160", color: "Negro / Rojo", transmision: "Sincrónica" },
      { code: "TAR", marca: "TVS", modelo: "Apache RTR 160", color: "Gris / Negro", transmision: "Sincrónica" },
      { code: "HHR", marca: "HERO", modelo: "Hunk 160R", color: "Rojo / Negro", transmision: "Sincrónica" },
    ],
    [
      { code: "AKN", marca: "AKT", modelo: "NKD 125", color: "Negro", transmision: "Sincrónica" },
      { code: "KKL", marca: "KAWASAKI", modelo: "KLX 150", color: "Verde / Negro", transmision: "Sincrónica" },
      { code: "BNT", marca: "BENELLI", modelo: "TNT 15", color: "Blanco / Rojo", transmision: "Sincrónica" },
    ],
    [
      { code: "KDU", marca: "KTM", modelo: "Duke 200", color: "Naranja / Negro", transmision: "Sincrónica" },
      { code: "LLX", marca: "LONCIN", modelo: "LX 150", color: "Azul / Negro", transmision: "Sincrónica" },
      { code: "BBR", marca: "BERA", modelo: "BR 150", color: "Rojo / Negro", transmision: "Sincrónica" },
    ],
  ];
}

/** Flat catalog retained for callers that need to inspect every template. */
export function getDemoMotorcycles(): DemoMotorcycle[] {
  return getDemoMotorcycleGroups().flat();
}

export function normalizeMotorcycleModel(marca: string, modelo: string): string {
  return `${marca} ${modelo}`
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toUpperCase();
}
