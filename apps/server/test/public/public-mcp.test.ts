import { afterEach, describe, expect, it, vi } from "vitest";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import { mcpHostFixture, waitFor } from "../services/mcp/harness.js";

const oauthOrigin = "https://oauth.example";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function request(
  harness: TestAppHarness,
  path: string,
  init?: { method?: string; body?: unknown },
) {
  return harness.app.request(`/api/v1/mcp${path}`, {
    method: init?.method ?? "GET",
    ...(init?.body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(init.body),
        }),
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("expected a JSON object");
  return Object.fromEntries(Object.entries(value));
}

function jsonResponse(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(input instanceof Request ? input.url : input.toString());
}

function stubRegistry() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.origin !== "https://registry.modelcontextprotocol.io")
        return new Response(null, { status: 404 });
      return jsonResponse({
        servers: [
          {
            server: {
              name: "io.example/http",
              description: "Remote example",
              version: "1.0.0",
              remotes: [
                {
                  type: "streamable-http",
                  url: "https://mcp.example/mcp",
                  headers: [
                    { name: "Authorization", isRequired: true, isSecret: true },
                  ],
                },
              ],
            },
          },
          {
            server: {
              name: "io.example/npm",
              description: "Package example",
              version: "2.0.0",
              packages: [
                {
                  registryType: "npm",
                  identifier: "@example/mcp",
                  version: "2.0.0",
                },
              ],
            },
          },
        ],
      });
    }),
  );
}

function stubOAuthServer() {
  const state = {
    registrations: [] as Array<Record<string, unknown>>,
    tokenRequests: [] as URLSearchParams[],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.origin !== oauthOrigin)
        return new Response(null, { status: 404 });
      if (url.pathname.startsWith("/.well-known/oauth-protected-resource"))
        return jsonResponse({
          resource: `${oauthOrigin}/mcp`,
          authorization_servers: [oauthOrigin],
        });
      if (url.pathname.startsWith("/.well-known/")) {
        return jsonResponse({
          issuer: oauthOrigin,
          authorization_endpoint: `${oauthOrigin}/authorize`,
          token_endpoint: `${oauthOrigin}/token`,
          registration_endpoint: `${oauthOrigin}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
        });
      }
      if (url.pathname === "/register") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        state.registrations.push(body);
        return jsonResponse({ ...body, client_id: "fixture-client" }, 201);
      }
      if (url.pathname === "/token") {
        const params = new URLSearchParams(String(init?.body));
        state.tokenRequests.push(params);
        if (
          params.get("grant_type") !== "authorization_code" ||
          params.get("code") !== "good-code" ||
          !params.get("code_verifier")
        ) {
          return jsonResponse({ error: "invalid_grant" }, 400);
        }
        return jsonResponse({
          access_token: "access-1",
          refresh_token: "refresh-1",
          token_type: "Bearer",
        });
      }
      if (url.pathname !== "/mcp") return new Response(null, { status: 404 });
      if (
        new Headers(init?.headers).get("authorization") !== "Bearer access-1"
      ) {
        return jsonResponse({}, 401, {
          "www-authenticate": `Bearer resource_metadata="${oauthOrigin}/.well-known/oauth-protected-resource/mcp"`,
        });
      }
      if (init?.method !== "POST") return new Response(null, { status: 405 });
      const message = JSON.parse(String(init.body)) as {
        id?: unknown;
        method?: string;
      };
      if (message.id === undefined) return new Response(null, { status: 202 });
      if (message.method === "server/discover")
        return jsonResponse({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "Method not found" },
        });
      if (message.method === "initialize") {
        return jsonResponse(
          {
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: "2025-11-25",
              capabilities: { tools: {} },
              serverInfo: { name: "secure", version: "1" },
            },
          },
          200,
          { "mcp-session-id": "session-1" },
        );
      }
      if (message.method === "tools/list")
        return jsonResponse({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            tools: [
              {
                name: "whoami",
                inputSchema: { type: "object" },
                annotations: { readOnlyHint: true },
              },
            ],
          },
        });
      return jsonResponse({ jsonrpc: "2.0", id: message.id, result: {} });
    }),
  );
  return state;
}

describe("MCP routes", () => {
  it("starts empty, then adds, lists, shows, configures, and removes servers with realtime changes", async () => {
    await withTestHarness(async (harness) => {
      const notify = vi.spyOn(harness.hub, "notifyMcp");
      expect(await json(await request(harness, "/servers"))).toEqual({
        servers: [],
      });

      const added = await request(harness, "/servers", {
        method: "POST",
        body: {
          kind: "http",
          name: "cloud",
          url: "https://mcp.example/mcp",
          transport: "streamable-http",
          headers: { Authorization: "Bearer tok" },
        },
      });
      expect(added.status).toBe(201);
      const created = await json(added);
      expect(created).toMatchObject({
        id: expect.stringMatching(/^mcp_[a-z0-9]{10}$/),
        handle: "cloud",
        name: "cloud",
      });
      expect(notify).toHaveBeenLastCalledWith(created.id, ["servers-changed"]);

      expect(await json(await request(harness, "/servers"))).toEqual({
        servers: [
          {
            id: created.id,
            handle: "cloud",
            type: "streamable-http",
            status: "idle",
          },
        ],
      });
      const details = await json(
        await request(harness, "/servers?details=true"),
      );
      expect(details.servers).toEqual([
        expect.objectContaining({
          handle: "cloud",
          enabled: true,
          sourceKind: "manual",
          config: {
            type: "streamable-http",
            url: "https://mcp.example/mcp",
            headers: { Authorization: "***" },
          },
        }),
      ]);
      expect(
        await json(await request(harness, `/servers/${String(created.id)}`)),
      ).toMatchObject({ handle: "cloud" });
      expect((await request(harness, "/servers/missing")).status).toBe(404);

      const stdio = await json(
        await request(harness, "/servers", {
          method: "POST",
          body: {
            kind: "stdio",
            name: "Local Tools",
            command: "node",
            args: ["server.js"],
          },
        }),
      );
      expect(stdio.handle).toBe("local_tools");
      expect(
        await json(await request(harness, "/servers/Local%20Tools")),
      ).toMatchObject({
        handle: "local_tools",
        config: {
          type: "stdio",
          command: "node",
          args: ["server.js"],
          cwd: "${PLUGIN_DATA}",
          env: {},
        },
      });
      expect(
        (
          await request(harness, "/servers", {
            method: "POST",
            body: {
              kind: "http",
              url: "http://evil.example/mcp",
              transport: "sse",
            },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await request(harness, "/servers", {
            method: "POST",
            body: { kind: "stdio", name: "bad", command: "npx; rm", args: [] },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await request(harness, "/servers", {
            method: "POST",
            body: { kind: "ftp" },
          })
        ).status,
      ).toBe(400);

      expect(
        await json(
          await request(harness, "/servers/cloud/enabled", {
            method: "PUT",
            body: { enabled: false },
          }),
        ),
      ).toEqual({ enabled: false, status: "disabled" });
      expect(
        await json(
          await request(harness, "/servers/cloud/enabled", {
            method: "PUT",
            body: { enabled: true },
          }),
        ),
      ).toEqual({ enabled: true, status: "idle" });
      expect(
        await json(
          await request(harness, "/servers/cloud/headers", {
            method: "PUT",
            body: { headers: { "X-Key": "abc" } },
          }),
        ),
      ).toMatchObject({ config: { headers: { "X-Key": "***" } } });
      expect(
        (
          await request(harness, "/servers/local_tools/headers", {
            method: "PUT",
            body: { headers: {} },
          })
        ).status,
      ).toBe(400);
      expect(
        await json(
          await request(harness, "/servers/cloud/guide", {
            method: "PUT",
            body: { guide: "  Use the docs space.  " },
          }),
        ),
      ).toEqual({
        id: created.id,
        handle: "cloud",
        guide: "Use the docs space.",
      });
      expect(
        (
          await request(harness, "/servers/cloud/guide", {
            method: "PUT",
            body: { guide: "x".repeat(4001) },
          })
        ).status,
      ).toBe(400);
      expect(
        await json(
          await request(harness, "/servers/cloud/guide", {
            method: "PUT",
            body: { guide: null },
          }),
        ),
      ).toMatchObject({ guide: null });

      expect(
        await json(
          await request(harness, "/servers/cloud", { method: "DELETE" }),
        ),
      ).toEqual({ deleted: true, id: created.id });
      expect((await request(harness, "/servers/cloud")).status).toBe(404);
      expect(
        (await request(harness, "/servers/cloud", { method: "DELETE" })).status,
      ).toBe(404);
    });
  });

  it("searches the official registry and adds a registry server", async () => {
    stubRegistry();
    await withTestHarness(async (harness) => {
      const hits = await json(
        await request(harness, "/registry?q=example&remoteOnly=true"),
      );
      expect(hits.servers).toEqual([
        expect.objectContaining({
          name: "io.example/http",
          remote: true,
          installable: true,
          type: "streamable-http",
          requiredHeaders: ["Authorization"],
        }),
      ]);
      const added = await json(
        await request(harness, "/servers", {
          method: "POST",
          body: {
            kind: "registry",
            registryName: "io.example/npm",
            name: "pkg",
          },
        }),
      );
      const shown = await json(
        await request(harness, `/servers/${String(added.id)}`),
      );
      expect(shown).toMatchObject({
        handle: "pkg",
        sourceKind: "registry",
        registryName: "io.example/npm",
        registryVersion: "2.0.0",
        sourceRef: "npm:@example/mcp@2.0.0",
        config: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@example/mcp@2.0.0"],
        },
      });
      expect(
        (
          await request(harness, "/servers", {
            method: "POST",
            body: { kind: "registry", registryName: "io.example/missing" },
          })
        ).status,
      ).toBe(404);
      expect((await request(harness, "/registry")).status).toBe(400);
    });
  });

  it("searches, inspects, calls, and sets policies for tools on a stdio server", async () => {
    await withTestHarness(async (harness) => {
      const host = mcpHostFixture(harness);
      await request(harness, "/servers", {
        method: "POST",
        body: { kind: "stdio", name: "notes", command: "node", args: [] },
      });
      const search = await json(
        await request(harness, "/tools/search?q=notes&limit=50"),
      );
      const tools = search.tools as Array<{ id: string; name: string }>;
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "drop_notes",
        "read_notes",
        "write_note",
      ]);
      const readId = tools.find((tool) => tool.name === "read_notes")?.id;
      const writeId = tools.find((tool) => tool.name === "write_note")?.id;
      expect(
        await json(await request(harness, `/tools/${String(readId)}/schema`)),
      ).toMatchObject({
        name: "read_notes",
        risk: "read",
        inputSchema: { type: "object" },
      });
      expect(
        await json(await request(harness, "/servers/notes/tools")),
      ).toMatchObject({
        error: null,
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "write_note", risk: "write" }),
        ]),
      });

      expect(
        await json(
          await request(harness, "/tools/call", {
            method: "POST",
            body: { id: readId, args: {}, threadId: null },
          }),
        ),
      ).toEqual({ content: [{ type: "text", text: "ran read_notes" }] });
      const refused = await json(
        await request(harness, "/tools/call", {
          method: "POST",
          body: { id: writeId, args: {}, threadId: null },
        }),
      );
      expect(refused).toMatchObject({
        isError: true,
        error: expect.stringContaining("can only run from a BB thread"),
      });
      expect(
        (
          await request(harness, "/tools/call", {
            method: "POST",
            body: { id: readId, args: {}, threadId: "thr_missing" },
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await request(harness, "/tools/call", {
            method: "POST",
            body: { id: "mcpt_0123456789", args: {}, threadId: null },
          })
        ).status,
      ).toBe(422);
      expect(host.ran).toEqual(["read_notes"]);

      const policies = await json(
        await request(harness, "/servers/notes/policies"),
      );
      expect(policies.tools).toEqual([
        {
          tool: "drop_notes",
          risk: "destructive",
          mode: "inherit",
          policy: "confirm",
        },
        { tool: "read_notes", risk: "read", mode: "inherit", policy: "allow" },
        {
          tool: "write_note",
          risk: "write",
          mode: "inherit",
          policy: "confirm",
        },
      ]);
      expect(
        await json(
          await request(harness, "/servers/notes/policies", {
            method: "PUT",
            body: { tool: "write_note", mode: "allow" },
          }),
        ),
      ).toEqual({
        tool: "write_note",
        risk: "write",
        mode: "allow",
        policy: "allow",
      });
      expect(
        (
          await request(harness, "/servers/notes/policies", {
            method: "PUT",
            body: { tool: "write_note", mode: "sometimes" },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await request(harness, "/servers/notes/policies", {
            method: "PUT",
            body: { tool: "missing", mode: "deny" },
          })
        ).status,
      ).toBe(404);
      expect(
        await json(
          await request(harness, "/tools/call", {
            method: "POST",
            body: { id: writeId, args: {}, threadId: host.threadId },
          }),
        ),
      ).toEqual({ content: [{ type: "text", text: "ran write_note" }] });

      expect(await json(await request(harness, "/prompts?q=anything"))).toEqual(
        { prompts: [] },
      );
      expect(await json(await request(harness, "/resources"))).toEqual({
        resources: [],
      });
      expect(
        (
          await request(harness, "/prompts/get", {
            method: "POST",
            body: { id: "mcpp_0123456789", args: {} },
          })
        ).status,
      ).toBe(422);
    });
  });

  it("reports and fixes the provider MCP guard on the primary machine", async () => {
    await withTestHarness(async (harness) => {
      const host = mcpHostFixture(harness);
      const status = await json(
        await request(harness, "/providers?projectPath=/work/app"),
      );
      expect(status).toMatchObject({
        hostId: host.hostId,
        issues: [],
        status: { claude: { connectorsDisabled: true } },
      });
      expect(status.text).toContain("guard: ok");
      expect(host.requests.at(-1)?.command).toEqual({
        type: "mcp.providerStatus",
        projectPath: "/work/app",
      });
      const fixed = await json(
        await request(harness, "/providers/fix", {
          method: "POST",
          body: { hostId: null, projectPath: null },
        }),
      );
      expect(fixed.text).toContain('Set "disableClaudeAiConnectors": true');
      expect(host.requests.at(-1)?.command).toEqual({
        type: "mcp.providerFix",
        projectPath: null,
      });
    });
  });

  it("walks OAuth from needs-auth through the callback to a ready server", async () => {
    const oauth = stubOAuthServer();
    await withTestHarness(async (harness) => {
      const added = await json(
        await request(harness, "/servers", {
          method: "POST",
          body: {
            kind: "http",
            name: "secure",
            url: `${oauthOrigin}/mcp`,
            transport: "streamable-http",
          },
        }),
      );
      const started = await json(
        await request(harness, "/servers/secure/auth", { method: "POST" }),
      );
      expect(started.status).toBe("authorizing");
      const authorizeUrl = new URL(String(started.url));
      expect(authorizeUrl.origin + authorizeUrl.pathname).toBe(
        `${oauthOrigin}/authorize`,
      );
      const redirectUri = `https://bb.example.test/api/v1/mcp/oauth/callback?id=${String(added.id)}`;
      expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(redirectUri);
      expect(oauth.registrations[0]).toMatchObject({
        client_name: "BB",
        redirect_uris: [redirectUri],
      });
      expect(
        await json(await request(harness, "/servers/secure")),
      ).toMatchObject({ status: "needs-auth", authStatus: "authorizing" });

      const mismatch = await harness.app.request(
        `/api/v1/mcp/oauth/callback?id=${String(added.id)}&code=good-code&state=wrong`,
      );
      expect(mismatch.status).toBe(400);
      const state = authorizeUrl.searchParams.get("state");
      const callback = await harness.app.request(
        `/api/v1/mcp/oauth/callback?id=${String(added.id)}&code=good-code&state=${String(state)}`,
      );
      expect(callback.status).toBe(200);
      await expect(callback.text()).resolves.toContain(
        "Authentication completed",
      );
      expect(oauth.tokenRequests.at(-1)?.get("redirect_uri")).toBe(redirectUri);
      await waitFor(
        () => harness.mcpService.store.resolve("secure")?.status === "ready",
      );
      expect(
        await json(await request(harness, "/servers/secure")),
      ).toMatchObject({
        status: "ready",
        authStatus: "authenticated",
        toolCount: 1,
      });
      const search = await json(
        await request(harness, "/tools/search?q=whoami"),
      );
      expect(search.tools).toEqual([
        expect.objectContaining({ name: "whoami", server: "secure" }),
      ]);
      expect(
        (
          await request(harness, "/servers/secure/auth/cancel", {
            method: "POST",
          })
        ).status,
      ).toBe(200);
      expect(
        await json(await request(harness, "/servers/secure")),
      ).toMatchObject({ status: "needs-auth" });
    });
  });
});
