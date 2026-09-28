// @vitest-environment jsdom

import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import type { MachineSummary } from "./contracts.js";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

function machine(overrides: Partial<MachineSummary> = {}): MachineSummary {
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
    const panel = app.threadPanelActions.find((action) => action.title === "Computer");
    const slot = renderSlot<PluginThreadPanelProps>(
      panel!,
      { threadId: "thread-1", params: null },
      {
        rpc: {
          machines: () => ({
            machines: [machine({ hostId: "host-b", name: "Other Box", status: "disconnected" }), machine()],
            currentHostId: "host-a",
          }),
        },
      },
    );

    await slot.findByText("Choose a machine");
    const cards = slot.getAllByRole("button");
    expect(cards[0]?.textContent).toContain("Workstation");
    expect(cards[1]?.textContent).toContain("Other Box");
    expect(slot.queryByText("Persistent")).toBeNull();
    expect(slot.queryByText("Machine")).toBeNull();
  });

  it("selecting a card shows a spinner until the machine is ready and live", async () => {
    const panel = app.threadPanelActions.find((action) => action.title === "Computer");
    const slot = renderSlot<PluginThreadPanelProps>(
      panel!,
      { threadId: "thread-1", params: null },
      {
        rpc: {
          machines: () => ({ machines: [machine()], currentHostId: "host-a" }),
          doctor: readyDoctor,
          preview: livePreview,
          controlStatus: () => ({ owner: "agent" }),
          activeRun: () => ({ runId: null }),
        },
      },
    );

    fireEvent.click(await slot.findByRole("button", { name: /Workstation/ }));

    await slot.findByRole("img", { name: "Live machine view" });
    slot.getByText(/Controlled by/);
    expect(slot.queryByText("Workstation")).toBeNull();
    expect(slot.queryByRole("button", { name: "Change" })).toBeNull();
  });

  it("shows the doctor probes with no Back link when a machine is not ready", async () => {
    const panel = app.threadPanelActions.find((action) => action.title === "Computer");
    const slot = renderSlot<PluginThreadPanelProps>(
      panel!,
      { threadId: "thread-1", params: null },
      {
        rpc: {
          machines: () => ({ machines: [machine()], currentHostId: "host-a" }),
          doctor: () => ({
            hostId: "host-a",
            state: "unavailable" as const,
            version: null,
            probes: [{ label: "Binary", status: "unavailable" as const, message: "cua driver not found" }],
          }),
        },
      },
    );

    fireEvent.click(await slot.findByRole("button", { name: /Workstation/ }));

    await slot.findByText("cua driver not found");
    slot.getByText("Binary");
    slot.getByText("Workstation");
    expect(slot.queryByRole("button", { name: "Back" })).toBeNull();
  });
});
