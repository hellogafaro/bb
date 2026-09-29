import { WebContentsView, ipcMain, type IpcMainEvent } from "electron";
import {
  BB_DESKTOP_WEBAUTHN_PROMPT_ACTION_CHANNEL,
  BB_DESKTOP_WEBAUTHN_PROMPT_STATE_CHANNEL,
  webauthnPromptActionRequestSchema,
  type WebauthnPromptState,
} from "./webauthn-prompt-ipc.js";
import {
  WEBAUTHN_PROMPT_VIEW_HEIGHT,
  createWebauthnPromptViewUrl,
} from "./webauthn-prompt-view.js";

export interface WebauthnViewBounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface WebauthnViewHostContentView {
  addChildView(view: WebContentsView): void;
  removeChildView(view: WebContentsView): void;
}

export interface WebauthnViewHostWindow {
  contentView: WebauthnViewHostContentView;
  webContents: { id: number };
}

export interface WebauthnPromptActionArgs {
  hostWindow: WebauthnViewHostWindow;
  tabId: string;
  action: "dismiss";
}

export interface CreateDesktopWebauthnViewManagerArgs {
  preloadPath: string;
  onAction: (args: WebauthnPromptActionArgs) => void;
}

export interface DesktopWebauthnViewManager {
  open(args: {
    hostWindow: WebauthnViewHostWindow;
    tabId: string;
    tabBounds: WebauthnViewBounds;
    state: WebauthnPromptState;
  }): void;
  setState(args: {
    hostWindow: WebauthnViewHostWindow;
    tabId: string;
    state: WebauthnPromptState;
  }): void;
  layout(args: {
    hostWindow: WebauthnViewHostWindow;
    tabId: string;
    tabBounds: WebauthnViewBounds;
  }): void;
  close(hostWindow: WebauthnViewHostWindow, tabId: string): void;
  releaseWindow(hostWebContentsId: number): void;
  destroyAll(): void;
}

interface WebauthnViewEntry {
  hostWindow: WebauthnViewHostWindow;
  tabId: string;
  view: WebContentsView;
}

function entryKey(hostWindow: WebauthnViewHostWindow, tabId: string): string {
  return `${hostWindow.webContents.id}:${tabId}`;
}

function promptViewBounds(tabBounds: WebauthnViewBounds): WebauthnViewBounds {
  return {
    x: tabBounds.x,
    y: tabBounds.y,
    width: tabBounds.width,
    height: Math.min(WEBAUTHN_PROMPT_VIEW_HEIGHT, tabBounds.height),
  };
}

export function createDesktopWebauthnViewManager({
  preloadPath,
  onAction,
}: CreateDesktopWebauthnViewManagerArgs): DesktopWebauthnViewManager {
  const entriesByKey = new Map<string, WebauthnViewEntry>();
  const entriesByViewId = new Map<number, WebauthnViewEntry>();

  function createEntry(
    hostWindow: WebauthnViewHostWindow,
    tabId: string,
  ): WebauthnViewEntry {
    const view = new WebContentsView({
      webPreferences: {
        preload: preloadPath,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    void view.webContents.loadURL(createWebauthnPromptViewUrl());
    const entry: WebauthnViewEntry = { hostWindow, tabId, view };
    entriesByKey.set(entryKey(hostWindow, tabId), entry);
    entriesByViewId.set(view.webContents.id, entry);
    hostWindow.contentView.addChildView(view);
    return entry;
  }

  function destroyEntry(entry: WebauthnViewEntry): void {
    entriesByKey.delete(entryKey(entry.hostWindow, entry.tabId));
    entriesByViewId.delete(entry.view.webContents.id);
    entry.hostWindow.contentView.removeChildView(entry.view);
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.webContents.close();
    }
  }

  function entryForEvent(event: IpcMainEvent): WebauthnViewEntry | null {
    return entriesByViewId.get(event.sender.id) ?? null;
  }

  ipcMain.on(
    BB_DESKTOP_WEBAUTHN_PROMPT_ACTION_CHANNEL,
    (event, payload: unknown) => {
      const entry = entryForEvent(event);
      if (entry === null) {
        return;
      }
      const parsed = webauthnPromptActionRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      onAction({
        hostWindow: entry.hostWindow,
        tabId: entry.tabId,
        action: parsed.data.action,
      });
    },
  );

  return {
    open({ hostWindow, tabId, tabBounds, state }) {
      const existing = entriesByKey.get(entryKey(hostWindow, tabId));
      const entry = existing ?? createEntry(hostWindow, tabId);
      hostWindow.contentView.removeChildView(entry.view);
      hostWindow.contentView.addChildView(entry.view);
      entry.view.setBounds(promptViewBounds(tabBounds));
      entry.view.setVisible(true);
      entry.view.webContents.send(
        BB_DESKTOP_WEBAUTHN_PROMPT_STATE_CHANNEL,
        state,
      );
    },
    setState({ hostWindow, tabId, state }) {
      const entry = entriesByKey.get(entryKey(hostWindow, tabId));
      if (entry === undefined || entry.view.webContents.isDestroyed()) {
        return;
      }
      entry.view.webContents.send(
        BB_DESKTOP_WEBAUTHN_PROMPT_STATE_CHANNEL,
        state,
      );
    },
    layout({ hostWindow, tabId, tabBounds }) {
      const entry = entriesByKey.get(entryKey(hostWindow, tabId));
      if (entry === undefined) {
        return;
      }
      entry.view.setBounds(promptViewBounds(tabBounds));
    },
    close(hostWindow, tabId) {
      const entry = entriesByKey.get(entryKey(hostWindow, tabId));
      if (entry === undefined) {
        return;
      }
      destroyEntry(entry);
    },
    releaseWindow(hostWebContentsId) {
      for (const entry of [...entriesByKey.values()]) {
        if (entry.hostWindow.webContents.id === hostWebContentsId) {
          destroyEntry(entry);
        }
      }
    },
    destroyAll() {
      for (const entry of [...entriesByKey.values()]) {
        destroyEntry(entry);
      }
    },
  };
}
