import { describe, expect, it } from "vitest";
import { cuaEnv, parseCuaResult } from "./cua-transport.js";

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
