import { describe, expect, it, vi } from "vitest";
import { installStaleBuildRecovery } from "./stale-build-recovery";

function fakeWindow() {
  const listeners = new Map<string, (event: Event) => void>();
  const store = new Map<string, string>();
  const reload = vi.fn();
  installStaleBuildRecovery({
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.set(type, listener as (event: Event) => void);
    },
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    } as Storage,
    location: { reload },
  });
  const fire = (message: string) => {
    const event = new Event("vite:preloadError", { cancelable: true }) as Event & {
      payload: Error;
    };
    event.payload = new Error(message);
    listeners.get("vite:preloadError")?.(event);
    return event;
  };
  return { fire, reload };
}

describe("installStaleBuildRecovery", () => {
  it("reloads once when a chunk from a previous build fails to load", () => {
    const { fire, reload } = fakeWindow();
    const event = fire(
      "Failed to fetch dynamically imported module: https://bb.test/assets/FileEditor-old.js",
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("does not loop when the same module keeps failing after a reload", () => {
    const { fire, reload } = fakeWindow();
    fire("Failed to fetch dynamically imported module: https://bb.test/assets/FileEditor-old.js");
    const second = fire(
      "Failed to fetch dynamically imported module: https://bb.test/assets/FileEditor-old.js",
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);
  });
});
