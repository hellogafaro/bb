// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComputerMachineSummary } from "@bb/server-contract";
import { ComputerPanel } from "./ComputerPanel";

const machinesMock = vi.hoisted(() => vi.fn());
const doctorMock = vi.hoisted(() => vi.fn());
const previewMock = vi.hoisted(() => vi.fn());
const controlStatusMock = vi.hoisted(() => vi.fn());
const activeRunMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sdk", () => ({
  sdk: {
    computer: {
      machines: machinesMock,
      doctor: doctorMock,
      preview: previewMock,
      controlStatus: controlStatusMock,
      activeRun: activeRunMock,
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function machine(overrides: Partial<ComputerMachineSummary> = {}): ComputerMachineSummary {
  return {
    hostId: "host-a",
    name: "Workstation",
    status: "connected",
    type: "persistent",
    lastSeenAt: Date.now(),
    ...overrides,
  };
}

const readyDoctor = () => ({
  hostId: "host-a",
  state: "ready" as const,
  version: "1.0.0",
  driverPath: "/opt/bb/cua-driver",
  probes: [],
});

const livePreview = () => ({
  sequence: 1,
  state: "live" as const,
  mimeType: "image/png" as const,
  dataBase64: "AAAA",
  width: 10,
  height: 10,
  capturedAt: Date.now(),
});

describe("computer panel machine picker", () => {
  it("lists machines as cards with this thread's machine first and a status dot", async () => {
    machinesMock.mockResolvedValue({
      machines: [machine({ hostId: "host-b", name: "Other Box", status: "disconnected" }), machine()],
      currentHostId: "host-a",
    });

    const view = render(<ComputerPanel threadId="thread-1" />);

    await view.findByText("Choose a machine");
    const cards = view.getAllByRole("button");
    expect(cards[0]?.textContent).toContain("Workstation");
    expect(cards[1]?.textContent).toContain("Other Box");
  });

  it("selecting a card shows a spinner until the machine is ready and live", async () => {
    machinesMock.mockResolvedValue({ machines: [machine()], currentHostId: "host-a" });
    doctorMock.mockResolvedValue(readyDoctor());
    previewMock.mockResolvedValue(livePreview());
    controlStatusMock.mockResolvedValue({ owner: "agent" });
    activeRunMock.mockResolvedValue({ runId: null });

    const view = render(<ComputerPanel threadId="thread-1" />);

    fireEvent.click(await view.findByRole("button", { name: /Workstation/ }));

    await view.findByRole("img", { name: "Live machine view" });
    view.getByText(/Controlled by/);
    expect(view.queryByText("Workstation")).toBeNull();
  });

  it("shows the doctor probes when a machine is not ready", async () => {
    machinesMock.mockResolvedValue({ machines: [machine()], currentHostId: "host-a" });
    doctorMock.mockResolvedValue({
      hostId: "host-a",
      state: "unavailable" as const,
      version: null,
      driverPath: null,
      probes: [{ id: "driver" as const, label: "Driver", status: "unavailable" as const, message: "driver not found" }],
    });

    const view = render(<ComputerPanel threadId="thread-1" />);

    fireEvent.click(await view.findByRole("button", { name: /Workstation/ }));

    await view.findByText("driver not found");
    view.getByText("Driver");
    view.getByText("Workstation");
  });
});
