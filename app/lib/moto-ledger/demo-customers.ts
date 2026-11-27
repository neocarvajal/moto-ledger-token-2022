export type DemoCustomer = {
  nombre: string;
  offset: number;
};

/**
 * Four independent demo customer groups. Each dealership owned by the same
 * wallet receives a different group, with three synthetic customer records.
 */
export function getDemoCustomerGroups(): DemoCustomer[][] {
  return [
    [
      { nombre: "Carlos Mendoza", offset: 0 },
      { nombre: "María González", offset: 1 },
      { nombre: "José Rodríguez", offset: 2 },
    ],
    [
      { nombre: "Andrés Herrera", offset: 0 },
      { nombre: "Valentina Rojas", offset: 1 },
      { nombre: "Miguel Castillo", offset: 2 },
    ],
    [
      { nombre: "Daniela Pérez", offset: 0 },
      { nombre: "Ricardo Morales", offset: 1 },
      { nombre: "Camila Fernández", offset: 2 },
    ],
    [
      { nombre: "Sofía Ramírez", offset: 0 },
      { nombre: "Gabriel Torres", offset: 1 },
      { nombre: "Isabella Flores", offset: 2 },
    ],
  ];
}
