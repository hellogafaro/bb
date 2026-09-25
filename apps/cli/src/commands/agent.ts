import { Command } from "commander";
import type { AgentResult, AgentUpdateArgs } from "@bb/sdk";
import { action } from "../action.js";
import { CliUsageError } from "../cli-usage-error.js";
import { createCliBbSdk } from "../client.js";
import { TEXT_FILE_HELP_SUFFIX, resolveTextInput } from "../text-input.js";
import {
  collectOption,
  joinValues,
  outputJson,
  parseReasoningLevel,
  type JsonOutputOptions,
} from "./helpers.js";

const AGENT_FIELDS = [
  "name",
  "description",
  "provider",
  "model",
  "reasoning",
  "skills",
  "mcp",
  "instructions",
] as const;
type AgentField = (typeof AGENT_FIELDS)[number];

interface AgentCreateOptions extends JsonOutputOptions {
  provider?: string;
  model?: string;
  reasoning?: string;
  skill: string[];
  mcp: string[];
  description?: string;
  instructions?: string;
  instructionsFile?: string;
}

interface AgentSetOptions extends JsonOutputOptions {
  clear?: boolean;
  instructionsFile?: string;
}

function usageError(message: string, hint: string | null = null): never {
  throw new CliUsageError({ code: "invalid_value", hint, message });
}

function parseField(value: string): AgentField {
  const field = AGENT_FIELDS.find((entry) => entry === value);
  if (field === undefined) {
    usageError(
      `Unknown agent field '${value}'. Expected ${joinValues(AGENT_FIELDS)}.`,
    );
  }
  return field;
}

function parseNameList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function describeList(values: readonly string[], noun: string): string {
  return values.length === 0
    ? `all ${noun}`
    : `${values.length} ${values.length === 1 ? noun.replace(/s$/u, "") : noun}`;
}

function describeModel(agent: AgentResult): string {
  return `${agent.providerId}/${agent.model ?? "default model"}`;
}

function formatAgentRow(agent: AgentResult, isDefault: boolean): string {
  return [
    agent.name,
    describeModel(agent),
    describeList(agent.skills, "skills"),
    describeList(agent.mcpServers, "MCPs"),
    isDefault ? "(default)" : "",
  ]
    .filter((part) => part.length > 0)
    .join("  ");
}

function formatAgent(agent: AgentResult, isDefault: boolean): string {
  return [
    `Agent: ${agent.name}${isDefault ? " (default)" : ""}`,
    `  ID: ${agent.id}`,
    agent.description ? `  Description: ${agent.description}` : null,
    `  Provider: ${agent.providerId}`,
    `  Model: ${agent.model ?? "provider default"}`,
    `  Reasoning: ${agent.reasoningLevel}`,
    "  Permissions: full",
    `  Skills: ${agent.skills.length === 0 ? "all" : agent.skills.join(", ")}`,
    `  MCPs: ${agent.mcpServers.length === 0 ? "all enabled" : agent.mcpServers.join(", ")}`,
    agent.instructions ? `  Instructions:\n${indent(agent.instructions)}` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

async function isDefaultAgent(
  sdk: ReturnType<typeof createCliBbSdk>,
  agent: AgentResult,
): Promise<boolean> {
  const agents = await sdk.agents.list();
  return agents[0]?.id === agent.id;
}

async function resolveInstructions(
  inline: string | undefined,
  file: string | undefined,
): Promise<string | undefined> {
  return resolveTextInput({
    file,
    fileLabel: "--instructions-file",
    inline,
    inlineLabel: "--instructions <text>",
  });
}

async function buildSetPatch(
  field: AgentField,
  value: string | undefined,
  opts: AgentSetOptions,
): Promise<Omit<AgentUpdateArgs, "agent">> {
  if (opts.clear) {
    if (value !== undefined || opts.instructionsFile !== undefined) {
      usageError("Pass either a value or --clear, not both.");
    }
    switch (field) {
      case "model":
        return { model: null };
      case "skills":
        return { skills: [] };
      case "mcp":
        return { mcpServers: [] };
      case "description":
        return { description: "" };
      case "instructions":
        return { instructions: "" };
      case "name":
      case "provider":
      case "reasoning":
        usageError(`The ${field} field cannot be cleared.`);
    }
  }
  if (field === "instructions") {
    const instructions = await resolveInstructions(
      value,
      opts.instructionsFile,
    );
    if (instructions === undefined) {
      usageError(
        "Missing instructions.",
        "Pass the text, --instructions-file <path>, or --clear.",
      );
    }
    return { instructions };
  }
  if (opts.instructionsFile !== undefined) {
    usageError("--instructions-file only applies to the instructions field.");
  }
  if (value === undefined) {
    usageError(`Missing a value for ${field}.`, "Pass a value or --clear.");
  }
  switch (field) {
    case "name":
      return { name: value };
    case "description":
      return { description: value };
    case "provider":
      return { providerId: value };
    case "model":
      return { model: value };
    case "reasoning": {
      const reasoningLevel = parseReasoningLevel(value);
      return reasoningLevel === undefined ? {} : { reasoningLevel };
    }
    case "skills":
      return { skills: parseNameList(value) };
    case "mcp":
      return { mcpServers: parseNameList(value) };
  }
}

export function registerAgentCommands(
  program: Command,
  getUrl: () => string,
): void {
  const agent = program
    .command("agent")
    .description(
      "Manage agents: the provider, model, skills, MCPs, and instructions a thread runs as",
    );

  agent
    .command("list")
    .description("List agents; the first one is the default")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const agents = await createCliBbSdk(getUrl()).agents.list();
        if (outputJson(opts, agents)) return;
        console.log(
          agents.length === 0
            ? "No agents. Try: bb agent create Coder"
            : agents
                .map((entry, index) => formatAgentRow(entry, index === 0))
                .join("\n"),
        );
      }),
    );

  agent
    .command("show <agent>")
    .description("Show one agent by name or ID")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (ref: string, opts: JsonOutputOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const record = await sdk.agents.get({ agent: ref });
        if (outputJson(opts, record)) return;
        console.log(formatAgent(record, await isDefaultAgent(sdk, record)));
      }),
    );

  agent
    .command("create <name>")
    .description(
      "Create an agent; omitted fields use the default agent's provider and model, medium reasoning, all skills, and all MCPs",
    )
    .option("--provider <id>", "Provider ID (see `bb provider list`)")
    .option("--model <model>", "Model ID; omit for the provider's default")
    .option(
      "--reasoning <level>",
      "Reasoning level: low, medium, high, xhigh, max (provider-dependent)",
    )
    .option(
      "--skill <name>",
      "BB skill the agent may use; repeat for more (omit for all skills)",
      collectOption,
      [],
    )
    .option(
      "--mcp <handle>",
      "MCP server handle the agent may use; repeat for more (omit for all enabled MCPs)",
      collectOption,
      [],
    )
    .option("--description <text>", "One-line description")
    .option("--instructions <text>", "Instructions appended to every thread")
    .option(
      "--instructions-file <path>",
      `Read instructions from a file; ${TEXT_FILE_HELP_SUFFIX}`,
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (name: string, opts: AgentCreateOptions) => {
        const instructions = await resolveInstructions(
          opts.instructions,
          opts.instructionsFile,
        );
        const reasoningLevel = parseReasoningLevel(opts.reasoning);
        const created = await createCliBbSdk(getUrl()).agents.create({
          name,
          ...(opts.provider ? { providerId: opts.provider } : {}),
          ...(opts.model ? { model: opts.model } : {}),
          ...(reasoningLevel ? { reasoningLevel } : {}),
          ...(opts.skill.length > 0 ? { skills: opts.skill } : {}),
          ...(opts.mcp.length > 0 ? { mcpServers: opts.mcp } : {}),
          ...(opts.description !== undefined
            ? { description: opts.description }
            : {}),
          ...(instructions !== undefined ? { instructions } : {}),
        });
        if (outputJson(opts, created)) return;
        console.log(`Created agent ${created.name} (${created.id})`);
      }),
    );

  agent
    .command("set <agent> <field> [value]")
    .description(
      `Change one field: ${AGENT_FIELDS.join(", ")}. Skills and mcp take comma lists; --clear resets model, skills, mcp, description, or instructions`,
    )
    .option("--clear", "Clear the field")
    .option(
      "--instructions-file <path>",
      `Read instructions from a file; ${TEXT_FILE_HELP_SUFFIX}`,
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          ref: string,
          rawField: string,
          value: string | undefined,
          opts: AgentSetOptions,
        ) => {
          const field = parseField(rawField);
          const patch = await buildSetPatch(field, value, opts);
          const updated = await createCliBbSdk(getUrl()).agents.update({
            agent: ref,
            ...patch,
          });
          if (outputJson(opts, updated)) return;
          console.log(`Updated agent ${updated.name} (${field})`);
        },
      ),
    );

  agent
    .command("remove <agent>")
    .alias("rm")
    .description(
      "Delete an agent; its threads fall back to the default agent. The last agent cannot be deleted",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (ref: string, opts: JsonOutputOptions) => {
        const removed = await createCliBbSdk(getUrl()).agents.remove({
          agent: ref,
        });
        if (outputJson(opts, removed)) return;
        console.log(`Removed agent ${ref} (${removed.id})`);
      }),
    );
}
