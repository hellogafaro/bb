import type {
  ComputerHumanInput,
  ComputerLiveProfile,
  ComputerLiveState,
  ComputerLiveStatusMessage,
} from "@bb/host-daemon-contract";
import type {
  ComputerControlOwner,
  ComputerLiveClientMessage,
  ComputerLiveServerMessage,
} from "@bb/server-contract";
import type { ControlGate } from "./control-gate.js";

export interface ComputerLiveSocket {
  send(data: string | Uint8Array<ArrayBuffer>): void;
  close(code?: number, reason?: string): void;
  readonly raw?: { readonly bufferedAmount: number };
}

export interface ComputerLiveHubDeps {
  sendDemand(hostId: string, profile: ComputerLiveProfile | null): boolean;
  input(hostId: string, input: ComputerHumanInput): Promise<unknown>;
  clipboardRead(hostId: string): Promise<{ text: string | null }>;
  clipboardWrite(hostId: string, text: string, paste: boolean): Promise<unknown>;
  controlGate(hostId: string): ControlGate;
  activeRunId(hostId: string): string | null;
  now?: () => number;
  tickMs?: number;
}

interface Viewer {
  readonly socket: ComputerLiveSocket;
  readonly clientId: string;
  readonly profile: ComputerLiveProfile;
  lastFrameAt: number;
  readonly frameTimes: number[];
  movesInFlight: number;
}

interface HostLive {
  readonly viewers: Set<Viewer>;
  state: ComputerLiveState;
  message: string | null;
  demanded: ComputerLiveProfile | null;
  ticker: ReturnType<typeof setInterval> | null;
  ticks: number;
  unsubscribeControl: () => void;
}

const THUMBNAIL_FRAME_INTERVAL_MS = 1_000;
const VIEWER_HIGH_WATER_BYTES = 1024 * 1024;
const DEMAND_RENEW_TICKS = 5;
const MAX_MOVES_IN_FLIGHT = 1;

export class ComputerLiveHub {
  readonly #deps: ComputerLiveHubDeps;
  readonly #now: () => number;
  readonly #hosts = new Map<string, HostLive>();

  constructor(deps: ComputerLiveHubDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? Date.now;
  }

  attach(hostId: string, socket: ComputerLiveSocket, options: { clientId: string; profile: ComputerLiveProfile }): void {
    let host = this.#hosts.get(hostId);
    if (host === undefined) {
      const created: HostLive = {
        viewers: new Set(),
        state: "starting",
        message: null,
        demanded: null,
        ticker: null,
        ticks: 0,
        unsubscribeControl: this.#deps.controlGate(hostId).onChange(() => this.broadcastStatus(hostId)),
      };
      created.ticker = setInterval(() => this.#tick(hostId), this.#deps.tickMs ?? 1_000);
      created.ticker.unref?.();
      this.#hosts.set(hostId, created);
      host = created;
    }
    const viewer: Viewer = {
      socket,
      clientId: options.clientId,
      profile: options.profile,
      lastFrameAt: 0,
      frameTimes: [],
      movesInFlight: 0,
    };
    host.viewers.add(viewer);
    this.#syncDemand(hostId, host, false);
    this.#sendStatus(hostId, host, viewer);
  }

  detach(hostId: string, socket: ComputerLiveSocket): void {
    const host = this.#hosts.get(hostId);
    if (host === undefined) return;
    for (const viewer of host.viewers) if (viewer.socket === socket) host.viewers.delete(viewer);
    if (host.viewers.size > 0) {
      this.#syncDemand(hostId, host, false);
      return;
    }
    if (host.ticker !== null) clearInterval(host.ticker);
    host.unsubscribeControl();
    this.#hosts.delete(hostId);
    this.#deps.sendDemand(hostId, null);
  }

  viewerCount(hostId: string): number {
    return this.#hosts.get(hostId)?.viewers.size ?? 0;
  }

  handleDaemonConnected(hostId: string): void {
    const host = this.#hosts.get(hostId);
    if (host !== undefined) this.#syncDemand(hostId, host, true);
  }

  handleDaemonFrame(hostId: string, frame: Uint8Array<ArrayBuffer>): void {
    const host = this.#hosts.get(hostId);
    if (host === undefined) return;
    const now = this.#now();
    for (const viewer of host.viewers) {
      if (viewer.profile === "thumbnail" && now - viewer.lastFrameAt < THUMBNAIL_FRAME_INTERVAL_MS) continue;
      if ((viewer.socket.raw?.bufferedAmount ?? 0) > VIEWER_HIGH_WATER_BYTES) continue;
      viewer.lastFrameAt = now;
      viewer.frameTimes.push(now);
      viewer.socket.send(frame);
    }
  }

  handleDaemonStatus(hostId: string, message: ComputerLiveStatusMessage): void {
    const host = this.#hosts.get(hostId);
    if (host === undefined) return;
    host.state = message.state;
    host.message = message.message;
    this.broadcastStatus(hostId);
  }

  broadcastStatus(hostId: string): void {
    const host = this.#hosts.get(hostId);
    if (host === undefined) return;
    for (const viewer of host.viewers) this.#sendStatus(hostId, host, viewer);
  }

  async handleClientMessage(hostId: string, socket: ComputerLiveSocket, message: ComputerLiveClientMessage): Promise<void> {
    const viewer = this.#findViewer(hostId, socket);
    if (viewer === null) return;
    const requestId = message.requestId;
    if (!this.#deps.controlGate(hostId).touch(viewer.clientId)) {
      this.#send(socket, {
        type: "error",
        requestId,
        code: "control_required",
        message: "Take control of this machine before sending input or using its clipboard",
      });
      return;
    }
    try {
      switch (message.type) {
        case "input": {
          if (message.input.kind === "move") {
            if (viewer.movesInFlight >= MAX_MOVES_IN_FLIGHT) return;
            viewer.movesInFlight += 1;
            try {
              await this.#deps.input(hostId, message.input);
            } finally {
              viewer.movesInFlight -= 1;
            }
            return;
          }
          await this.#deps.input(hostId, message.input);
          if (message.requestId !== null) this.#send(socket, { type: "input.done", requestId: message.requestId });
          return;
        }
        case "clipboard.read": {
          const result = await this.#deps.clipboardRead(hostId);
          this.#send(socket, { type: "clipboard", requestId: message.requestId, text: result.text });
          return;
        }
        case "clipboard.write": {
          await this.#deps.clipboardWrite(hostId, message.text, message.paste);
          this.#send(socket, { type: "clipboard.written", requestId: message.requestId });
          return;
        }
      }
    } catch (error) {
      this.#send(socket, {
        type: "error",
        requestId,
        code: "computer_input_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  #findViewer(hostId: string, socket: ComputerLiveSocket): Viewer | null {
    for (const viewer of this.#hosts.get(hostId)?.viewers ?? []) if (viewer.socket === socket) return viewer;
    return null;
  }

  #tick(hostId: string): void {
    const host = this.#hosts.get(hostId);
    if (host === undefined) return;
    host.ticks += 1;
    if (host.ticks % DEMAND_RENEW_TICKS === 0) this.#syncDemand(hostId, host, true);
    this.broadcastStatus(hostId);
  }

  #syncDemand(hostId: string, host: HostLive, renew: boolean): void {
    const profile = [...host.viewers].some((viewer) => viewer.profile === "full") ? "full" : "thumbnail";
    if (!renew && host.demanded === profile) return;
    host.demanded = profile;
    if (!this.#deps.sendDemand(hostId, profile)) {
      host.state = "error";
      host.message = "The machine is offline";
    }
  }

  #sendStatus(hostId: string, host: HostLive, viewer: Viewer): void {
    const now = this.#now();
    while (viewer.frameTimes.length > 0 && (viewer.frameTimes[0] ?? now) <= now - 1_000) viewer.frameTimes.shift();
    this.#send(viewer.socket, {
      type: "status",
      state: host.state,
      message: host.message,
      control: this.#controlFor(hostId, viewer.clientId),
      runId: this.#deps.activeRunId(hostId),
      fps: viewer.frameTimes.length,
    });
  }

  #controlFor(hostId: string, clientId: string): ComputerControlOwner {
    return this.#deps.controlGate(hostId).statusFor(clientId);
  }

  #send(socket: ComputerLiveSocket, message: ComputerLiveServerMessage): void {
    socket.send(JSON.stringify(message));
  }
}
