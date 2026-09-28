export const ALLOWED_TOOLS = [
  "get_desktop_state",
  "list_windows",
  "get_window_state",
  "zoom",
  "click",
  "double_click",
  "type_text",
  "set_value",
  "scroll",
  "hotkey",
  "press_key",
  "bring_to_front",
  "move_cursor",
  "drag",
  "clipboard_read",
  "clipboard_write",
  "start_recording",
  "stop_recording",
  "get_recording_state",
  "health_report",
  "browser_navigate",
  "browser_click",
  "browser_type",
  "browser_pointer",
  "get_browser_state",
  "browser_prepare",
] as const;

export interface WindowGrant {
  readonly pid: number;
  readonly windowId: number;
}

export interface CapabilityManifestOptions {
  readonly writablePaths: readonly string[];
  readonly windows: readonly WindowGrant[];
}

export function buildCapabilityManifest(options: CapabilityManifestOptions): Record<string, unknown> {
  return {
    version: 1,
    mode: "bounded",
    expires_after: "24h",
    idle_timeout: "1h",
    resources: {
      desktop: {
        display: true,
        windows: options.windows.map((window) => ({ pid: window.pid, window_id: window.windowId })),
      },
      files: { write: [...options.writablePaths] },
    },
    allow: { tools: [...ALLOWED_TOOLS] },
  };
}

const MAX_GRANTED_WINDOWS = 8;

export class WindowGrantSet {
  readonly #grants = new Map<string, WindowGrant>();

  has(pid: number, windowId: number): boolean {
    return this.#grants.has(`${pid}:${windowId}`);
  }

  add(pid: number, windowId: number): boolean {
    const key = `${pid}:${windowId}`;
    if (this.#grants.has(key)) return false;
    if (this.#grants.size >= MAX_GRANTED_WINDOWS) {
      const oldest = this.#grants.keys().next().value;
      if (oldest !== undefined) this.#grants.delete(oldest);
    }
    this.#grants.set(key, { pid, windowId });
    return true;
  }

  list(): WindowGrant[] {
    return [...this.#grants.values()];
  }
}

const MAX_GRANTED_PATHS = 8;

export class PathGrantSet {
  readonly #paths = new Set<string>();

  has(path: string): boolean {
    return this.#paths.has(path);
  }

  add(path: string): boolean {
    if (this.#paths.has(path)) return false;
    if (this.#paths.size >= MAX_GRANTED_PATHS) {
      const oldest = this.#paths.values().next().value;
      if (oldest !== undefined) this.#paths.delete(oldest);
    }
    this.#paths.add(path);
    return true;
  }

  list(): string[] {
    return [...this.#paths];
  }
}
