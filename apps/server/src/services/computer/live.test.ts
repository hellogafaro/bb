import { describe, expect, it, vi } from "vitest";
import type { ComputerLiveStatusMessage } from "@bb/host-daemon-contract";
import { ControlGate } from "./control-gate.js";
import { ComputerLiveHub, type ComputerLiveHubDeps, type ComputerLiveSocket } from "./live.js";

function fakeSocket(): ComputerLiveSocket & { sent: (string | Uint8Array<ArrayBuffer>)[] } {
  const sent: (string | Uint8Array<ArrayBuffer>)[] = [];
  return {
    sent,
    send: (data) => sent.push(data),
    close: () => {},
  };
}

function statusMessages(socket: ReturnType<typeof fakeSocket>) {
  return socket.sent
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => JSON.parse(entry) as { type: string; [key: string]: unknown })
    .filter((message) => message.type === "status");
}

function buildDeps(overrides: Partial<ComputerLiveHubDeps> = {}): {
  deps: ComputerLiveHubDeps;
  sendDemand: ReturnType<typeof vi.fn>;
  gates: Map<string, ControlGate>;
} {
  const sendDemand = vi.fn().mockReturnValue(true);
  const gates = new Map<string, ControlGate>();
  const deps: ComputerLiveHubDeps = {
    sendDemand,
    input: vi.fn().mockResolvedValue({ summary: "ok" }),
    clipboardRead: vi.fn().mockResolvedValue({ text: "clip" }),
    clipboardWrite: vi.fn().mockResolvedValue({ written: true }),
    controlGate: (hostId) => {
      let gate = gates.get(hostId);
      if (gate === undefined) {
        gate = new ControlGate();
        gates.set(hostId, gate);
      }
      return gate;
    },
    activeRunId: () => null,
    now: () => 0,
    tickMs: 1_000_000,
    ...overrides,
  };
  return { deps, sendDemand, gates };
}

describe("ComputerLiveHub subscriber lifecycle", () => {
  it("demands the full profile on the first viewer and withdraws it after the last detach", () => {
    const { deps, sendDemand } = buildDeps();
    const hub = new ComputerLiveHub(deps);
    const socket = fakeSocket();

    hub.attach("host-1", socket, { clientId: "client-1", profile: "full" });
    expect(sendDemand).toHaveBeenCalledWith("host-1", "full");
    expect(hub.viewerCount("host-1")).toBe(1);

    hub.detach("host-1", socket);
    expect(sendDemand).toHaveBeenLastCalledWith("host-1", null);
    expect(hub.viewerCount("host-1")).toBe(0);
  });

  it("keeps demanding full while any viewer wants full, and drops to thumbnail once it is the only demand", () => {
    const { deps, sendDemand } = buildDeps();
    const hub = new ComputerLiveHub(deps);
    const fullSocket = fakeSocket();
    const thumbSocket = fakeSocket();

    hub.attach("host-1", fullSocket, { clientId: "client-1", profile: "full" });
    hub.attach("host-1", thumbSocket, { clientId: "client-2", profile: "thumbnail" });
    expect(sendDemand).toHaveBeenLastCalledWith("host-1", "full");

    hub.detach("host-1", fullSocket);
    expect(sendDemand).toHaveBeenLastCalledWith("host-1", "thumbnail");

    hub.detach("host-1", thumbSocket);
    expect(sendDemand).toHaveBeenLastCalledWith("host-1", null);
  });

  it("stops forwarding frames to a detached viewer", () => {
    const { deps } = buildDeps();
    const hub = new ComputerLiveHub(deps);
    const socket = fakeSocket();
    hub.attach("host-1", socket, { clientId: "client-1", profile: "full" });

    const frame = new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer>;
    hub.handleDaemonFrame("host-1", frame);
    expect(socket.sent).toContain(frame);

    hub.detach("host-1", socket);
    socket.sent.length = 0;
    hub.handleDaemonFrame("host-1", frame);
    expect(socket.sent).not.toContain(frame);
  });
});

describe("ComputerLiveHub control gate enforcement", () => {
  it("rejects input from a viewer who has not taken control", async () => {
    const { deps } = buildDeps();
    const hub = new ComputerLiveHub(deps);
    const socket = fakeSocket();
    hub.attach("host-1", socket, { clientId: "client-1", profile: "full" });

    await hub.handleClientMessage("host-1", socket, {
      type: "input",
      requestId: "r1",
      input: { kind: "move", frame: { width: 100, height: 100 }, x: 1, y: 1 },
    });

    expect(deps.input).not.toHaveBeenCalled();
    const messages = socket.sent
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => JSON.parse(entry) as { type: string; code?: string });
    expect(messages).toContainEqual(
      expect.objectContaining({ type: "error", code: "control_required" }),
    );
  });

  it("performs input once the viewer holds control", async () => {
    const { deps, gates } = buildDeps();
    const hub = new ComputerLiveHub(deps);
    const socket = fakeSocket();
    hub.attach("host-1", socket, { clientId: "client-1", profile: "full" });
    await deps.controlGate("host-1").acquire("client-1", new AbortController().signal);
    expect(gates.get("host-1")?.owns("client-1")).toBe(true);

    await hub.handleClientMessage("host-1", socket, {
      type: "input",
      requestId: "r1",
      input: { kind: "move", frame: { width: 100, height: 100 }, x: 1, y: 1 },
    });

    expect(deps.input).toHaveBeenCalledWith("host-1", {
      kind: "move",
      frame: { width: 100, height: 100 },
      x: 1,
      y: 1,
    });
  });

  it("rejects clipboard access without control and allows it once control is held", async () => {
    const { deps } = buildDeps();
    const hub = new ComputerLiveHub(deps);
    const socket = fakeSocket();
    hub.attach("host-1", socket, { clientId: "client-1", profile: "full" });

    await hub.handleClientMessage("host-1", socket, { type: "clipboard.read", requestId: "r1" });
    expect(deps.clipboardRead).not.toHaveBeenCalled();

    await deps.controlGate("host-1").acquire("client-1", new AbortController().signal);
    await hub.handleClientMessage("host-1", socket, { type: "clipboard.read", requestId: "r2" });
    expect(deps.clipboardRead).toHaveBeenCalledWith("host-1");
  });

  it("broadcasts fresh status to viewers the moment control changes", () => {
    const { deps } = buildDeps();
    const hub = new ComputerLiveHub(deps);
    const socket = fakeSocket();
    hub.attach("host-1", socket, { clientId: "client-1", profile: "full" });
    socket.sent.length = 0;

    void deps.controlGate("host-1").acquire("client-1", new AbortController().signal);

    const statuses = statusMessages(socket);
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.at(-1)).toMatchObject({ control: "you" });
  });
});

describe("ComputerLiveHub daemon status", () => {
  it("relays daemon status pushes to every viewer of that host", () => {
    const { deps } = buildDeps();
    const hub = new ComputerLiveHub(deps);
    const socket = fakeSocket();
    hub.attach("host-1", socket, { clientId: "client-1", profile: "full" });
    socket.sent.length = 0;

    const message: ComputerLiveStatusMessage = { type: "computer.live.status", state: "live", message: null };
    hub.handleDaemonStatus("host-1", message);

    const statuses = statusMessages(socket);
    expect(statuses.at(-1)).toMatchObject({ state: "live" });
  });
});
