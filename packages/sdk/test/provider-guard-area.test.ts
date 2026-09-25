import { describe, expect, it } from "vitest";
import { createBbSdk } from "../src/core.js";
import { createHttpTransport } from "../src/transport-http.js";
import type { FetchImplementation } from "../src/response.js";

const guardResponse = {
  hostId: "host_1",
  hostName: "local",
  status: {
    claude: {
      settingsPath: "/h/.claude/settings.json",
      connectorsDisabled: true,
      bundledSkillsDisabled: true,
      enabledPlugins: [],
      mcpServers: [],
      pluginsDir: "/h/.claude/plugins",
      marketplaces: [],
      knownMarketplacesFile: null,
      installedPlugins: [],
      skillsDir: "/h/.claude/skills",
      extraSkills: [],
    },
    codex: {
      configPath: "/h/.codex/config.toml",
      features: [{ key: "apps", value: false }],
      systemSkills: [],
      mcpServers: [],
      pluginCacheDir: "/h/.codex/plugins/cache",
      pluginCache: [],
      skillsDir: "/h/.codex/skills",
      extraSkills: [],
    },
  },
  issues: [],
  changes: [],
  text: "guard: ok",
};

function sdkWithGuard() {
  const requests: [string, string, unknown][] = [];
  const fetch: FetchImplementation = async (input, init) => {
    const url = new URL(String(input));
    requests.push([
      init?.method ?? "GET",
      `${url.pathname}${url.search}`,
      init?.body ? JSON.parse(String(init.body)) : undefined,
    ]);
    return new Response(JSON.stringify(guardResponse), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const sdk = createBbSdk({
    transport: createHttpTransport({
      baseUrl: "http://bb.test/",
      fetch,
      runtime: "node",
    }),
  });
  return { sdk, requests };
}

describe("sdk.providers guard", () => {
  it("reads and fixes the provider guard through the providers routes", async () => {
    const { sdk, requests } = sdkWithGuard();
    await expect(sdk.providers.guardStatus()).resolves.toEqual(guardResponse);
    await sdk.providers.guardStatus({
      hostId: "host_2",
      projectPath: "/work/app",
    });
    await expect(
      sdk.providers.guardFix({ hostId: "host_2" }),
    ).resolves.toMatchObject({ text: "guard: ok" });
    expect(requests).toEqual([
      ["GET", "/api/v1/providers/guard", undefined],
      [
        "GET",
        "/api/v1/providers/guard?hostId=host_2&projectPath=%2Fwork%2Fapp",
        undefined,
      ],
      [
        "POST",
        "/api/v1/providers/guard/fix",
        { hostId: "host_2", projectPath: null },
      ],
    ]);
  });
});
