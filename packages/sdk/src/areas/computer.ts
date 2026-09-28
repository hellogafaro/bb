import type {
  ComputerActInput,
  ComputerActionOutcome,
  ComputerActiveRunRequest,
  ComputerActiveRunResponse,
  ComputerControlRequest,
  ComputerControlStatusResponse,
  ComputerDoctorReport,
  ComputerHostRequest,
  ComputerRequestPermissionsRequest,
  ComputerMachinesRequest,
  ComputerMachinesResponse,
  ComputerObserveRequest,
  ComputerObservation,
  ComputerReleaseControlResponse,
  ComputerRecordRequest,
  ComputerRecordResponse,
  ComputerRunRequest,
  ComputerRunStatus,
  ComputerScreenshotRequest,
  ComputerScreenshotResponse,
  ComputerStartInput,
  ComputerTakeControlResponse,
} from "@bb/server-contract";
import {
  buildComputerLiveWebSocketPath,
  computerLiveServerMessageSchema,
  type ComputerLiveServerMessage,
  type ComputerLiveSocketQuery,
} from "@bb/server-contract";
import {
  decodeComputerFrame,
  type ComputerFrame,
  type ComputerHumanInput,
} from "@bb/host-daemon-contract";
import { resolveRealtimeUrl } from "../realtime-url.js";
import type { BbSdkTransport } from "../transport.js";
import type { CreateSdkAreaArgs } from "./common.js";

export type {
  ComputerActInput,
  ComputerActionOutcome,
  ComputerActiveRunRequest,
  ComputerActiveRunResponse,
  ComputerControlRequest,
  ComputerControlStatusResponse,
  ComputerDoctorReport,
  ComputerHostRequest,
  ComputerMachinesRequest,
  ComputerMachinesResponse,
  ComputerObserveRequest,
  ComputerObservation,
  ComputerReleaseControlResponse,
  ComputerRecordRequest,
  ComputerRecordResponse,
  ComputerRunRequest,
  ComputerRunStatus,
  ComputerScreenshotRequest,
  ComputerScreenshotResponse,
  ComputerStartInput,
  ComputerTakeControlResponse,
  ComputerControlOwner,
  ComputerLiveServerMessage,
} from "@bb/server-contract";
export type {
  ComputerFrame,
  ComputerFrameHeader,
  ComputerHumanInput,
  ComputerLiveProfile,
} from "@bb/host-daemon-contract";

export type ComputerLiveStatus = Extract<ComputerLiveServerMessage, { type: "status" }>;
export type ComputerLiveError = Extract<ComputerLiveServerMessage, { type: "error" }>;

export interface ComputerLiveInput extends ComputerLiveSocketQuery {
  hostId: string;
  url?: string;
}

export interface ComputerLiveConnection {
  readonly opened: Promise<void>;
  onFrame(listener: (frame: ComputerFrame) => void): () => void;
  onStatus(listener: (status: ComputerLiveStatus) => void): () => void;
  onError(listener: (error: ComputerLiveError) => void): () => void;
  onClose(listener: () => void): () => void;
  input(input: ComputerHumanInput): void;
  perform(input: ComputerHumanInput): Promise<void>;
  readClipboard(): Promise<string | null>;
  writeClipboard(text: string, options: { paste: boolean }): Promise<void>;
  close(): void;
}

export interface ComputerArea {
  machines(input: ComputerMachinesRequest): Promise<ComputerMachinesResponse>;
  doctor(input: ComputerHostRequest): Promise<ComputerDoctorReport>;
  installDriver(input: ComputerHostRequest): Promise<ComputerDoctorReport>;
  requestPermissions(input: ComputerRequestPermissionsRequest): Promise<ComputerDoctorReport>;
  observe(input: ComputerObserveRequest): Promise<ComputerObservation>;
  act(input: ComputerActInput): Promise<ComputerActionOutcome>;
  screenshot(
    input: ComputerScreenshotRequest,
  ): Promise<ComputerScreenshotResponse>;
  record(input: ComputerRecordRequest): Promise<ComputerRecordResponse>;
  start(input: ComputerStartInput): Promise<ComputerRunStatus>;
  status(input: ComputerRunRequest): Promise<ComputerRunStatus>;
  cancel(input: ComputerRunRequest): Promise<ComputerRunStatus>;
  activeRun(
    input: ComputerActiveRunRequest,
  ): Promise<ComputerActiveRunResponse>;
  takeControl(
    input: ComputerControlRequest,
  ): Promise<ComputerTakeControlResponse>;
  releaseControl(
    input: ComputerControlRequest,
  ): Promise<ComputerReleaseControlResponse>;
  controlStatus(
    input: ComputerControlRequest,
  ): Promise<ComputerControlStatusResponse>;
  live(input: ComputerLiveInput): ComputerLiveConnection;
}

export function createComputerArea({ transport }: CreateSdkAreaArgs): ComputerArea {
  const api = () => transport.api.v1.computer;
  return {
    machines: (input) => transport.readJson(api().machines.$post({ json: input })),
    doctor: (input) => transport.readJson(api().doctor.$post({ json: input })),
    installDriver: (input) =>
      transport.readJson(api()["install-driver"].$post({ json: input })),
    requestPermissions: (input) =>
      transport.readJson(api()["request-permissions"].$post({ json: input })),
    observe: (input) => transport.readJson(api().observe.$post({ json: input })),
    act: (input) => transport.readJson(api().act.$post({ json: input })),
    screenshot: (input) =>
      transport.readJson(api().screenshot.$post({ json: input })),
    record: (input) => transport.readJson(api().record.$post({ json: input })),
    start: (input) => transport.readJson(api().start.$post({ json: input })),
    status: (input) => transport.readJson(api().status.$post({ json: input })),
    cancel: (input) => transport.readJson(api().cancel.$post({ json: input })),
    activeRun: (input) =>
      transport.readJson(api()["active-run"].$post({ json: input })),
    takeControl: (input) =>
      transport.readJson(api()["take-control"].$post({ json: input })),
    releaseControl: (input) =>
      transport.readJson(api()["release-control"].$post({ json: input })),
    controlStatus: (input) =>
      transport.readJson(api()["control-status"].$post({ json: input })),
    live: (input) => connectComputerLive(transport, input),
  };
}

function computerLiveUrl(transport: BbSdkTransport, input: ComputerLiveInput): string {
  if (input.url !== undefined) return input.url;
  const path = new URL(
    buildComputerLiveWebSocketPath(input),
    "http://placeholder",
  );
  const url = new URL(resolveRealtimeUrl({ transport }));
  url.pathname = `${url.pathname.replace(/\/ws\/?$/u, "")}${path.pathname}`;
  url.search = path.search;
  return url.href;
}

function connectComputerLive(
  transport: BbSdkTransport,
  input: ComputerLiveInput,
): ComputerLiveConnection {
  if (typeof WebSocket === "undefined") {
    throw new Error("The computer live view needs a runtime with a global WebSocket");
  }
  const socket = new WebSocket(computerLiveUrl(transport, input));
  socket.binaryType = "arraybuffer";
  const frameListeners = new Set<(frame: ComputerFrame) => void>();
  const statusListeners = new Set<(status: ComputerLiveStatus) => void>();
  const errorListeners = new Set<(error: ComputerLiveError) => void>();
  const closeListeners = new Set<() => void>();
  const pending = new Map<
    string,
    { resolve: (message: ComputerLiveServerMessage) => void; reject: (error: Error) => void }
  >();
  let nextRequestId = 0;
  const opened = new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("close", () => reject(new Error("The computer live view closed before it opened")), {
      once: true,
    });
  });
  opened.catch(() => {});
  socket.addEventListener("message", (event: MessageEvent) => {
    if (event.data instanceof ArrayBuffer) {
      const frame = decodeComputerFrame(new Uint8Array(event.data));
      if (frame !== null) for (const listener of frameListeners) listener(frame);
      return;
    }
    if (typeof event.data !== "string") return;
    let raw: unknown;
    try {
      raw = JSON.parse(event.data);
    } catch {
      return;
    }
    const parsed = computerLiveServerMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === "status") {
      for (const listener of statusListeners) listener(message);
      return;
    }
    const waiter = message.requestId === null ? undefined : pending.get(message.requestId);
    if (waiter !== undefined && message.requestId !== null) {
      pending.delete(message.requestId);
      if (message.type === "error") waiter.reject(new Error(message.message));
      else waiter.resolve(message);
      return;
    }
    if (message.type === "error") for (const listener of errorListeners) listener(message);
  });
  socket.addEventListener("close", () => {
    for (const waiter of pending.values()) waiter.reject(new Error("The computer live view closed"));
    pending.clear();
    for (const listener of closeListeners) listener();
  });
  const listen = <T>(listeners: Set<T>, listener: T) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const request = async (
    message:
      | { type: "clipboard.read" }
      | { type: "clipboard.write"; text: string; paste: boolean }
      | { type: "input"; input: ComputerHumanInput },
  ): Promise<ComputerLiveServerMessage> => {
    await opened;
    nextRequestId += 1;
    const requestId = `r${nextRequestId}`;
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      socket.send(JSON.stringify({ ...message, requestId }));
    });
  };
  return {
    opened,
    onFrame: (listener) => listen(frameListeners, listener),
    onStatus: (listener) => listen(statusListeners, listener),
    onError: (listener) => listen(errorListeners, listener),
    onClose: (listener) => listen(closeListeners, listener),
    input: (humanInput) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", requestId: null, input: humanInput }));
      }
    },
    perform: async (humanInput) => {
      await request({ type: "input", input: humanInput });
    },
    readClipboard: async () => {
      const reply = await request({ type: "clipboard.read" });
      return reply.type === "clipboard" ? reply.text : null;
    },
    writeClipboard: async (text, options) => {
      await request({ type: "clipboard.write", text, paste: options.paste });
    },
    close: () => socket.close(),
  };
}
