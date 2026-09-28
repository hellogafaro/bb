// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComputerDoctorReport } from "@bb/server-contract";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { MachineComputerReadinessSection } from "./MachineComputerReadinessSection";

const doctorMock = vi.hoisted(() => vi.fn());
const installDriverMock = vi.hoisted(() => vi.fn());
const requestPermissionsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sdk", () => ({
  sdk: {
    computer: {
      doctor: doctorMock,
      installDriver: installDriverMock,
      requestPermissions: requestPermissionsMock,
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const bundleBinary = "/Users/jg/.bb-machines/x/computer/computer/driver/0.30.2/darwin-arm64/bb.app/Contents/MacOS/cua-driver";

function report(overrides: Partial<ComputerDoctorReport> = {}): ComputerDoctorReport {
  return {
    hostId: "host-a",
    state: "setup-required",
    version: "cua-driver 0.30.2",
    driverPath: bundleBinary,
    probes: [
      { id: "driver", label: "Driver", status: "ok", message: "Installed (cua-driver 0.30.2)" },
      { id: "service", label: "Driver service", status: "ok", message: "Running" },
      { id: "accessibility", label: "Accessibility", status: "setup-required", message: "Not granted" },
      { id: "screen-recording", label: "Screen recording", status: "ok", message: "Granted" },
    ],
    ...overrides,
  };
}

function renderSection(platformLabel: string | null = "macOS") {
  const { wrapper } = createQueryClientTestHarness();
  const host = makeHost({ id: "host-a", name: "pro", status: "connected" });
  return render(<MachineComputerReadinessSection host={host} platformLabel={platformLabel} />, {
    wrapper,
  });
}

describe("MachineComputerReadinessSection", () => {
  it("lists each probe by label and offers Grant permissions when a permission is missing", async () => {
    doctorMock.mockResolvedValue(report());
    const view = renderSection();
    await view.findByText("Accessibility");
    expect(view.getByText("Not granted")).toBeTruthy();
    expect(view.getByText("Running")).toBeTruthy();
    expect(view.queryByText("Install driver")).toBeNull();
    expect(view.getByText("Grant permissions")).toBeTruthy();
  });

  it("requests permissions on the machine and shows the bundle path to add", async () => {
    doctorMock.mockResolvedValue(report());
    requestPermissionsMock.mockResolvedValue(report());
    const view = renderSection();
    fireEvent.click(await view.findByText("Grant permissions"));
    await waitFor(() => expect(requestPermissionsMock).toHaveBeenCalledWith({ hostId: "host-a" }));
    await view.findByText("Approve on pro");
    expect(
      view.getByText("/Users/jg/.bb-machines/x/computer/computer/driver/0.30.2/darwin-arm64/bb.app"),
    ).toBeTruthy();
  });

  it("offers Install driver only while the driver is missing", async () => {
    doctorMock.mockResolvedValue(
      report({
        driverPath: null,
        probes: [
          { id: "driver", label: "Driver", status: "setup-required", message: "Not installed" },
          { id: "service", label: "Driver service", status: "setup-required", message: "Waiting for the driver" },
        ],
      }),
    );
    const view = renderSection();
    await view.findByText("Not installed");
    expect(view.getByText("Install driver")).toBeTruthy();
    expect(view.queryByText("Grant permissions")).toBeNull();
  });

  it("hides Grant permissions off macOS", async () => {
    doctorMock.mockResolvedValue(report());
    const view = renderSection("Linux");
    await view.findByText("Accessibility");
    expect(view.queryByText("Grant permissions")).toBeNull();
  });
});
