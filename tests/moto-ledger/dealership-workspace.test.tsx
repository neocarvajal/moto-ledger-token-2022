import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DealershipWorkspace } from "../../app/components/dashboard/dealership-workspace";

const mocks = vi.hoisted(() => {
  const dealershipA = {
    owner: "CCF4CnM99mXSxz2sFffxT4A4CZxpWNsKNPbwueJThGMo",
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
  const dealershipB = {
    ...dealershipA,
    idConcesionario: 2,
    nombreConcesionario: "MOTOS TORO",
    rifConcesionario: "J345678901",
  };
  const connected = {
    account: { address: dealershipA.owner },
    signer: { address: dealershipA.owner },
  };
  const instruction = { sendTransaction: vi.fn() };
  const client = {
    rpc: {
      getProgramAccounts: vi.fn(),
    },
    registro: {
      accounts: { concesionario: { fetch: vi.fn() } },
      instructions: { registrarConcesionario: vi.fn(() => instruction) },
    },
  };
  return {
    dealershipA,
    dealershipB,
    connected,
    instruction,
    client,
    activeWallet: connected as typeof connected | null,
    notifySuccess: vi.fn(),
    toastError: vi.fn(),
    toastInfo: vi.fn(),
    deriveGlobal: vi.fn(),
    deriveDealership: vi.fn(),
    decode: vi.fn(),
  };
});

vi.mock("@solana/kit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/kit")>();
  return {
    ...actual,
    address: (value: string) => value,
    getBase58Decoder: () => ({ decode: () => "encoded-filter" }),
    getBase64Encoder: () => ({ encode: (value: unknown) => value }),
  };
});

vi.mock("@solana/kit-plugin-wallet/react", () => ({
  useConnectedWallet: () => mocks.activeWallet,
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

vi.mock("../../app/lib/moto-ledger/pdas", () => ({
  deriveRegistroGlobalPda: mocks.deriveGlobal,
  deriveConcesionarioPda: mocks.deriveDealership,
}));

vi.mock("../../app/lib/moto-ledger/generated/src/generated/accounts/concesionario", () => ({
  getConcesionarioDecoder: () => ({ decode: mocks.decode }),
  getConcesionarioDiscriminatorBytes: () => new Uint8Array(8),
}));

vi.mock("../../app/lib/moto-ledger/generated/src/generated/programs", () => ({
  REGISTRO_PROGRAM_ADDRESS: "MotoLedgerProgram111111111111111111111111111",
}));

vi.mock("../../app/components/dashboard/motorcycle-registration", () => ({
  MotorcycleRegistration: () => null,
}));
vi.mock("../../app/components/dashboard/motorcycle-catalog", () => ({
  MotorcycleCatalog: () => null,
}));
vi.mock("../../app/components/dashboard/customer-management", () => ({
  CustomerManagement: () => null,
}));
vi.mock("../../app/components/dashboard/sales-management", () => ({
  SalesManagement: () => null,
}));
vi.mock("../../app/components/dashboard/services-management", () => ({
  ServicesManagement: () => null,
}));
vi.mock("../../app/components/dashboard/settings-management", () => ({
  SettingsManagement: () => null,
}));

function setAccountResults() {
  mocks.client.rpc.getProgramAccounts.mockReturnValue({
    send: vi.fn().mockResolvedValue([
      { pubkey: "dealership-b", account: { data: ["b", "base64"] } },
      { pubkey: "dealership-a", account: { data: ["a", "base64"] } },
    ]),
  });
  mocks.decode.mockImplementation((bytes: unknown) =>
    String(bytes).startsWith("a") ? mocks.dealershipA : mocks.dealershipB
  );
}

describe("MotoLedger dealership workspace", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeWallet = mocks.connected;
    mocks.deriveGlobal.mockResolvedValue(["global-pda", 255]);
    mocks.deriveDealership.mockResolvedValue(["new-dealership-pda", 254]);
    mocks.client.rpc.getProgramAccounts.mockReturnValue({
      send: vi.fn().mockResolvedValue([]),
    });
  });

  it("asks for a wallet before showing dealership operations", () => {
    mocks.activeWallet = null;
    render(<DealershipWorkspace activeModule="overview" onNavigate={() => {}} />);

    expect(screen.getByText("Conecta tu wallet para comenzar")).toBeTruthy();
    expect(mocks.client.rpc.getProgramAccounts).not.toHaveBeenCalled();
  });

  it("loads and sorts the connected wallet's dealerships", async () => {
    setAccountResults();
    render(<DealershipWorkspace activeModule="workspace" onNavigate={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /BERA MOTORS/ })).toBeTruthy();
      expect(screen.getByRole("option", { name: /MOTOS TORO/ })).toBeTruthy();
    });

    const selector = screen.getByRole("combobox") as HTMLSelectElement;
    expect(selector.value).toBe("dealership-a");
    expect(Array.from(selector.options).map((option) => option.value)).toEqual([
      "dealership-a",
      "dealership-b",
    ]);
    expect(mocks.client.rpc.getProgramAccounts).toHaveBeenCalledWith(
      "MotoLedgerProgram111111111111111111111111111",
      expect.objectContaining({
        filters: expect.arrayContaining([
          { memcmp: { offset: 8n, bytes: "CCF4CnM99mXSxz2sFffxT4A4CZxpWNsKNPbwueJThGMo", encoding: "base58" } },
        ]),
      })
    );
  });

  it("changes the selected dealership from the selector", async () => {
    setAccountResults();
    render(<DealershipWorkspace activeModule="workspace" onNavigate={() => {}} />);

    const selector = await screen.findByRole("combobox");
    fireEvent.change(selector, { target: { value: "dealership-b" } });

    expect(screen.getByRole("option", { name: /MOTOS TORO/ })).toBeTruthy();
    expect(screen.getByText("J345678901")).toBeTruthy();
  });

  it("registers a new dealership and selects the fetched on-chain account", async () => {
    mocks.client.registro.accounts.concesionario.fetch
      .mockRejectedValueOnce(new Error("Account not found"))
      .mockResolvedValueOnce({ data: { ...mocks.dealershipA, nombreConcesionario: "NUEVO MOTOR" } });
    mocks.instruction.sendTransaction.mockResolvedValue({
      context: { signature: "signature-123" },
    });

    render(<DealershipWorkspace activeModule="workspace" onNavigate={() => {}} />);
    fireEvent.change(screen.getByLabelText("Nombre del concesionario"), {
      target: { value: "NUEVO MOTOR" },
    });
    fireEvent.change(screen.getByLabelText("RIF del concesionario"), {
      target: { value: "J987654321" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar concesionario" }));

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /NUEVO MOTOR/ })).toBeTruthy();
    });
    expect(mocks.deriveGlobal).toHaveBeenCalledOnce();
    expect(mocks.deriveDealership).toHaveBeenCalledWith(
      "NUEVO MOTOR",
      mocks.connected.account.address
    );
    expect(mocks.client.registro.instructions.registrarConcesionario).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: mocks.connected.signer,
        registroGlobal: "global-pda",
        concesionario: "new-dealership-pda",
        nombreConcesionario: "NUEVO MOTOR",
        rifConcesionario: "J987654321",
      })
    );
    expect(mocks.instruction.sendTransaction).toHaveBeenCalledOnce();
    expect(mocks.notifySuccess).toHaveBeenCalledWith(
      "Concesionario registrado y seleccionado.",
      "signature-123"
    );
  });

  it("selects an already registered dealership instead of sending a duplicate transaction", async () => {
    mocks.client.registro.accounts.concesionario.fetch.mockResolvedValue({
      data: mocks.dealershipA,
    });

    render(<DealershipWorkspace activeModule="workspace" onNavigate={() => {}} />);
    fireEvent.change(screen.getByLabelText("Nombre del concesionario"), {
      target: { value: "BERA MOTORS" },
    });
    fireEvent.change(screen.getByLabelText("RIF del concesionario"), {
      target: { value: "J123456789" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar concesionario" }));

    await waitFor(() => {
      expect(mocks.toastInfo).toHaveBeenCalledWith(
        "Este concesionario ya estaba registrado y fue seleccionado."
      );
    });
    expect(mocks.instruction.sendTransaction).not.toHaveBeenCalled();
  });

  it("rejects registration when the wallet cannot sign", async () => {
    mocks.activeWallet = { account: mocks.connected.account, signer: undefined } as never;
    render(<DealershipWorkspace activeModule="workspace" onNavigate={() => {}} />);
    fireEvent.change(screen.getByLabelText("Nombre del concesionario"), {
      target: { value: "NUEVO MOTOR" },
    });
    fireEvent.change(screen.getByLabelText("RIF del concesionario"), {
      target: { value: "J987654321" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar concesionario" }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "La wallet conectada no permite firmar transacciones."
      );
    });
    expect(mocks.instruction.sendTransaction).not.toHaveBeenCalled();
  });
});
