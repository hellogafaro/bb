import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setPluginAgentContributions } from "../../src/services/plugins/plugin-agent-contributions.js";
import { resolveThreadRuntimeCommandConfig } from "../../src/services/threads/thread-runtime-config.js";
import { UNATTENDED_RUN_INSTRUCTIONS } from "../../src/services/threads/instruction-sections.js";
import { renderTemplate } from "@bb/templates";
import {
  seedEnvironment,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

async function seedRuntimeThread(
  harness: TestAppHarness,
  args: {
    hostId: string;
    workspace: string;
    parentThreadId?: string;
    originPluginId?: string;
  },
) {
  const workspacePath = path.join(harness.config.dataDir, args.workspace);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: args.hostId,
    path: workspacePath,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: args.hostId,
    projectId: project.id,
    path: workspacePath,
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    providerId: "codex",
    parentThreadId: args.parentThreadId ?? null,
    originPluginId: args.originPluginId ?? null,
  });
  return { thread, environment, workspacePath };
}

function resolve(
  harness: TestAppHarness,
  seeded: Awaited<ReturnType<typeof seedRuntimeThread>>,
) {
  return resolveThreadRuntimeCommandConfig(harness.deps, {
    thread: seeded.thread,
    model: "test-model",
    environment: {
      hostId: seeded.environment.hostId,
      id: seeded.environment.id,
      path: seeded.environment.path,
      status: seeded.environment.status,
    },
  });
}

describe("instruction groups in thread runtime config", () => {
  it("leaves the workspace .bb/AGENTS.md to the provider", async () => {
    await withTestHarness(async (harness) => {
      const hostId = "host-fork-native-agents";
      seedHostSession(harness.deps, { id: hostId });
      seedPrimaryHost(harness.deps, hostId);
      const seeded = await seedRuntimeThread(harness, {
        hostId,
        workspace: "native-agents-workspace",
      });
      await mkdir(path.join(seeded.workspacePath, ".bb"), { recursive: true });
      await writeFile(
        path.join(seeded.workspacePath, ".bb", "AGENTS.md"),
        "# Project Rules\n\nNever inject me.\n",
        "utf8",
      );
      await writeFile(
        path.join(harness.config.dataDir, "AGENTS.md"),
        "# User Rules\n\nInject me.\n",
        "utf8",
      );
      const config = await resolve(harness, seeded);
      expect(config.instructions).not.toContain("Never inject me.");
      expect(config.instructions).not.toContain(".bb/AGENTS.md");
      expect(config.instructions).toContain(
        '<bb_rules source="<dataDir>/AGENTS.md">\n# User Rules\n\nInject me.\n</bb_rules>',
      );
      expect(config.instructionGroups.map((group) => group.tag)).toEqual([
        "bb_tools",
        "bb_rules",
        "bb_operating_model",
      ]);
    });
  });

  it("adds bb_run only to child and plugin-originated threads and keeps it last", async () => {
    await withTestHarness(async (harness) => {
      const hostId = "host-fork-run-mode";
      seedHostSession(harness.deps, { id: hostId });
      seedPrimaryHost(harness.deps, hostId);
      const root = await seedRuntimeThread(harness, {
        hostId,
        workspace: "run-mode-root",
      });
      const rootConfig = await resolve(harness, root);
      expect(rootConfig.instructions).not.toContain("<bb_run");
      expect(rootConfig.instructionGroups.map((group) => group.tag)).toEqual([
        "bb_tools",
        "bb_operating_model",
      ]);
      expect(rootConfig.instructions).toContain(
        `<bb_operating_model>\n${renderTemplate("operatingModel", {})}\n</bb_operating_model>`,
      );

      const child = await seedRuntimeThread(harness, {
        hostId,
        workspace: "run-mode-child",
        parentThreadId: root.thread.id,
      });
      const childConfig = await resolve(harness, child);
      expect(childConfig.instructionGroups.map((group) => group.tag)).toEqual([
        "bb_tools",
        "bb_operating_model",
        "bb_run",
      ]);
      expect(childConfig.instructions.endsWith(
        `<bb_run mode="unattended">\n${UNATTENDED_RUN_INSTRUCTIONS}\n</bb_run>`,
      )).toBe(true);

      const automation = await seedRuntimeThread(harness, {
        hostId,
        workspace: "run-mode-automation",
        originPluginId: "automations",
      });
      const automationConfig = await resolve(harness, automation);
      expect(automationConfig.instructionGroups.map((group) => group.tag)).toEqual([
        "bb_tools",
        "bb_operating_model",
        "bb_run",
      ]);
    });
  });

  it("emits each contribution as its own XML group with no prose headers", async () => {
    await withTestHarness(async (harness) => {
      const hostId = "host-fork-groups";
      seedHostSession(harness.deps, { id: hostId });
      seedPrimaryHost(harness.deps, hostId);
      const seeded = await seedRuntimeThread(harness, {
        hostId,
        workspace: "groups-workspace",
      });
      setPluginAgentContributions({
        listSkillRootContributions: () => [],
        listAgentTools: () => [
          {
            pluginId: "tooldemo",
            tool: {
              name: "demo_lookup",
              description: "Look up demo data",
              inputSchema: { type: "object" },
            },
            instructions: "Call demo_lookup before guessing.",
          },
        ],
        listInstructionContributions: () => [
          { pluginId: "connect", provider: () => "Share through connect." },
        ],
        findAgentTool: () => undefined,
        invokeAgentTool: async () => ({
          success: false,
          contentItems: [{ type: "inputText", text: "unused" }],
        }),
        resolveMention: async () => ({ ok: false, error: "unused" }),
      });
      try {
        const config = await resolve(harness, seeded);
        expect(config.instructionGroups.map((group) => group.tag)).toEqual([
          "bb_tools",
          "bb_plugin",
          "bb_operating_model",
        ]);
        expect(config.instructions).toContain(
          '<tool plugin="tooldemo" name="demo_lookup">\nCall demo_lookup before guessing.\n</tool>\n</bb_tools>',
        );
        expect(config.instructions).toContain(
          '<bb_plugin id="connect">\nShare through connect.\n</bb_plugin>',
        );
        expect(config.instructions).not.toContain("The following");
      } finally {
        setPluginAgentContributions(undefined);
      }
    });
  });
});
