// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComputerLiveStage, type ComputerLiveHandle } from "./ComputerLiveView";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function fakeLive(overrides: Partial<ComputerLiveHandle> = {}): ComputerLiveHandle {
  return {
    connected: true,
    state: "live",
    message: null,
    control: "you",
    runId: null,
    fps: 30,
    frameUrl: "blob:frame",
    frameHeader: {
      kind: "image",
      sequence: 1,
      capturedAt: Date.now(),
      mimeType: "image/jpeg",
      width: 100,
      height: 100,
      originalWidth: 100,
      originalHeight: 100,
    },
    isVideo: false,
    attachVideoCanvas: vi.fn(),
    send: vi.fn(),
    perform: vi.fn().mockResolvedValue(undefined),
    readClipboard: vi.fn().mockResolvedValue("machine text"),
    writeClipboard: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function stubClipboard() {
  const write = vi.fn().mockResolvedValue(undefined);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { write, writeText, readText: vi.fn() },
    configurable: true,
  });
  return { write, writeText };
}

describe("ComputerLiveStage clipboard sync", () => {
  it("writes pasted browser text to the machine clipboard and sends the platform paste shortcut", async () => {
    const live = fakeLive();
    const view = render(<ComputerLiveStage live={live} interactive isMac={false} />);
    const textarea = view.getByLabelText("Computer keyboard input");

    fireEvent.paste(textarea, {
      clipboardData: { getData: () => "hello from browser" },
    });

    expect(live.writeClipboard).toHaveBeenCalledWith("hello from browser", true);
  });

  it("sends the mac copy shortcut then mirrors the machine clipboard into the browser via ClipboardItem", async () => {
    class FakeClipboardItem {
      constructor(public items: Record<string, Blob | Promise<Blob>>) {}
    }
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    const { write } = stubClipboard();
    const live = fakeLive();
    const view = render(<ComputerLiveStage live={live} interactive isMac={true} />);
    const textarea = view.getByLabelText("Computer keyboard input");

    fireEvent.copy(textarea);

    expect(live.perform).toHaveBeenCalledWith({ kind: "key", key: "c", modifiers: ["meta"] });
    expect(write).toHaveBeenCalledTimes(1);
    const item = write.mock.calls[0]?.[0]?.[0] as FakeClipboardItem;
    await expect(item.items["text/plain"]).resolves.toBeInstanceOf(Blob);
    await expect((await item.items["text/plain"]).text()).resolves.toBe("machine text");

    vi.unstubAllGlobals();
  });

  it("sends the non-mac cut shortcut with ctrl and falls back to writeText without ClipboardItem", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    const { writeText } = stubClipboard();
    const live = fakeLive();
    const view = render(<ComputerLiveStage live={live} interactive isMac={false} />);
    const textarea = view.getByLabelText("Computer keyboard input");

    fireEvent.cut(textarea);
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("machine text");
    });

    expect(live.perform).toHaveBeenCalledWith({ kind: "key", key: "x", modifiers: ["ctrl"] });

    vi.unstubAllGlobals();
  });

  it("lets ctrl/cmd+c/x/v keydowns fall through to native clipboard events instead of forwarding a keypress", () => {
    const live = fakeLive();
    const view = render(<ComputerLiveStage live={live} interactive isMac={false} />);
    const textarea = view.getByLabelText("Computer keyboard input");

    fireEvent.keyDown(textarea, { key: "c", ctrlKey: true });
    fireEvent.keyDown(textarea, { key: "v", metaKey: true });
    fireEvent.keyDown(textarea, { key: "x", ctrlKey: true });

    expect(live.perform).not.toHaveBeenCalled();
  });

  it("still forwards other ctrl shortcuts as key presses", () => {
    const live = fakeLive();
    const view = render(<ComputerLiveStage live={live} interactive isMac={false} />);
    const textarea = view.getByLabelText("Computer keyboard input");

    fireEvent.keyDown(textarea, { key: "a", ctrlKey: true });

    expect(live.perform).toHaveBeenCalledWith({ kind: "key", key: "a", modifiers: ["ctrl"] });
  });
});

describe("ComputerLiveStage cursor", () => {
  it("never shows the text caret cursor over the keyboard capture overlay", () => {
    const controllingView = render(
      <ComputerLiveStage live={fakeLive({ control: "you" })} interactive isMac={false} />,
    );
    expect(controllingView.getByLabelText("Computer keyboard input").className).toContain(
      "cursor-default",
    );
    controllingView.unmount();

    const watchingView = render(
      <ComputerLiveStage live={fakeLive({ control: "agent" })} interactive isMac={false} />,
    );
    expect(watchingView.getByLabelText("Computer keyboard input").className).toContain(
      "cursor-default",
    );
  });
});
