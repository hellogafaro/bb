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
    expect(cards[0]?.textContent).toContain("this thread");
    expect(cards[1]?.textContent).toContain("Other Box");
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
    slot.getByText("Workstation");
    slot.getByRole("button", { name: "Change" });
    slot.getByText(/Controlled by/);
  });

  it("shows the doctor probes and a Back link when a machine is not ready", async () => {
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
    fireEvent.click(slot.getByRole("button", { name: "Back" }));
    await slot.findByText("Choose a machine");
  });

  it("disables Change while a run is active, with an explanatory title", async () => {
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
          activeRun: () => ({ runId: "11111111-1111-1111-1111-111111111111" }),
        },
      },
    );

    fireEvent.click(await slot.findByRole("button", { name: /Workstation/ }));
    await slot.findByRole("img", { name: "Live machine view" });

    const change = slot.getByRole("button", { name: "Change" }) as HTMLButtonElement;
    expect(change.disabled).toBe(true);
    expect(change.title).toMatch(/active run/);
  });
});
