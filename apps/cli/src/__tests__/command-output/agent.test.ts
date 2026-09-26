import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentResult, BbSdk } from "@bb/sdk";
import {
  collectLogLines,
  collectLogPayloads,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import * as fixtures from "../helpers/command-output-fixtures.js";
import { createCliBbSdk } from "../../client.js";
import { registerAgentCommands } from "../../commands/agent.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

const createSdkMock = vi.mocked(createCliBbSdk);
const createRealSdk = createSdkMock.getMockImplementation();

function agentRecord(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    id: "agent_coder00001",
    name: "Coder",
    description: "Writes code",
    providerId: "codex",
    model: "gpt-5",
    reasoningLevel: "high",
    secondaryModel: null,
    secondaryReasoningLevel: null,
    skills: [],
    mcpServers: [],
    instructions: "",
    mascot: "cat",
    color: 4,
    createdAt: 1,
    updatedAt: 1,
    homePath: "/home/me/.bb/agents/coder",
    ...overrides,
  };
}

const defaultAgent = agentRecord({
  id: "agent_default001",
  name: "BB",
  description: "",
  model: null,
  reasoningLevel: "medium",
  secondaryModel: null,
  secondaryReasoningLevel: null,
});

describe("bb agent commands", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) => {
    registerAgentCommands(program, () => "http://server");
    registerThreadCommands(program, () => "http://server");
  };

  let sdk: BbSdk;

  beforeEach(() => {
    if (!createRealSdk) throw new Error("createCliBbSdk mock has no default");
    sdk = createRealSdk("http://server");
    createSdkMock.mockImplementation(() => sdk);
  });

  afterEach(() => {
    if (createRealSdk) createSdkMock.mockImplementation(createRealSdk);
  });

  function logLines(): string[] {
    return collectLogLines(vi.mocked(console.log));
  }

  function errorOutput(): string {
    return collectLogLines(vi.mocked(console.error)).join("\n");
  }

  it("lists agents with the default first and suggests creating one when empty", async () => {
    vi.spyOn(sdk.agents, "list")
      .mockResolvedValueOnce([
        defaultAgent,
        agentRecord({ skills: ["bb-cli", "notion"], mcpServers: ["notion"] }),
      ])
      .mockResolvedValueOnce([]);

    await runCommand(["agent", "list"], register);
    await runCommand(["agent", "list"], register);

    expect(logLines()).toEqual([
      [
        "bb  BB  codex/default model  all skills  all MCPs  (default)",
        "coder  Coder  codex/gpt-5  2 skills  1 MCP",
      ].join("\n"),
      "No agents. Try: bb agent create Coder",
    ]);
  });

  it("prints agents as a bare JSON array", async () => {
    vi.spyOn(sdk.agents, "list").mockResolvedValue([defaultAgent]);

    await runCommand(["agent", "list", "--json"], register);

    expect(JSON.parse(collectLogPayloads(vi.mocked(console.log))[0]!)).toEqual([
      defaultAgent,
    ]);
  });

  it("shows an agent by name", async () => {
    const coder = agentRecord({
      skills: ["bb-cli"],
      instructions: "Keep diffs small.\nRun tests.",
    });
    const get = vi.spyOn(sdk.agents, "get").mockResolvedValue(coder);
    vi.spyOn(sdk.agents, "list").mockResolvedValue([defaultAgent, coder]);

    await runCommand(["agent", "show", "coder"], register);

    expect(get).toHaveBeenCalledWith({ agent: "coder" });
    expect(logLines()).toEqual([
      [
        "Agent: Coder",
        "  Handle: coder",
        "  ID: agent_coder00001",
        "  Description: Writes code",
        "  Provider: codex",
        "  Model: gpt-5",
        "  Reasoning: high",
        "  Secondary model: same as primary",
        "  Mascot: cat",
        "  Color: 4",
        "  Permissions: full",
        "  Skills: bb-cli",
        "  MCPs: all enabled",
        "  Home: /home/me/.bb/agents/coder",
        "  Instructions:",
        "    Keep diffs small.",
        "    Run tests.",
      ].join("\n"),
    ]);
  });

  it("prints the agent's home folder as a path or JSON", async () => {
    const get = vi.spyOn(sdk.agents, "get").mockResolvedValue(agentRecord());

    await runCommand(["agent", "home", "coder"], register);
    await runCommand(["agent", "home", "coder", "--json"], register);

    expect(get).toHaveBeenCalledWith({ agent: "coder" });
    const payloads = collectLogPayloads(vi.mocked(console.log));
    expect(payloads[0]).toBe("/home/me/.bb/agents/coder");
    expect(JSON.parse(payloads[1]!)).toEqual({
      id: "agent_coder00001",
      name: "Coder",
      homePath: "/home/me/.bb/agents/coder",
    });
  });

  it("creates an agent with repeated skills and MCPs and instructions from a file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-agent-"));
    const path = join(dir, "instructions.md");
    await writeFile(path, "Use `pnpm test` before $(done)\n");
    const create = vi
      .spyOn(sdk.agents, "create")
      .mockResolvedValue(agentRecord());
    try {
      await runCommand(
        [
          "agent",
          "create",
          "Coder",
          "--provider",
          "codex",
          "--model",
          "gpt-5",
          "--reasoning",
          "high",
          "--skill",
          "bb-cli",
          "--skill",
          "notion",
          "--mcp",
          "notion",
          "--description",
          "Writes code",
          "--mascot",
          "Frog",
          "--color",
          "8",
          "--instructions-file",
          path,
        ],
        register,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }

    expect(create).toHaveBeenCalledWith({
      name: "Coder",
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "high",
      skills: ["bb-cli", "notion"],
      mcpServers: ["notion"],
      description: "Writes code",
      instructions: "Use `pnpm test` before $(done)",
      mascot: "frog",
      color: 8,
    });
    expect(logLines()).toEqual(["Created agent Coder (agent_coder00001)"]);
  });

  it("creates with only a name and rejects a bad reasoning level", async () => {
    const create = vi
      .spyOn(sdk.agents, "create")
      .mockResolvedValue(agentRecord());

    await runCommand(["agent", "create", "Coder"], register);
    expect(create).toHaveBeenCalledWith({ name: "Coder" });

    await expect(
      runCommand(["agent", "create", "Other", "--reasoning", "huge"], register),
    ).rejects.toThrow("process.exit:1");
    expect(errorOutput()).toContain("Invalid reasoning level 'huge'");
  });

  it.each([
    [["--mascot", "dragon"], "Unknown mascot 'dragon'"],
    [["--color", "0"], "Invalid color '0'"],
    [["--color", "9"], "Invalid color '9'"],
    [["--color", "2.5"], "Invalid color '2.5'"],
  ] as const)(
    "rejects create %j before calling the server",
    async (args, message) => {
      const create = vi.spyOn(sdk.agents, "create");

      await expect(
        runCommand(["agent", "create", "Coder", ...args], register),
      ).rejects.toThrow("process.exit:1");

      expect(errorOutput()).toContain(message);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it.each([
    [["skills", "bb-cli, notion ,"], { skills: ["bb-cli", "notion"] }],
    [["mcp", "notion,linear"], { mcpServers: ["notion", "linear"] }],
    [["model", "gpt-5-mini"], { model: "gpt-5-mini" }],
    [["provider", "claude-code"], { providerId: "claude-code" }],
    [["reasoning", "low"], { reasoningLevel: "low" }],
    [["name", "Builder"], { name: "Builder" }],
    [["description", "Builds"], { description: "Builds" }],
    [["instructions", "Be brief."], { instructions: "Be brief." }],
    [["model", "--clear"], { model: null }],
    [["skills", "--clear"], { skills: [] }],
    [["mcp", "--clear"], { mcpServers: [] }],
    [["instructions", "--clear"], { instructions: "" }],
    [["description", "--clear"], { description: "" }],
    [["mascot", "rocket"], { mascot: "rocket" }],
    [["color", "3"], { color: 3 }],
  ] as const)("sets %j", async (args, patch) => {
    const update = vi
      .spyOn(sdk.agents, "update")
      .mockResolvedValue(agentRecord());

    await runCommand(["agent", "set", "Coder", ...args], register);

    expect(update).toHaveBeenCalledWith({ agent: "Coder", ...patch });
    expect(logLines()).toEqual([`Updated agent Coder (${args[0]})`]);
  });

  it("rejects unknown fields, missing values, and clearing required fields", async () => {
    const update = vi.spyOn(sdk.agents, "update");

    await expect(
      runCommand(["agent", "set", "Coder", "flavor", "red"], register),
    ).rejects.toThrow("process.exit:1");
    await expect(
      runCommand(["agent", "set", "Coder", "color", "red"], register),
    ).rejects.toThrow("process.exit:1");
    await expect(
      runCommand(["agent", "set", "Coder", "mascot", "--clear"], register),
    ).rejects.toThrow("process.exit:1");
    await expect(
      runCommand(["agent", "set", "Coder", "model"], register),
    ).rejects.toThrow("process.exit:1");
    await expect(
      runCommand(["agent", "set", "Coder", "provider", "--clear"], register),
    ).rejects.toThrow("process.exit:1");
    await expect(
      runCommand(
        ["agent", "set", "Coder", "model", "gpt-5", "--clear"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    const errors = errorOutput();
    expect(errors).toContain("Unknown agent field 'flavor'");
    expect(errors).toContain("Invalid color 'red'");
    expect(errors).toContain("The mascot field cannot be cleared.");
    expect(errors).toContain("Missing a value for model.");
    expect(errors).toContain("The provider field cannot be cleared.");
    expect(errors).toContain("Pass either a value or --clear, not both.");
    expect(update).not.toHaveBeenCalled();
  });

  it("removes an agent and reports the last-agent refusal", async () => {
    const remove = vi
      .spyOn(sdk.agents, "remove")
      .mockResolvedValueOnce({ deleted: true, id: "agent_coder00001" })
      .mockRejectedValueOnce(
        new Error("Cannot delete the last agent. Create another agent first."),
      );

    await runCommand(["agent", "remove", "Coder"], register);
    expect(remove).toHaveBeenCalledWith({ agent: "Coder" });
    expect(logLines()).toEqual(["Removed agent Coder (agent_coder00001)"]);

    await expect(runCommand(["agent", "rm", "BB"], register)).rejects.toThrow(
      "process.exit:1",
    );
    expect(errorOutput()).toContain("Cannot delete the last agent");
  });

  it("prints the thread's agent in bb thread show, falling back to the default", async () => {
    const coder = agentRecord();
    const withAgent = fixtures.makeThread({
      id: "thread-agent",
      projectId: "proj-1",
      providerId: "codex",
      agentId: coder.id,
    });
    const withoutAgent = fixtures.makeThread({
      id: "thread-default",
      projectId: "proj-1",
      providerId: "codex",
    });
    stubServerApi({
      "v1.threads.:id.$get": vi.fn(
        async ({ param }: { param: { id: string } }) =>
          param.id === withAgent.id ? withAgent : withoutAgent,
      ),
      "v1.threads.:id.timeline.$get": fixtures.makeEmptyTimelineGetMock(),
    });
    if (!createRealSdk) throw new Error("createCliBbSdk mock has no default");
    sdk = createRealSdk("http://server");
    vi.spyOn(sdk.agents, "list").mockResolvedValue([defaultAgent, coder]);

    await runCommand(["thread", "show", "thread-agent"], register);
    await runCommand(["thread", "show", "thread-default"], register);

    const agentLines = logLines().flatMap((line) =>
      line.split("\n").filter((entry) => entry.includes("Agent:")),
    );
    expect(agentLines).toEqual(["  Agent: Coder", "  Agent: BB"]);
  });
});
