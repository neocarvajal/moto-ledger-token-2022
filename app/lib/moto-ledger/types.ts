export type DealershipProfile = {
  address: string;
  owner: string;
  idConcesionario: number;
  nombreConcesionario: string;
  rifConcesionario: string;
  totalServicios: bigint;
  totalMotos: bigint;
  totalClientes: number;
  totalVentas: bigint;
  duracionGarantiaDias: number;
  kilometrajeMaximo: bigint;
};
