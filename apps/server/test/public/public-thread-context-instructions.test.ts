import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { upsertProjectExecutionDefaults } from "@bb/db";
import {
  seedEnvironment,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("thread context instructions API", () => {
  it("returns the assembled instructions with group, skill, tool, and env summaries", async () => {
    await withTestHarness(async (harness) => {
      const hostId = "host-context-instructions";
      seedHostSession(harness.deps, { id: hostId });
      seedPrimaryHost(harness.deps, hostId);
      const workspacePath = path.join(
        harness.config.dataDir,
        "context-instructions-workspace",
      );
      const { project } = seedProjectWithSource(harness.deps, {
        hostId,
        path: workspacePath,
      });
      upsertProjectExecutionDefaults(harness.db, {
        projectId: project.id,
        providerId: "codex",
        model: "gpt-5-mini",
        reasoningLevel: "high",
        permissionMode: "auto",
        serviceTier: "default",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId,
        projectId: project.id,
        path: workspacePath,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
      });
      await writeFile(
        path.join(harness.config.dataDir, "AGENTS.md"),
        "# User Rules\n\nAnswer briefly.\n",
        "utf8",
      );
      const skillRoot = path.join(harness.config.dataDir, "skills", "triage");
      await mkdir(skillRoot, { recursive: true });
      const skillFile = [
        "---",
        "name: triage",
        "description: Use triage in context tests.",
        "---",
        "",
        "# Triage",
        "",
      ].join("\n");
      await writeFile(path.join(skillRoot, "SKILL.md"), skillFile, "utf8");
      await writeFile(path.join(skillRoot, "notes.md"), "extra", "utf8");

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/context/instructions`,
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const body = await response.json();
      expect(body.instructionMode).toBe("append");
      expect(body.instructions).toContain(
        '<bb_rules source="<dataDir>/AGENTS.md">\n# User Rules\n\nAnswer briefly.\n</bb_rules>',
      );
      expect(body.chars).toBe(body.instructions.length);
      expect(body.estimatedTokens).toBe(Math.ceil(body.instructions.length / 4));
      expect(body.groups.map((group: { tag: string }) => group.tag)).toEqual([
        "bb_tools",
        "bb_rules",
      ]);
      expect(
        body.groups.reduce(
          (sum: number, group: { chars: number }) => sum + group.chars,
          0,
        ) +
          2 * (body.groups.length - 1),
      ).toBe(body.chars);
      expect(body.dynamicTools).toEqual(["update_environment_directory"]);
      expect(body.contributedEnv.every((name: unknown) => typeof name === "string")).toBe(true);
      expect(JSON.stringify(body.contributedEnv)).not.toContain("value");
      expect(body.skills).toContainEqual({
        name: "triage",
        sourceType: "data-dir",
        rootPath: skillRoot,
        fileCount: 2,
        bytes: Buffer.byteLength(skillFile) + Buffer.byteLength("extra"),
      });
    });
  });

  it("returns 404 for unknown threads", async () => {
    await withTestHarness(async (harness) => {
      expect(
        (
          await harness.app.request(
            "/api/v1/threads/missing/context/instructions",
          )
        ).status,
      ).toBe(404);
    });
  });
});
