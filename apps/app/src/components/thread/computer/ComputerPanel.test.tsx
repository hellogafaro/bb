// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComputerMachineSummary } from "@bb/server-contract";
import { ComputerPanel } from "./ComputerPanel";

const machinesMock = vi.hoisted(() => vi.fn());
const doctorMock = vi.hoisted(() => vi.fn());
const liveMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sdk", () => ({
  sdk: {
    computer: {
      machines: machinesMock,
      doctor: doctorMock,
      live: liveMock,
    },
  },
}));

function fakeLiveConnection() {
  const frameListeners = new Set<(frame: unknown) => void>();
  const statusListeners = new Set<(status: unknown) => void>();
  const closeListeners = new Set<() => void>();
  return {
    opened: Promise.resolve(),
    onFrame: (listener: (frame: unknown) => void) => {
      frameListeners.add(listener);
      return () => frameListeners.delete(listener);
    },
    onStatus: (listener: (status: unknown) => void) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    onError: () => () => {},
    onClose: (listener: () => void) => {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    input: vi.fn(),
    perform: vi.fn().mockResolvedValue(undefined),
    readClipboard: vi.fn().mockResolvedValue(null),
    writeClipboard: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    emitStatus: (status: unknown) => {
      for (const listener of statusListeners) listener(status);
    },
  };
}

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
  platform: "linux",
  version: "1.0.0",
  driverPath: "/opt/bb/cua-driver",
  probes: [],
});

describe("computer panel machine picker", () => {
  it("lists machines as cards with this thread's machine first and a status dot", async () => {
    machinesMock.mockResolvedValue({
      machines: [machine({ hostId: "host-b", name: "Other Box", status: "disconnected" }), machine()],
      currentHostId: "host-a",
    });

    const view = render(<ComputerPanel threadId="thread-1" isActive={true} />);

    await view.findByText("Choose a machine");
    const cards = view.getAllByRole("button");
    expect(cards[0]?.textContent).toContain("Workstation");
    expect(cards[1]?.textContent).toContain("Other Box");
  });

  it("selecting a card shows the control banner once the machine is ready", async () => {
    machinesMock.mockResolvedValue({ machines: [machine()], currentHostId: "host-a" });
    doctorMock.mockResolvedValue(readyDoctor());
    const connection = fakeLiveConnection();
    liveMock.mockReturnValue(connection);

    const view = render(<ComputerPanel threadId="thread-1" isActive={true} />);

    fireEvent.click(await view.findByRole("button", { name: /Workstation/ }));

    await view.findByText("View only");
    expect(liveMock).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: "host-a", profile: "full" }),
    );
    expect(view.queryByText("Workstation")).toBeNull();
  });

  it.each([
    { control: "agent" as const, runId: null, label: "View only", buttons: ["Take control"] },
    {
      control: "agent" as const,
      runId: "run-1",
      label: "Agent is using this computer",
      buttons: ["Take control", "Stop agent"],
    },
    { control: "you" as const, runId: null, label: "You're in control", buttons: ["Stop control"] },
    {
      control: "other" as const,
      runId: null,
      label: "Someone else is in control",
      buttons: ["Take control"],
    },
  ])(
    "shows '$label' with the right buttons for control=$control runId=$runId",
    async ({ control, runId, label, buttons }) => {
      machinesMock.mockResolvedValue({ machines: [machine()], currentHostId: "host-a" });
      doctorMock.mockResolvedValue(readyDoctor());
      const connection = fakeLiveConnection();
      liveMock.mockReturnValue(connection);

      const view = render(<ComputerPanel threadId="thread-1" isActive={true} />);

      fireEvent.click(await view.findByRole("button", { name: /Workstation/ }));
      await view.findByText("View only");
      connection.emitStatus({ state: "live", message: null, control, runId, fps: 0 });

      await view.findByText(label);
      for (const buttonName of buttons) {
        view.getByRole("button", { name: buttonName });
      }
      if (control === "other") {
        expect(view.getByRole("button", { name: "Take control" }).hasAttribute("disabled")).toBe(
          true,
        );
      }
    },
  );

  it("shows the doctor probes when a machine is not ready", async () => {
    machinesMock.mockResolvedValue({ machines: [machine()], currentHostId: "host-a" });
    doctorMock.mockResolvedValue({
      hostId: "host-a",
      state: "unavailable" as const,
      platform: "linux",
      version: null,
      driverPath: null,
      probes: [{ id: "driver" as const, label: "Driver", status: "unavailable" as const, message: "driver not found" }],
    });

    const view = render(<ComputerPanel threadId="thread-1" isActive={true} />);

    fireEvent.click(await view.findByRole("button", { name: /Workstation/ }));

    await view.findByText("driver not found");
    view.getByText("Driver");
    view.getByText("Workstation");
  });

  it("does not connect the live view while the tab is inactive", async () => {
    machinesMock.mockResolvedValue({ machines: [machine()], currentHostId: "host-a" });
    doctorMock.mockResolvedValue(readyDoctor());
    liveMock.mockReturnValue(fakeLiveConnection());

    const view = render(<ComputerPanel threadId="thread-1" isActive={false} />);

    fireEvent.click(await view.findByRole("button", { name: /Workstation/ }));

    await view.findByText("Waiting for a frame…");
    expect(liveMock).not.toHaveBeenCalled();
  });
});
