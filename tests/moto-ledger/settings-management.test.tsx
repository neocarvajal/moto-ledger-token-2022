import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsManagement } from "../../app/components/dashboard/settings-management";

const mocks = vi.hoisted(() => {
  const owner = "CCF4CnM99mXSxz2sFffxT4A4CZxpWNsKNPbwueJThGMo";
  const data = {
    owner,
    idConcesionario: 1,
    nombreConcesionario: "BERA MOTORS",
    rifConcesionario: "J123456789",
    totalServicios: 0n,
    totalMotos: 3n,
    totalClientes: 3,
    totalVentas: 0n,
    duracionGarantiaDias: 180,
    kilometrajeMaximo: 6000n,
  };
  const instruction = { sendTransaction: vi.fn() };
  const client = {
    registro: {
      accounts: { concesionario: { fetch: vi.fn() } },
      instructions: { configurarGarantia: vi.fn(() => instruction) },
    },
  };
  return {
    owner,
    data,
    instruction,
    client,
    connected: {
      account: { address: owner },
      signer: { address: owner },
    } as { account: { address: string }; signer: unknown } | null,
    notifySuccess: vi.fn(),
    toastError: vi.fn(),
    toastInfo: vi.fn(),
  };
});

vi.mock("@solana/kit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/kit")>();
  return { ...actual, address: (value: string) => value };
});

vi.mock("@solana/kit-plugin-wallet/react", () => ({
  useConnectedWallet: () => mocks.connected,
}));

vi.mock("../../app/lib/client-provider", () => ({
  useAppClient: () => mocks.client,
}));

vi.mock("../../app/lib/transaction-toast", () => ({
  notifyTransactionSuccess: mocks.notifySuccess,
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    info: mocks.toastInfo,
  },
}));

describe("MotoLedger dealership warranty settings", () => {
  afterEach(() => cleanup());
  const onUpdated = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connected = {
      account: { address: mocks.owner },
      signer: { address: mocks.owner },
    };
    mocks.client.registro.accounts.concesionario.fetch.mockResolvedValue({
      data: mocks.data,
    });
    mocks.instruction.sendTransaction.mockResolvedValue({
      context: { signature: "warranty-signature" },
    });
  });

  function renderSettings() {
    return render(
      <SettingsManagement
        concesionario="dealership-pda"
        data={mocks.data as never}
        onUpdated={onUpdated}
      />
    );
  }

  it("renders the dealership identity and current warranty policy", () => {
    renderSettings();

    expect(screen.getByText("BERA MOTORS")).toBeTruthy();
    expect(screen.getByText("J123456789")).toBeTruthy();
    expect((screen.getAllByRole("spinbutton")[0] as HTMLInputElement).value).toBe("180");
    expect((screen.getAllByRole("spinbutton")[1] as HTMLInputElement).value).toBe("6000");
  });

  it("rejects warranty durations outside the u16 range", async () => {
    renderSettings();
    fireEvent.change(screen.getAllByRole("spinbutton")[0], {
      target: { value: "65536" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Guardar configuración" }).closest("form")!);

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "La duración debe ser un número entero entre 1 y 65.535 días."
      );
    });
    expect(mocks.client.registro.instructions.configurarGarantia).not.toHaveBeenCalled();
  });

  it("rejects non-integer mileage values", async () => {
    renderSettings();
    fireEvent.change(screen.getAllByRole("spinbutton")[1], {
      target: { value: "12.5" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Guardar configuración" }).closest("form")!);

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "El kilometraje máximo debe ser un entero positivo."
      );
    });
    expect(mocks.client.registro.instructions.configurarGarantia).not.toHaveBeenCalled();
  });

  it("does not send a transaction when the values have not changed", async () => {
    renderSettings();
    fireEvent.submit(screen.getByRole("button", { name: "Guardar configuración" }).closest("form")!);

    await waitFor(() => {
      expect(mocks.toastInfo).toHaveBeenCalledWith("No hay cambios para guardar.");
    });
    expect(mocks.client.registro.accounts.concesionario.fetch).not.toHaveBeenCalled();
    expect(mocks.instruction.sendTransaction).not.toHaveBeenCalled();
  });

  it("requires a wallet capable of signing", async () => {
    mocks.connected = null;
    renderSettings();
    fireEvent.change(screen.getAllByRole("spinbutton")[0], {
      target: { value: "365" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Guardar configuración" }).closest("form")!);

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Conecta una wallet con capacidad de firma."
      );
    });
    expect(mocks.client.registro.accounts.concesionario.fetch).not.toHaveBeenCalled();
  });

  it("blocks changes when the connected wallet is not the dealership owner", async () => {
    mocks.client.registro.accounts.concesionario.fetch.mockResolvedValue({
      data: { ...mocks.data, owner: "11111111111111111111111111111111" },
    });
    renderSettings();
    fireEvent.change(screen.getAllByRole("spinbutton")[0], {
      target: { value: "365" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Guardar configuración" }).closest("form")!);

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "La wallet conectada no es propietaria de este concesionario."
      );
    });
    expect(mocks.instruction.sendTransaction).not.toHaveBeenCalled();
  });

  it("updates the on-chain warranty policy and refreshes dealership data", async () => {
    renderSettings();
    fireEvent.change(screen.getAllByRole("spinbutton")[0], {
      target: { value: "365" },
    });
    fireEvent.change(screen.getAllByRole("spinbutton")[1], {
      target: { value: "12000" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Guardar configuración" }).closest("form")!);

    await waitFor(() => {
      expect(mocks.notifySuccess).toHaveBeenCalledWith(
        "Política de garantía actualizada en Solana.",
        "warranty-signature"
      );
    });
    expect(mocks.client.registro.instructions.configurarGarantia).toHaveBeenCalledWith({
      owner: mocks.connected?.signer,
      concesionario: "dealership-pda",
      nombreConcesionario: "BERA MOTORS",
      duracionGarantiaDias: 365,
      kilometrajeMaximo: 12000n,
    });
    expect(mocks.instruction.sendTransaction).toHaveBeenCalledOnce();
    expect(onUpdated).toHaveBeenCalledOnce();
  });
});
