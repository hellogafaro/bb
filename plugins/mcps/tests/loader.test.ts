import { describe, expect, it } from "vitest";
import { parseHeaderLines, validateMcpServer } from "../src/loader.js";

describe("direct MCP configs", () => {
  it("allows absolute command and PLUGIN_DATA cwd", () => {
    const result = validateMcpServer("mcp", {
      type: "stdio",
      command: "/usr/bin/npx",
      args: ["-y", "demo"],
      cwd: "${PLUGIN_DATA}",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects shell metacharacters", () => {
    expect(validateMcpServer("mcp", { type: "stdio", command: "npx; rm" }).valid).toBe(false);
  });

  it("parses and validates cloud HTTP headers", () => {
    expect(parseHeaderLines(["Authorization: Bearer tok", "X-API-Key: abc"])).toEqual({
      Authorization: "Bearer tok",
      "X-API-Key": "abc",
    });
    expect(() => parseHeaderLines(["Authorization Bearer"])).toThrow(/Name: value/);
    const result = validateMcpServer("mcp", {
      type: "streamable-http",
      url: "https://mcp.example/mcp",
      headers: { Authorization: "Bearer tok" },
    });
    expect(result.valid).toBe(true);
  });
});
