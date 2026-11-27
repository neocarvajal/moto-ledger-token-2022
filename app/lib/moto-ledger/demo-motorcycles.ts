export type DemoMotorcycle = {
  code: string;
  marca: string;
  modelo: string;
  color: string;
  transmision: "Automática" | "Sincrónica";
};

/**
 * Small, dealership-aware demo catalog.
 * Catalogs are selected from the registered dealership name; unknown brands
 * deliberately have no fallback so the app never inserts an unrelated make.
 */
export function getDemoMotorcycles(nombreConcesionario: string): DemoMotorcycle[] {
  const normalized = nombreConcesionario
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  if (normalized.includes("TORO")) {
    return [
      { code: "FX", marca: "TORO", modelo: "FOX TR180", color: "Negro / Rojo", transmision: "Automática" },
      { code: "C3", marca: "CYCLONE", modelo: "RT3S", color: "Negro", transmision: "Sincrónica" },
      { code: "A2", marca: "ASIAWING", modelo: "NC250E", color: "Rojo / Negro", transmision: "Sincrónica" },
    ];
  }

  if (normalized.includes("BERA")) {
    return [
      { code: "CB", marca: "BERA", modelo: "COBRA 150", color: "Negro / Rojo", transmision: "Automática" },
      { code: "ML", marca: "BERA", modelo: "MILLAN 150", color: "Azul / Negro", transmision: "Automática" },
      { code: "SB", marca: "BERA", modelo: "SBR 150", color: "Negro / Azul", transmision: "Sincrónica" },
    ];
  }

  return [];
}

export function normalizeMotorcycleModel(marca: string, modelo: string): string {
  return `${marca} ${modelo}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toUpperCase();
}
