export type LiveFrameState = "live" | "paused" | "redacted" | "disconnected";

export interface LiveFrame {
  readonly sequence: number;
  readonly capturedAt: number;
  readonly mimeType: "image/jpeg" | "image/png";
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array | null;
  readonly state: LiveFrameState;
}

export interface CapturedImage {
  readonly bytes: Uint8Array;
  readonly mimeType: "image/jpeg" | "image/png";
  readonly width: number;
  readonly height: number;
}

export type LivePreviewSize = "thumbnail" | "full";

export interface LiveCaptureOptions {
  readonly capture: (signal: AbortSignal) => Promise<CapturedImage>;
  readonly thumbnailFps: number;
  readonly fullFps: number;
  readonly maxFrameBytes: number;
  readonly isProtected: () => boolean;
  readonly viewerTtlMs?: number;
  readonly now?: () => number;
}

interface Viewer {
  expiresAt: number;
  size: LivePreviewSize;
}

export class LiveCaptureLoop {
  readonly #options: LiveCaptureOptions;
  readonly #now: () => number;
  readonly #viewerTtlMs: number;
  readonly #viewers = new Map<string, Viewer>();
  #latest: LiveFrame | null = null;
  #sequence = 0;
  #wake: (() => void) | null = null;
  #paused = false;

  constructor(options: LiveCaptureOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#viewerTtlMs = options.viewerTtlMs ?? 8_000;
  }

  touchViewer(viewerId: string, size: LivePreviewSize): void {
    this.#viewers.set(viewerId, { expiresAt: this.#now() + this.#viewerTtlMs, size });
    this.#wake?.();
  }

  setPaused(paused: boolean): void {
    this.#paused = paused;
  }

  activeViewerCount(): number {
    const now = this.#now();
    for (const [id, viewer] of this.#viewers) if (viewer.expiresAt <= now) this.#viewers.delete(id);
    return this.#viewers.size;
  }

  #targetFps(): number {
    let fps = this.#options.thumbnailFps;
    for (const viewer of this.#viewers.values()) {
      if (viewer.size === "full") fps = Math.max(fps, this.#options.fullFps);
    }
    return fps;
  }

  latest(afterSequence: number | null): LiveFrame | null {
    const frame = this.#latest;
    if (frame === null || (afterSequence !== null && frame.sequence <= afterSequence)) return null;
    return frame;
  }

  async run(signal: AbortSignal): Promise<void> {
    try {
      while (!signal.aborted) {
        if (this.#paused) {
          this.#publishState("paused");
          await this.#waitForDemand(signal);
          continue;
        }
        if (this.activeViewerCount() === 0) {
          await this.#waitForDemand(signal);
          continue;
        }
        const intervalMs = 1_000 / Math.min(12, Math.max(0.2, this.#targetFps()));
        const started = this.#now();
        if (this.#options.isProtected()) {
          this.#publishState("redacted");
        } else {
          try {
            const image = await this.#options.capture(signal);
            if (image.bytes.length <= this.#options.maxFrameBytes) {
              this.#publish({ ...image, state: "live", capturedAt: started });
            }
          } catch {
            if (signal.aborted) break;
            this.#publishState("disconnected");
          }
        }
        await sleep(Math.max(0, intervalMs - (this.#now() - started)), signal);
      }
    } finally {
      this.#publishState("disconnected");
    }
  }

  #publishState(state: Exclude<LiveFrameState, "live">): void {
    if (this.#latest?.state === state) return;
    this.#publish({ bytes: null, mimeType: "image/jpeg", width: 1, height: 1, state, capturedAt: this.#now() });
  }

  #publish(frame: Omit<LiveFrame, "sequence">): void {
    this.#sequence += 1;
    this.#latest = { ...frame, sequence: this.#sequence };
  }

  #waitForDemand(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        this.#wake = null;
        signal.removeEventListener("abort", done);
        resolve();
      };
      this.#wake = done;
      signal.addEventListener("abort", done, { once: true });
      setTimeout(done, 2_000).unref?.();
    });
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
