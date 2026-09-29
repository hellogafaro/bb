import { describe, expect, it } from "vitest";
import {
  CuaError,
  cuaEnv,
  extractDesktopImage,
  extractMcpImage,
  isLapsedManifestError,
  parseCuaResult,
  RenewingCuaTransport,
  type CuaToolResult,
  type CuaTransport,
  type ManifestRenewalHooks,
} from "./computer-transport.js";

describe("parseCuaResult", () => {
  it("unwraps structuredContent from a result envelope", () => {
    const result = parseCuaResult(JSON.stringify({ result: { structuredContent: { windows: [] } } }));
    expect(result.structuredContent).toEqual({ windows: [] });
  });

  it("treats a bare object with no content/structuredContent/refusal as direct structured content", () => {
    const result = parseCuaResult(JSON.stringify({ pid: 1, window_id: 2 }));
    expect(result.structuredContent).toEqual({ pid: 1, window_id: 2 });
  });

  it("surfaces a capability-manifest refusal as an error with a text part", () => {
    const result = parseCuaResult(JSON.stringify({ refusal: { message: "denied by manifest" } }));
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toBe("denied by manifest");
  });

  it("passes through an explicit isError flag", () => {
    const result = parseCuaResult(JSON.stringify({ isError: true, content: [{ type: "text", text: "boom" }] }));
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toBe("boom");
  });
});

describe("cuaEnv", () => {
  it("never forwards unrelated environment variables", () => {
    const env = cuaEnv({ PATH: "/bin", DISPLAY: ":99", SECRET_TOKEN: "leak-me" });
    expect(env).toEqual({
      PATH: "/bin",
      HOME: "",
      DISPLAY: ":99",
      WAYLAND_DISPLAY: "",
      XDG_RUNTIME_DIR: "",
      DBUS_SESSION_BUS_ADDRESS: "",
      XAUTHORITY: "",
    });
  });
});

describe("isLapsedManifestError", () => {
  it("recognizes the idle timeout message the production driver returned", () => {
    const error = new CuaError("Policy loading error: capability manifest idle timeout exceeded", "provider-unavailable");
    expect(isLapsedManifestError(error)).toBe(true);
  });

  it("recognizes an expired capability manifest", () => {
    const error = new CuaError("capability manifest has expired", "provider-unavailable");
    expect(isLapsedManifestError(error)).toBe(true);
  });

  it("does not flag unrelated driver errors", () => {
    const error = new CuaError("stale observation: window no longer visible", "stale-observation");
    expect(isLapsedManifestError(error)).toBe(false);
  });
});

describe("extractMcpImage", () => {
  it("reads an image content item from a realistic MCP tools/call response", () => {
    const result: CuaToolResult = {
      content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
    };
    expect(extractMcpImage(result)).toEqual({ base64: "aGVsbG8=", mimeType: "image/png" });
  });

  it("returns null when there is no image content item", () => {
    expect(extractMcpImage({ content: [{ type: "text", text: "no image" }] })).toBeNull();
  });
});

describe("extractDesktopImage", () => {
  it("prefers the MCP image content item over structuredContent fields", () => {
    const result: CuaToolResult = {
      structuredContent: { screenshot_width: 1280, screenshot_height: 800, screenshot_png_b64: "" },
      content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
    };
    const image = extractDesktopImage(result);
    expect(image).toEqual({
      base64: "aGVsbG8=",
      mimeType: "image/png",
      width: 1280,
      height: 800,
      originalWidth: 1280,
      originalHeight: 800,
    });
  });

  it("falls back to structuredContent.screenshot_png_b64 for the one-shot transport", () => {
    const result: CuaToolResult = {
      structuredContent: {
        screenshot_width: 640,
        screenshot_height: 480,
        screenshot_png_b64: "aGVsbG8=",
        screenshot_mime_type: "image/png",
      },
    };
    expect(extractDesktopImage(result)?.base64).toBe("aGVsbG8=");
  });

  it("returns null for an empty capture instead of a zero-size image", () => {
    const result: CuaToolResult = {
      structuredContent: { screenshot_width: 0, screenshot_height: 0, screenshot_png_b64: "" },
    };
    expect(extractDesktopImage(result)).toBeNull();
  });
});

function hooks(overrides: Partial<ManifestRenewalHooks> = {}): ManifestRenewalHooks & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    ensureFresh: overrides.ensureFresh ?? (async () => { calls.push("ensureFresh"); }),
    renewAfterLapse: overrides.renewAfterLapse ?? (async () => { calls.push("renewAfterLapse"); }),
    noteSuccess: overrides.noteSuccess ?? (() => { calls.push("noteSuccess"); }),
  };
}

describe("RenewingCuaTransport", () => {
  it("checks manifest freshness before every call and reports success", async () => {
    const renewalHooks = hooks();
    const inner: CuaTransport = { call: async () => ({ structuredContent: {} }) };
    const transport = new RenewingCuaTransport(inner, renewalHooks);
    await transport.call("health_report", {}, new AbortController().signal);
    expect(renewalHooks.calls).toEqual(["ensureFresh", "noteSuccess"]);
  });

  it("renews and retries once when the driver reports a lapsed capability manifest", async () => {
    const renewalHooks = hooks();
    let attempts = 0;
    const inner: CuaTransport = {
      call: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new CuaError("Policy loading error: capability manifest idle timeout exceeded", "provider-unavailable");
        }
        return { structuredContent: { ok: true } };
      },
    };
    const transport = new RenewingCuaTransport(inner, renewalHooks);
    const result = await transport.call("health_report", {}, new AbortController().signal);
    expect(result.structuredContent).toEqual({ ok: true });
    expect(attempts).toBe(2);
    expect(renewalHooks.calls).toEqual(["ensureFresh", "renewAfterLapse", "noteSuccess"]);
  });

  it("propagates non-lapsed errors without renewing or retrying", async () => {
    const renewalHooks = hooks();
    let attempts = 0;
    const inner: CuaTransport = {
      call: async () => {
        attempts += 1;
        throw new CuaError("stale observation: window no longer visible", "stale-observation");
      },
    };
    const transport = new RenewingCuaTransport(inner, renewalHooks);
    await expect(transport.call("click", {}, new AbortController().signal)).rejects.toThrow(/stale observation/);
    expect(attempts).toBe(1);
    expect(renewalHooks.calls).toEqual(["ensureFresh"]);
  });

  it("forwards close() to a closable inner transport", () => {
    let closed = false;
    const inner: CuaTransport & { close(): void } = {
      call: async () => ({}),
      close: () => {
        closed = true;
      },
    };
    const transport = new RenewingCuaTransport(inner, hooks());
    transport.close();
    expect(closed).toBe(true);
  });
});
