export type DemoMotorcycle = {
  code: string;
  marca: string;
  modelo: string;
  color: string;
  transmision: "Automática" | "Sincrónica";
};

/**
 * One shared demo catalog for the whole application.
 * It is intentionally independent from the dealership name or brand.
 */
export function getDemoMotorcycles(): DemoMotorcycle[] {
  return [
    { code: "HXR", marca: "HONDA", modelo: "XR 150L", color: "Rojo / Negro", transmision: "Sincrónica" },
    { code: "YFZ", marca: "YAMAHA", modelo: "FZ 2.0", color: "Azul / Negro", transmision: "Sincrónica" },
    { code: "SGN", marca: "SUZUKI", modelo: "GN 125", color: "Negro", transmision: "Sincrónica" },
  ];
}

export function normalizeMotorcycleModel(marca: string, modelo: string): string {
  return `${marca} ${modelo}`
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toUpperCase();
}
