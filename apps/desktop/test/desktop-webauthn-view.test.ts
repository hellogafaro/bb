import type { WebContentsView } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BB_DESKTOP_WEBAUTHN_PROMPT_ACTION_CHANNEL } from "../src/webauthn-prompt-ipc.js";
import {
  createDesktopWebauthnViewManager,
  type WebauthnViewBounds,
  type WebauthnViewHostContentView,
  type WebauthnViewHostWindow,
} from "../src/desktop-webauthn-view.js";
import { WEBAUTHN_PROMPT_VIEW_HEIGHT } from "../src/webauthn-prompt-view.js";

const electronMock = vi.hoisted(() => {
  interface FakeIpcEvent {
    sender: { id: number };
  }
  type FakeIpcListener = (event: FakeIpcEvent, payload: unknown) => void;
  const listeners = new Map<string, FakeIpcListener>();

  class FakeWebContentsView {
    public bounds: WebauthnViewBounds | null = null;
    public visible: boolean | null = null;
    public destroyed = false;
    public readonly sendCalls: { channel: string; payload?: unknown }[] = [];
    public readonly webContents;

    constructor() {
      this.webContents = {
        id: FakeWebContentsView.nextId++,
        isDestroyed: () => this.destroyed,
        send: (channel: string, payload?: unknown) => {
          this.sendCalls.push({ channel, payload });
        },
        loadURL: async () => {},
        close: () => {
          this.destroyed = true;
        },
      };
    }

    static nextId = 1;

    setBackgroundColor(): void {}

    setBounds(bounds: WebauthnViewBounds): void {
      this.bounds = bounds;
    }

    setVisible(visible: boolean): void {
      this.visible = visible;
    }
  }

  const createdViews: FakeWebContentsView[] = [];

  return {
    createdViews,
    listeners,
    WebContentsView: class extends FakeWebContentsView {
      constructor() {
        super();
        createdViews.push(this);
      }
    },
    ipcMain: {
      on(channel: string, listener: FakeIpcListener): void {
        listeners.set(channel, listener);
      },
    },
  };
});

vi.mock("electron", () => ({
  ipcMain: electronMock.ipcMain,
  WebContentsView: electronMock.WebContentsView,
}));

class FakeContentView implements WebauthnViewHostContentView {
  public readonly views: object[] = [];

  addChildView(view: WebContentsView): void {
    this.views.push(view);
  }

  removeChildView(view: WebContentsView): void {
    const index = this.views.indexOf(view);
    if (index >= 0) this.views.splice(index, 1);
  }
}

class FakeHostWindow implements WebauthnViewHostWindow {
  readonly contentView = new FakeContentView();
  readonly webContents = { id: 7 };
}

const TAB_BOUNDS: WebauthnViewBounds = {
  x: 10,
  y: 20,
  width: 900,
  height: 600,
};

describe("createDesktopWebauthnViewManager", () => {
  beforeEach(() => {
    electronMock.listeners.clear();
    electronMock.createdViews.length = 0;
  });

  it("opens a banner docked to the top of the tab bounds and pushes the initial state", () => {
    const host = new FakeHostWindow();
    const manager = createDesktopWebauthnViewManager({
      preloadPath: "/tmp/webauthn-prompt-preload.cjs",
      onAction: vi.fn(),
    });

    manager.open({
      hostWindow: host,
      tabId: "tab-1",
      tabBounds: TAB_BOUNDS,
      state: { stage: "ask", host: "example.com", browserLabel: "Chrome" },
    });

    const view = electronMock.createdViews.at(-1);
    expect(view?.bounds).toEqual({
      x: TAB_BOUNDS.x,
      y: TAB_BOUNDS.y,
      width: TAB_BOUNDS.width,
      height: WEBAUTHN_PROMPT_VIEW_HEIGHT,
    });
    expect(host.contentView.views).toEqual([view]);
    expect(view?.visible).toBe(true);
    expect(view?.sendCalls.at(-1)).toMatchObject({
      payload: { stage: "ask", host: "example.com", browserLabel: "Chrome" },
    });
  });

  it("reuses the same view across repeated opens for the same tab", () => {
    const host = new FakeHostWindow();
    const manager = createDesktopWebauthnViewManager({
      preloadPath: "/tmp/webauthn-prompt-preload.cjs",
      onAction: vi.fn(),
    });

    manager.open({
      hostWindow: host,
      tabId: "tab-1",
      tabBounds: TAB_BOUNDS,
      state: { stage: "ask", host: "example.com", browserLabel: "Chrome" },
    });
    manager.open({
      hostWindow: host,
      tabId: "tab-1",
      tabBounds: TAB_BOUNDS,
      state: { stage: "handoff", host: "example.com", browserLabel: "Chrome" },
    });

    expect(electronMock.createdViews.length).toBe(1);
  });

  it("routes a button action from the prompt's own webContents back to the right tab", () => {
    const host = new FakeHostWindow();
    const onAction = vi.fn();
    const manager = createDesktopWebauthnViewManager({
      preloadPath: "/tmp/webauthn-prompt-preload.cjs",
      onAction,
    });
    manager.open({
      hostWindow: host,
      tabId: "tab-1",
      tabBounds: TAB_BOUNDS,
      state: { stage: "ask", host: "example.com", browserLabel: "Chrome" },
    });
    const view = electronMock.createdViews.at(-1);
    const listener = electronMock.listeners.get(
      BB_DESKTOP_WEBAUTHN_PROMPT_ACTION_CHANNEL,
    );
    expect(listener).toBeDefined();

    listener?.({ sender: { id: view!.webContents.id } }, { action: "cancel" });

    expect(onAction).toHaveBeenCalledWith({
      hostWindow: host,
      tabId: "tab-1",
      action: "cancel",
    });
  });

  it("ignores malformed action payloads and events from unknown senders", () => {
    const host = new FakeHostWindow();
    const onAction = vi.fn();
    const manager = createDesktopWebauthnViewManager({
      preloadPath: "/tmp/webauthn-prompt-preload.cjs",
      onAction,
    });
    manager.open({
      hostWindow: host,
      tabId: "tab-1",
      tabBounds: TAB_BOUNDS,
      state: { stage: "ask", host: "example.com", browserLabel: "Chrome" },
    });
    const view = electronMock.createdViews.at(-1);
    const listener = electronMock.listeners.get(
      BB_DESKTOP_WEBAUTHN_PROMPT_ACTION_CHANNEL,
    );

    listener?.(
      { sender: { id: view!.webContents.id } },
      { action: "not-a-real-action" },
    );
    listener?.({ sender: { id: 99999 } }, { action: "cancel" });

    expect(onAction).not.toHaveBeenCalled();
  });

  it("closes and destroys the view, leaving the host's content view clean", () => {
    const host = new FakeHostWindow();
    const manager = createDesktopWebauthnViewManager({
      preloadPath: "/tmp/webauthn-prompt-preload.cjs",
      onAction: vi.fn(),
    });
    manager.open({
      hostWindow: host,
      tabId: "tab-1",
      tabBounds: TAB_BOUNDS,
      state: { stage: "ask", host: "example.com", browserLabel: "Chrome" },
    });
    const view = electronMock.createdViews.at(-1);

    manager.close(host, "tab-1");

    expect(host.contentView.views).toEqual([]);
    expect(view?.destroyed).toBe(true);
  });

  it("releaseWindow disposes every prompt attached to that host window", () => {
    const host = new FakeHostWindow();
    const manager = createDesktopWebauthnViewManager({
      preloadPath: "/tmp/webauthn-prompt-preload.cjs",
      onAction: vi.fn(),
    });
    manager.open({
      hostWindow: host,
      tabId: "tab-1",
      tabBounds: TAB_BOUNDS,
      state: { stage: "ask", host: "example.com", browserLabel: "Chrome" },
    });
    manager.open({
      hostWindow: host,
      tabId: "tab-2",
      tabBounds: TAB_BOUNDS,
      state: { stage: "ask", host: "example.com", browserLabel: "Chrome" },
    });

    manager.releaseWindow(host.webContents.id);

    expect(host.contentView.views).toEqual([]);
    expect(electronMock.createdViews.every((view) => view.destroyed)).toBe(
      true,
    );
  });

  it("layout repositions an open prompt to follow the tab's new bounds", () => {
    const host = new FakeHostWindow();
    const manager = createDesktopWebauthnViewManager({
      preloadPath: "/tmp/webauthn-prompt-preload.cjs",
      onAction: vi.fn(),
    });
    manager.open({
      hostWindow: host,
      tabId: "tab-1",
      tabBounds: TAB_BOUNDS,
      state: { stage: "ask", host: "example.com", browserLabel: "Chrome" },
    });
    const view = electronMock.createdViews.at(-1);
    const nextBounds: WebauthnViewBounds = {
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    };

    manager.layout({ hostWindow: host, tabId: "tab-1", tabBounds: nextBounds });

    expect(view?.bounds).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: WEBAUTHN_PROMPT_VIEW_HEIGHT,
    });
  });
});
