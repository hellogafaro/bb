import { describe, expect, it, vi } from "vitest";
import {
  collectLogLines,
  setupCommandOutputTestEnvironment,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread context", () => {
  setupCommandOutputTestEnvironment();
  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("prints provider-defined categories and marks deferred counts separately", async () => {
    const get = vi.fn(async () => ({
      usage: {
        usedTokens: 100,
        modelContextWindow: 1_000,
        estimated: true,
        snapshot: {
          capturedAt: "2026-09-11T12:00:00.000Z",
          categories: [
            {
              id: "custom",
              label: "Custom category",
              kind: "used",
              tokens: 100,
              entries: [{ id: "file", label: "project.md", tokens: 100 }],
            },
            {
              id: "deferred",
              label: "Future tools",
              kind: "deferred",
              tokens: 500,
              entries: [],
            },
          ],
        },
      },
    }));
    stubServerApi({ "v1.threads.:id.context.$get": get });
    await runCommand(["thread", "context", "thread-1"], register);
    expect(get).toHaveBeenCalledWith({ param: { id: "thread-1" } });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Estimated context: 100 / 1,000 tokens",
    );
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Custom category: 100",
    );
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "  project.md: 100",
    );
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Future tools (deferred): 500",
    );
  });

  it("prints assembled instructions, group sizes, skills, tools, and env names with --instructions", async () => {
    const instructions = vi.fn(async () => ({
      instructionMode: "append",
      instructions: "<bb_tools>\nMove carefully.\n</bb_tools>\n\n<bb_rules source=\"<dataDir>/AGENTS.md\">\nBe brief.\n</bb_rules>",
      chars: 90,
      estimatedTokens: 23,
      groups: [
        { tag: "bb_tools", chars: 38, estimatedTokens: 10 },
        { tag: "bb_rules", chars: 50, estimatedTokens: 13 },
      ],
      skills: [
        {
          name: "triage",
          sourceType: "data-dir",
          rootPath: "/data/skills/triage",
          fileCount: 2,
          bytes: 1200,
        },
        {
          name: "remote",
          sourceType: "project",
          rootPath: "/remote/.bb/skills/remote",
          fileCount: null,
          bytes: null,
        },
      ],
      dynamicTools: ["update_environment_directory", "mcp_search"],
      contributedEnv: ["BB_AGENT_HOME", "SECRET_TOKEN"],
    }));
    const usage = vi.fn(async () => ({
      usage: { usedTokens: 100, modelContextWindow: 1_000, estimated: true },
    }));
    stubServerApi({
      "v1.threads.:id.context.$get": usage,
      "v1.threads.:id.context.instructions.$get": instructions,
    });
    await runCommand(
      ["thread", "context", "thread-1", "--instructions"],
      register,
    );
    expect(instructions).toHaveBeenCalledWith({ param: { id: "thread-1" } });
    const lines = collectLogLines(vi.mocked(console.log));
    expect(lines[0]).toContain("<bb_tools>\nMove carefully.\n</bb_tools>");
    expect(lines).toContain("Instruction mode: append");
    expect(lines.some((line) => /^<bb_rules>\s+50\s+13$/.test(line))).toBe(true);
    expect(lines.some((line) => /^Total\s+90\s+23$/.test(line))).toBe(true);
    expect(lines).toContain("Injected skills: 2 roots, 2 files, 1,200 bytes");
    expect(lines).toContain(
      "  triage (data-dir) files=2 bytes=1,200 /data/skills/triage",
    );
    expect(lines).toContain(
      "  remote (project) files=? bytes=? /remote/.bb/skills/remote",
    );
    expect(lines).toContain(
      "Dynamic tools: update_environment_directory, mcp_search",
    );
    expect(lines).toContain("Contributed env: BB_AGENT_HOME, SECRET_TOKEN");
    expect(lines).toContain("Estimated context: 100 / 1,000 tokens");
  });

  it("merges instructions and usage in JSON with --instructions", async () => {
    stubServerApi({
      "v1.threads.:id.context.$get": vi.fn(async () => ({ usage: null })),
      "v1.threads.:id.context.instructions.$get": vi.fn(async () => ({
        instructionMode: "append",
        instructions: "",
        chars: 0,
        estimatedTokens: 0,
        groups: [],
        skills: [],
        dynamicTools: [],
        contributedEnv: [],
      })),
    });
    await runCommand(
      ["thread", "context", "thread-1", "--instructions", "--json"],
      register,
    );
    expect(
      JSON.parse(collectLogLines(vi.mocked(console.log)).join("\n")),
    ).toEqual({
      instructionMode: "append",
      instructions: "",
      chars: 0,
      estimatedTokens: 0,
      groups: [],
      skills: [],
      dynamicTools: [],
      contributedEnv: [],
      usage: null,
    });
  });

  it("returns explicit missing usage in JSON", async () => {
    stubServerApi({
      "v1.threads.:id.context.$get": vi.fn(async () => ({ usage: null })),
    });
    await runCommand(["thread", "context", "thread-1", "--json"], register);
    expect(
      JSON.parse(collectLogLines(vi.mocked(console.log)).join("\n")),
    ).toEqual({ usage: null });
  });
});
