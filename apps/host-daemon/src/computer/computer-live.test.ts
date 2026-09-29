import { describe, expect, it, vi } from "vitest";
import type { ComputerFrame, ComputerLiveState } from "@bb/host-daemon-contract";
import { LiveStream, type CapturedFrame, type ComputerFrameSource } from "./computer-live.js";

class ManualFrameSource implements ComputerFrameSource {
  onFrame: ((frame: CapturedFrame) => void) | null = null;

  async stream(_profile: unknown, onFrame: (frame: CapturedFrame) => void, signal: AbortSignal): Promise<void> {
    this.onFrame = onFrame;
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
  }
}

function frame(bytes: number[], capturedAt: number): CapturedFrame {
  return {
    bytes: new Uint8Array(bytes),
    mimeType: "image/png",
    width: 10,
    height: 10,
    originalWidth: 10,
    originalHeight: 10,
    capturedAt,
  };
}

describe("LiveStream unchanged-frame skipping and resync", () => {
  it("skips identical frames, but resends the next frame after a resync even if it is unchanged", async () => {
    const source = new ManualFrameSource();
    const sent: ComputerFrame[] = [];
    const statuses: ComputerLiveState[] = [];
    const live = new LiveStream({
      source,
      prepare: async () => {},
      sendFrame: (f) => sent.push(f),
      sendStatus: (state) => statuses.push(state),
    });

    live.setDemand("full");
    await vi.waitFor(() => expect(source.onFrame).not.toBeNull());

    source.onFrame?.(frame([1, 2, 3], 1));
    expect(sent).toHaveLength(1);

    source.onFrame?.(frame([1, 2, 3], 2));
    expect(sent).toHaveLength(1);

    live.setDemand("full", { resync: true });
    source.onFrame?.(frame([1, 2, 3], 3));
    expect(sent).toHaveLength(2);

    source.onFrame?.(frame([1, 2, 3], 4));
    expect(sent).toHaveLength(2);

    live.dispose();
  });

  it("does not restart the capture stream on a same-profile resync", async () => {
    const source = new ManualFrameSource();
    const live = new LiveStream({
      source,
      prepare: async () => {},
      sendFrame: () => {},
      sendStatus: () => {},
    });

    live.setDemand("full");
    await vi.waitFor(() => expect(source.onFrame).not.toBeNull());
    const originalOnFrame = source.onFrame;

    live.setDemand("full", { resync: true });
    expect(source.onFrame).toBe(originalOnFrame);

    live.dispose();
  });
});
