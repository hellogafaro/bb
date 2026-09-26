import { describe, expect, it } from "vitest";
import {
  AGENT_HOME_ONLY_INSTRUCTION,
  UNATTENDED_RUN_INSTRUCTIONS,
  buildInstructionGroups,
  joinInstructionGroups,
  measureInstructionGroups,
  resolveThreadRunMode,
  type BuildInstructionGroupsArgs,
} from "./instruction-sections.js";

const empty: BuildInstructionGroupsArgs = {
  tools: [],
  toolGuidance: [],
  connectedMcps: null,
  pluginInstructions: [],
  dynamicInstructions: [],
  rules: [],
  agent: null,
  runMode: "attended",
};

describe("buildInstructionGroups", () => {
  it("emits nothing when every source is empty", () => {
    expect(buildInstructionGroups(empty)).toEqual([]);
    expect(joinInstructionGroups(buildInstructionGroups(empty))).toBe("");
  });

  it("groups core tool text, guidance, and plugin tools inside bb_tools", () => {
    const [group] = buildInstructionGroups({
      ...empty,
      tools: [
        { pluginId: null, toolName: "move", instructions: "Move carefully." },
        { pluginId: "wf", toolName: "run", instructions: "Run it once." },
        { pluginId: "wf", toolName: "silent", instructions: null },
        { pluginId: null, toolName: "blank", instructions: "" },
      ],
      toolGuidance: ["Search before calling."],
    });
    expect(group.tag).toBe("bb_tools");
    expect(group.text).toBe(
      [
        "<bb_tools>",
        "Move carefully.",
        "",
        "Search before calling.",
        "",
        '<tool plugin="wf" name="run">',
        "Run it once.",
        "</tool>",
        "</bb_tools>",
      ].join("\n"),
    );
  });

  it("keeps the connected_mcps XML as produced", () => {
    const xml = '<connected_mcps>\n  <mcp handle="notion" />\n</connected_mcps>';
    expect(buildInstructionGroups({ ...empty, connectedMcps: xml })).toEqual([
      { tag: "connected_mcps", text: xml },
    ]);
    expect(buildInstructionGroups({ ...empty, connectedMcps: "  \n" })).toEqual(
      [],
    );
  });

  it("wraps plugin, dynamic, and rules contributions without escaping their bodies", () => {
    const groups = buildInstructionGroups({
      ...empty,
      pluginInstructions: [
        { pluginId: "connect", text: "Use `bb connect expose <port>`." },
        { pluginId: "blank", text: "   " },
      ],
      dynamicInstructions: [{ pluginId: "workflows", text: "Copy <directive>." }],
      rules: [
        { source: "<dataDir>/AGENTS.md", text: "# Rules\n\nBe brief & kind." },
      ],
    });
    expect(groups.map((group) => group.text)).toEqual([
      '<bb_plugin id="connect">\nUse `bb connect expose <port>`.\n</bb_plugin>',
      '<bb_plugin id="workflows">\nCopy <directive>.\n</bb_plugin>',
      '<bb_rules source="<dataDir>/AGENTS.md">\n# Rules\n\nBe brief & kind.\n</bb_rules>',
    ]);
  });

  it("escapes quotes and ampersands in attributes", () => {
    const [group] = buildInstructionGroups({
      ...empty,
      agent: { name: 'R&D "lead"', instructions: "Lead.", homePath: null },
    });
    expect(group.text).toBe(
      '<bb_agent name="R&amp;D &quot;lead&quot;">\nLead.\n</bb_agent>',
    );
  });

  it("renders the agent group from instructions and home", () => {
    const withBoth = buildInstructionGroups({
      ...empty,
      agent: { name: "Dexter", instructions: " Be precise. ", homePath: "/h/dexter" },
    });
    expect(withBoth[0].text).toBe(
      '<bb_agent name="Dexter" home="/h/dexter">\nBe precise.\n</bb_agent>',
    );
    const homeOnly = buildInstructionGroups({
      ...empty,
      agent: { name: "bb", instructions: "", homePath: "/h/bb" },
    });
    expect(homeOnly[0].text).toBe(
      `<bb_agent name="bb" home="/h/bb">\n${AGENT_HOME_ONLY_INSTRUCTION}\n</bb_agent>`,
    );
    expect(
      buildInstructionGroups({
        ...empty,
        agent: { name: "ghost", instructions: "  ", homePath: null },
      }),
    ).toEqual([]);
  });

  it("appends the unattended block only for unattended runs, in last position", () => {
    expect(buildInstructionGroups({ ...empty, runMode: "attended" })).toEqual(
      [],
    );
    const groups = buildInstructionGroups({
      ...empty,
      rules: [{ source: "x", text: "y" }],
      agent: { name: "a", instructions: "b", homePath: null },
      runMode: "unattended",
    });
    expect(groups.map((group) => group.tag)).toEqual([
      "bb_rules",
      "bb_agent",
      "bb_run",
    ]);
    expect(groups[2].text).toBe(
      `<bb_run mode="unattended">\n${UNATTENDED_RUN_INSTRUCTIONS}\n</bb_run>`,
    );
  });

  it("orders groups tools, mcps, plugins, dynamic, rules, agent, run and joins with blank lines", () => {
    const groups = buildInstructionGroups({
      tools: [{ pluginId: null, toolName: "t", instructions: "tool" }],
      toolGuidance: [],
      connectedMcps: "<connected_mcps>\n</connected_mcps>",
      pluginInstructions: [{ pluginId: "p", text: "plugin" }],
      dynamicInstructions: [{ pluginId: "d", text: "dynamic" }],
      rules: [{ source: "r", text: "rules" }],
      agent: { name: "a", instructions: "agent", homePath: null },
      runMode: "unattended",
    });
    expect(groups.map((group) => group.tag)).toEqual([
      "bb_tools",
      "connected_mcps",
      "bb_plugin",
      "bb_plugin",
      "bb_rules",
      "bb_agent",
      "bb_run",
    ]);
    expect(joinInstructionGroups(groups)).toBe(
      groups.map((group) => group.text).join("\n\n"),
    );
    expect(joinInstructionGroups(groups)).not.toContain(
      "The following instructions come from",
    );
  });

  it("measures groups in characters and estimated tokens", () => {
    const groups = buildInstructionGroups({
      ...empty,
      rules: [{ source: "r", text: "x".repeat(100) }],
    });
    expect(measureInstructionGroups(groups)).toEqual([
      {
        tag: "bb_rules",
        chars: groups[0].text.length,
        estimatedTokens: Math.ceil(groups[0].text.length / 4),
      },
    ]);
  });
});

describe("resolveThreadRunMode", () => {
  it("treats child and plugin-originated threads as unattended", () => {
    expect(
      resolveThreadRunMode({ parentThreadId: null, originPluginId: null }),
    ).toBe("attended");
    expect(
      resolveThreadRunMode({ parentThreadId: "thr_parent", originPluginId: null }),
    ).toBe("unattended");
    expect(
      resolveThreadRunMode({ parentThreadId: null, originPluginId: "automations" }),
    ).toBe("unattended");
  });
});
