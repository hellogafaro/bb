import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DeferredOAuthCredentialStore,
  McpOAuthProvider,
  type OAuthCredentialRecord,
  type OAuthCredentialStore,
} from "../../../src/services/mcp/oauth.js";
import { mcpOAuthCredentialFile } from "../../../src/services/mcp/oauth-credentials.js";

class MemorySecrets implements OAuthCredentialStore {
  readonly records = new Map<string, OAuthCredentialRecord>();
  async get(key: string) {
    return this.records.get(key);
  }
  async set(key: string, value: OAuthCredentialRecord) {
    this.records.set(key, value);
  }
  async delete(key: string) {
    this.records.delete(key);
  }
}

describe("McpOAuthProvider", () => {
  it("persists PKCE state and credentials without exposing them in status", async () => {
    const secrets = new MemorySecrets();
    const provider = new McpOAuthProvider(
      "plugin:server",
      new URL("https://mcp.example.test/mcp"),
      new URL("http://127.0.0.1:4000/callback?id=mcp_fixture000"),
      secrets,
    );
    expect(provider.clientMetadata).toEqual(
      expect.objectContaining({
        client_name: "BB",
        token_endpoint_auth_method: "none",
        redirect_uris: ["http://127.0.0.1:4000/callback?id=mcp_fixture000"],
      }),
    );
    expect(provider.clientMetadata).not.toHaveProperty("client_uri");
    expect(await provider.status()).toBe("unauthenticated");

    const state = await provider.state();
    await expect(provider.validateState("wrong")).rejects.toThrow(
      "state mismatch",
    );
    await expect(provider.validateState(state)).resolves.toBeUndefined();
    await provider.saveCodeVerifier("verifier");
    await provider.redirectToAuthorization(
      new URL("https://auth.example.test/authorize?state=" + state),
    );
    expect(await provider.status()).toBe("authorizing");
    expect(provider.getAuthorizationUrl()).toContain("auth.example.test");
    const reloadedProvider = new McpOAuthProvider(
      "plugin:server",
      new URL("https://mcp.example.test/mcp"),
      new URL("http://127.0.0.1:4000/callback?id=mcp_fixture000"),
      secrets,
    );
    expect(await reloadedProvider.authorizationUrlValue()).toContain(
      "auth.example.test",
    );

    await provider.saveTokens({
      access_token: "secret-access-token",
      token_type: "Bearer",
      refresh_token: "secret-refresh-token",
    });
    await provider.clearPending();
    expect(await provider.status()).toBe("authenticated");
    expect(await provider.tokens()).toEqual(
      expect.objectContaining({ access_token: "secret-access-token" }),
    );

    await provider.invalidateCredentials("tokens");
    expect(await provider.status()).toBe("unauthenticated");
    expect(secrets.records.get("plugin:server")?.codeVerifier).toBeUndefined();
  });

  it("advertises BB and the public origin on HTTPS redirects", () => {
    const provider = new McpOAuthProvider(
      "plugin:server",
      new URL("https://mcp.notion.com/mcp"),
      new URL(
        "https://g4f4r0.getbb.app/api/v1/mcp/oauth/callback?id=mcp_notion0000",
      ),
      new MemorySecrets(),
    );
    expect(provider.clientMetadata).toEqual(
      expect.objectContaining({
        client_name: "BB",
        client_uri: "https://g4f4r0.getbb.app",
      }),
    );
  });

  it("drops a loopback-registered client when the public redirect changes", async () => {
    const secrets = new MemorySecrets();
    await secrets.set("plugin:server", {
      clientInformation: { client_id: "old-client" } as never,
      tokens: { access_token: "old", token_type: "Bearer" },
      redirectUri: "http://127.0.0.1:38886/callback",
    });
    const provider = new McpOAuthProvider(
      "plugin:server",
      new URL("https://mcp.notion.com/mcp"),
      new URL("https://g4f4r0.getbb.app/callback"),
      secrets,
    );
    await provider.alignWithRedirect();
    expect(secrets.records.get("plugin:server")).toEqual({
      redirectUri: "https://g4f4r0.getbb.app/callback",
    });
  });
});

describe("OAuth issuer identity", () => {
  it("accepts a trailing slash difference while rejecting another issuer", async () => {
    const secrets = new MemorySecrets();
    const provider = new McpOAuthProvider(
      "issuer:test",
      new URL("https://mcp.example/mcp"),
      new URL("https://bb.example/callback"),
      secrets,
    );
    await provider.saveTokens({
      access_token: "token",
      token_type: "Bearer",
      issuer: "https://auth.example",
    });
    expect(
      await provider.tokens({ issuer: "https://auth.example/" }),
    ).toBeDefined();
    expect(
      await provider.tokens({ issuer: "https://other.example" }),
    ).toBeUndefined();
    await provider.saveClientInformation({
      client_id: "client",
      issuer: "https://auth.example/",
    });
    expect(
      await provider.clientInformation({ issuer: "https://auth.example" }),
    ).toBeDefined();
    expect(
      await provider.clientInformation({ issuer: "https://other.example" }),
    ).toBeUndefined();
  });
});

function record(accessToken: string): OAuthCredentialRecord {
  return { tokens: { access_token: accessToken, token_type: "Bearer" } };
}

describe("DeferredOAuthCredentialStore", () => {
  it("does not call the host writer from inside a deferred callback", async () => {
    const saved: Record<string, OAuthCredentialRecord>[] = [];
    const store = new DeferredOAuthCredentialStore({
      async load() {
        return {};
      },
      async save(value) {
        saved.push(value);
      },
    });

    const release = store.deferPersistence();
    await store.set("plugin:server", record("access-token"));
    expect(saved).toEqual([]);
    release();
    await store.flush();
    expect(saved).toEqual([{ "plugin:server": record("access-token") }]);
  });

  it("persists ordinary writes before resolving", async () => {
    let saveCount = 0;
    const store = new DeferredOAuthCredentialStore({
      async load() {
        return {};
      },
      async save() {
        saveCount += 1;
      },
    });

    await store.set("plugin:server", record("access-token"));
    expect(saveCount).toBe(1);
  });

  it("keeps callback-leg credentials available to a reconnect before flush", async () => {
    const store = new DeferredOAuthCredentialStore({
      async load() {
        return {};
      },
      async save() {},
    });
    const release = store.deferPersistence();
    await store.set("plugin:server", record("access-token"));
    expect(await store.get("plugin:server")).toEqual(record("access-token"));
    release();
  });
});

describe("MCP OAuth credential file", () => {
  it("round-trips credentials through an owner-only secret file and deletes it when empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-mcp-oauth-"));
    const warnings: string[] = [];
    try {
      const backend = mcpOAuthCredentialFile(dir, (message) =>
        warnings.push(message),
      );
      expect(await backend.load()).toEqual({});
      await backend.save({ mcp_a: record("secret") });
      expect(await backend.load()).toEqual({ mcp_a: record("secret") });
      expect(
        (await stat(join(dir, "oauth-credentials.json"))).mode & 0o777,
      ).toBe(0o600);
      await backend.save({});
      await expect(
        readFile(join(dir, "oauth-credentials.json"), "utf8"),
      ).rejects.toThrow();
      await writeFile(join(dir, "oauth-credentials.json"), "[1]");
      expect(await backend.load()).toEqual({});
      expect(warnings[0]).toContain("invalid");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
