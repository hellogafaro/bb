import { describe, expect, it } from "vitest";
import {
  parseHeaderLines,
  parseStoredServerConfig,
  validateMcpServer,
} from "../../../src/services/mcp/config.js";
import { fetchRegistryServers } from "../../../src/services/mcp/registry.js";
import {
  oauthCallbackUrl,
  oauthRedirectBase,
  serverAccessPublicUrl,
} from "../../../src/services/mcp/oauth-redirect.js";

describe("direct MCP configs", () => {
  it("allows absolute command and PLUGIN_DATA cwd", () => {
    expect(
      validateMcpServer({
        type: "stdio",
        command: "/usr/bin/npx",
        args: ["-y", "demo"],
        cwd: "${PLUGIN_DATA}",
      }).valid,
    ).toBe(true);
  });

  it("rejects shell metacharacters", () => {
    expect(validateMcpServer({ type: "stdio", command: "npx; rm" }).valid).toBe(
      false,
    );
  });

  it("parses and validates cloud HTTP headers", () => {
    expect(
      parseHeaderLines(["Authorization: Bearer tok", "X-API-Key: abc"]),
    ).toEqual({
      Authorization: "Bearer tok",
      "X-API-Key": "abc",
    });
    expect(() => parseHeaderLines(["Authorization Bearer"])).toThrow(
      /Name: value/,
    );
    expect(
      validateMcpServer({
        type: "streamable-http",
        url: "https://mcp.example/mcp",
        headers: { Authorization: "Bearer tok" },
      }).valid,
    ).toBe(true);
  });

  it("parses stored configs into typed values and rejects invalid ones", () => {
    expect(
      parseStoredServerConfig(
        "docs",
        JSON.stringify({ type: "sse", url: "https://mcp.example/sse" }),
      ),
    ).toEqual({ type: "sse", url: "https://mcp.example/sse" });
    expect(() => parseStoredServerConfig("docs", "{")).toThrow(
      "invalid server config for docs",
    );
    expect(() =>
      parseStoredServerConfig(
        "docs",
        JSON.stringify({
          type: "streamable-http",
          url: "http://evil.example/mcp",
        }),
      ),
    ).toThrow("non-loopback url must be https");
  });
});

describe("official MCP registry client", () => {
  it("aborts offline registry fetches at the deadline and accepts caller cancellation", async () => {
    const fetchImpl: typeof fetch = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        if (signal.aborted) reject(signal.reason);
        else
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
      });
    await expect(
      fetchRegistryServers({ fetchImpl, timeoutMs: 20 }),
    ).rejects.toThrow();
    const controller = new AbortController();
    const pending = fetchRegistryServers({
      fetchImpl,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow();
  });

  it("forwards registry cursor and returns the next cursor", async () => {
    let requested = "";
    const fetchImpl: typeof fetch = async (url) => {
      requested = String(url);
      return new Response(
        JSON.stringify({ servers: [], metadata: { nextCursor: "page3" } }),
      );
    };
    const page = await fetchRegistryServers({ cursor: "page 2", fetchImpl });
    expect(new URL(requested).searchParams.get("cursor")).toBe("page 2");
    expect(page.nextCursor).toBe("page3");
  });
});

describe("OAuth redirect base", () => {
  it("prefers the app URL, then the public server URL, then loopback", () => {
    expect(
      oauthRedirectBase({
        appUrl: "https://app.example/",
        publicUrl: "https://connect.example",
        loopbackBaseUrl: "http://127.0.0.1:38886",
      }),
    ).toBe("https://app.example");
    expect(
      oauthRedirectBase({
        appUrl: null,
        publicUrl: "https://g4f4r0.getbb.app/",
        loopbackBaseUrl: "http://127.0.0.1:38886",
      }),
    ).toBe("https://g4f4r0.getbb.app");
    expect(
      oauthRedirectBase({
        appUrl: "  ",
        publicUrl: null,
        loopbackBaseUrl: "http://127.0.0.1:38886",
      }),
    ).toBe("http://127.0.0.1:38886");
  });

  it("reads the effective URL, then the default available provider", () => {
    const provider = (id: string, serverUrl: string) => ({
      id,
      displayName: id,
      description: "",
      pluginId: null,
      availability: { status: "available" as const, serverUrl },
    });
    expect(
      serverAccessPublicUrl({
        providers: [provider("connect", "https://g4f4r0.getbb.app")],
        defaultProviderId: "connect",
        effectiveUrl: "https://custom.example/",
        urlSource: "setting",
      }),
    ).toBe("https://custom.example");
    expect(
      serverAccessPublicUrl({
        providers: [
          {
            id: "direct",
            displayName: "Manual",
            description: "",
            pluginId: null,
            availability: null,
          },
          provider("other", "https://other.example"),
          provider("connect", "https://g4f4r0.getbb.app"),
        ],
        defaultProviderId: "connect",
        effectiveUrl: null,
        urlSource: null,
      }),
    ).toBe("https://g4f4r0.getbb.app");
  });

  it("builds the core callback URL with the server id", () => {
    expect(
      oauthCallbackUrl("https://g4f4r0.getbb.app", "mcp_abc").toString(),
    ).toBe("https://g4f4r0.getbb.app/api/v1/mcp/oauth/callback?id=mcp_abc");
  });
});
