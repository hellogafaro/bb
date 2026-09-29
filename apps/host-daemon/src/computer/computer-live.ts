import type {
  ComputerFrame,
  ComputerImageMimeType,
  ComputerLiveProfile,
  ComputerLiveState,
} from "@bb/host-daemon-contract";
import { extractDesktopImage, type CuaToolResult, type CuaTransport } from "./computer-transport.js";

export interface CapturedFrame {
  readonly bytes: Uint8Array;
  readonly mimeType: ComputerImageMimeType;
  readonly width: number;
  readonly height: number;
  readonly originalWidth: number;
  readonly originalHeight: number;
  readonly capturedAt: number;
}

export interface ComputerFrameSource {
  stream(
    profile: ComputerLiveProfile,
    onFrame: (frame: CapturedFrame) => void,
    signal: AbortSignal,
  ): Promise<void>;
}

export interface LiveProfileSettings {
  readonly maxDimension: number;
  readonly maxFps: number;
}

export const LIVE_PROFILES: Readonly<Record<ComputerLiveProfile, LiveProfileSettings>> = {
  full: { maxDimension: 1280, maxFps: 12 },
  thumbnail: { maxDimension: 480, maxFps: 1 },
};

export const LIVE_CAPTURE_SESSION = "bb-live";

export function desktopCapture(result: CuaToolResult, capturedAt: number): CapturedFrame {
  const image = extractDesktopImage(result);
  if (image === null) {
    throw new Error("The driver returned a desktop capture without an image");
  }
  return {
    bytes: Buffer.from(image.base64, "base64"),
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    originalWidth: image.originalWidth,
    originalHeight: image.originalHeight,
    capturedAt,
  };
}

export interface DriverCaptureFrameSourceOptions {
  readonly transport: CuaTransport;
  readonly profiles?: Readonly<Record<ComputerLiveProfile, LiveProfileSettings>>;
  readonly inFlight?: number;
  readonly now?: () => number;
}

export class DriverCaptureFrameSource implements ComputerFrameSource {
  readonly #transport: CuaTransport;
  readonly #profiles: Readonly<Record<ComputerLiveProfile, LiveProfileSettings>>;
  readonly #inFlight: number;
  readonly #now: () => number;

  constructor(options: DriverCaptureFrameSourceOptions) {
    this.#transport = options.transport;
    this.#profiles = options.profiles ?? LIVE_PROFILES;
    this.#inFlight = options.inFlight ?? 2;
    this.#now = options.now ?? Date.now;
  }

  async stream(
    profile: ComputerLiveProfile,
    onFrame: (frame: CapturedFrame) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const settings = this.#profiles[profile];
    const intervalMs = 1_000 / settings.maxFps;
    const workers = new AbortController();
    const stop = () => workers.abort();
    signal.addEventListener("abort", stop, { once: true });
    let nextSlot = this.#now();
    let lastDelivered = -1;
    const worker = async () => {
      while (!workers.signal.aborted) {
        const slot = Math.max(this.#now(), nextSlot);
        nextSlot = slot + intervalMs;
        await sleep(slot - this.#now(), workers.signal);
        if (workers.signal.aborted) return;
        const capturedAt = this.#now();
        const result = await this.#transport.call(
          "get_desktop_state",
          { max_image_dimension: settings.maxDimension, session: LIVE_CAPTURE_SESSION },
          workers.signal,
        );
        if (workers.signal.aborted || capturedAt <= lastDelivered) continue;
        lastDelivered = capturedAt;
        onFrame(desktopCapture(result, capturedAt));
      }
    };
    try {
      await Promise.all(
        Array.from({ length: this.#inFlight }, () =>
          worker().catch((error: unknown) => {
            workers.abort();
            throw error;
          }),
        ),
      );
    } catch (error) {
      if (!signal.aborted) throw error;
    } finally {
      signal.removeEventListener("abort", stop);
    }
  }
}

export interface LiveStreamOptions {
  readonly source: ComputerFrameSource;
  readonly prepare: () => Promise<void>;
  readonly sendFrame: (frame: ComputerFrame) => void;
  readonly sendStatus: (state: ComputerLiveState, message: string | null) => void;
  readonly onFrame?: (frame: CapturedFrame) => void;
  readonly demandTtlMs?: number;
  readonly retryDelayMs?: number;
}

interface ActiveStream {
  readonly profile: ComputerLiveProfile;
  readonly controller: AbortController;
}

export class LiveStream {
  readonly #options: LiveStreamOptions;
  #active: ActiveStream | null = null;
  #expiry: ReturnType<typeof setTimeout> | null = null;
  #sequence = 0;
  #lastBytes: Uint8Array | null = null;

  constructor(options: LiveStreamOptions) {
    this.#options = options;
  }

  get profile(): ComputerLiveProfile | null {
    return this.#active?.profile ?? null;
  }

  setDemand(profile: ComputerLiveProfile | null, options?: { resync?: boolean }): void {
    if (this.#expiry !== null) clearTimeout(this.#expiry);
    this.#expiry = null;
    if (profile === null) {
      this.#stop();
      return;
    }
    this.#expiry = setTimeout(() => this.setDemand(null), this.#options.demandTtlMs ?? 15_000);
    this.#expiry.unref?.();
    if (this.#active?.profile === profile) {
      if (options?.resync) this.#lastBytes = null;
      return;
    }
    this.#stop();
    const active: ActiveStream = { profile, controller: new AbortController() };
    this.#active = active;
    void this.#run(active);
  }

  dispose(): void {
    this.setDemand(null);
  }

  #stop(): void {
    if (this.#active === null) return;
    this.#active.controller.abort();
    this.#active = null;
    this.#lastBytes = null;
    this.#options.sendStatus("stopped", null);
  }

  async #run(active: ActiveStream): Promise<void> {
    const signal = active.controller.signal;
    let announced = false;
    while (!signal.aborted) {
      this.#options.sendStatus("starting", null);
      try {
        await this.#options.prepare();
        if (signal.aborted) return;
        await this.#options.source.stream(
          active.profile,
          (frame) => {
            if (signal.aborted) return;
            if (!announced) {
              announced = true;
              this.#options.sendStatus("live", null);
            }
            this.#publish(frame);
          },
          signal,
        );
      } catch (error) {
        if (signal.aborted) return;
        announced = false;
        this.#options.sendStatus("error", error instanceof Error ? error.message.slice(0, 1_000) : String(error));
      }
      await sleep(this.#options.retryDelayMs ?? 2_000, signal);
    }
  }

  #publish(frame: CapturedFrame): void {
    this.#options.onFrame?.(frame);
    const previous = this.#lastBytes;
    if (previous !== null && sameBytes(previous, frame.bytes)) return;
    this.#lastBytes = frame.bytes;
    this.#sequence += 1;
    this.#options.sendFrame({
      header: {
        sequence: this.#sequence,
        capturedAt: frame.capturedAt,
        mimeType: frame.mimeType,
        width: frame.width,
        height: frame.height,
        originalWidth: frame.originalWidth,
        originalHeight: frame.originalHeight,
      },
      body: frame.bytes,
    });
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    Buffer.from(left.buffer, left.byteOffset, left.byteLength).equals(right)
  );
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
