import { describe, expect, it } from "vitest";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import { mcpHostFixture } from "../services/mcp/harness.js";

function request(
  harness: TestAppHarness,
  path: string,
  init?: { method?: string; body?: unknown },
) {
  return harness.app.request(`/api/v1/providers/guard${path}`, {
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

describe("provider guard routes", () => {
  it("reports and fixes the provider guard on the primary machine", async () => {
    await withTestHarness(async (harness) => {
      const host = mcpHostFixture(harness);
      const status = await json(
        await request(harness, "?projectPath=/work/app"),
      );
      expect(status).toMatchObject({
        hostId: host.hostId,
        issues: [],
        changes: [],
        status: { claude: { connectorsDisabled: true } },
      });
      expect(status.text).toContain("guard: ok");
      expect(host.requests.at(-1)?.command).toEqual({
        type: "providers.guardStatus",
        projectPath: "/work/app",
      });
      const fixed = await json(
        await request(harness, "/fix", {
          method: "POST",
          body: { hostId: null, projectPath: null },
        }),
      );
      expect(fixed.changes).toEqual([
        'Set "disableBundledSkills": true in /home/u/.claude/settings.json',
      ]);
      expect(fixed.text).toContain('Set "disableBundledSkills": true');
      expect(host.requests.at(-1)?.command).toEqual({
        type: "providers.guardFix",
        projectPath: null,
      });
    });
  });

  it("rejects a malformed fix request", async () => {
    await withTestHarness(async (harness) => {
      mcpHostFixture(harness);
      const response = await request(harness, "/fix", {
        method: "POST",
        body: { hostId: 3 },
      });
      expect(response.status).toBe(400);
    });
  });
});
