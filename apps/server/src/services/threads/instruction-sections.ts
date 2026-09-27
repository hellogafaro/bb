import type { Thread } from "@bb/domain";

export type ThreadRunMode = "attended" | "unattended";

export interface InstructionToolContribution {
  pluginId: string | null;
  toolName: string;
  instructions: string | null;
}

export interface InstructionPluginContribution {
  pluginId: string;
  text: string;
}

export interface InstructionRulesSource {
  source: string;
  text: string;
}

export interface InstructionAgentSection {
  name: string;
  instructions: string;
  homePath: string | null;
}

export interface InstructionGroup {
  tag: string;
  text: string;
}

export interface BuildInstructionGroupsArgs {
  tools: readonly InstructionToolContribution[];
  toolGuidance: readonly string[];
  connectedMcps: string | null;
  pluginInstructions: readonly InstructionPluginContribution[];
  dynamicInstructions: readonly InstructionPluginContribution[];
  rules: readonly InstructionRulesSource[];
  operatingModel: string;
  agent: InstructionAgentSection | null;
  runMode: ThreadRunMode;
}

export interface InstructionGroupMeasurement {
  tag: string;
  chars: number;
  estimatedTokens: number;
}

export const AGENT_HOME_ONLY_INSTRUCTION =
  "Keep your notes, scripts, and reference files in your home folder; it persists across threads and projects.";

export const UNATTENDED_RUN_INSTRUCTIONS =
  "You are operating autonomously. The user is not watching in real time and cannot answer questions mid-task, so asking 'Want me to…?' or 'Shall I…?' blocks the work. For reversible actions that follow from the original request, proceed without asking. A message with no tool call ends your turn and the work stops there. Do not end a turn with: a summary that announces the next step instead of taking it; an offer to continue unless told otherwise; a list of decisions that do not block the remaining work; a report because the turn has been long or a milestone is done. Put status notes and recommendations in the same message as your next tool call and carry on with everything that does not depend on an answer. Stop only when nothing can move without the user, when something blocking you is deliberately protected from you, or before a destructive or hard-to-reverse action, which still requires confirmation. Before ending your turn, check your last paragraph: if it is a plan, a question, or a promise about work not yet done, do that work now.";

const ESTIMATED_CHARS_PER_TOKEN = 4;

function attribute(name: string, value: string): string {
  const escaped = value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return ` ${name}="${escaped}"`;
}

function group(tag: string, attributes: string, body: string): InstructionGroup {
  return {
    tag,
    text: `<${tag}${attributes}>\n${body.trim()}\n</${tag}>`,
  };
}

function toolsGroup(args: BuildInstructionGroupsArgs): InstructionGroup | null {
  const parts: string[] = [];
  for (const tool of args.tools) {
    if (tool.pluginId !== null || !tool.instructions) continue;
    parts.push(tool.instructions.trim());
  }
  parts.push(...args.toolGuidance.map((text) => text.trim()));
  for (const tool of args.tools) {
    if (tool.pluginId === null || !tool.instructions) continue;
    parts.push(
      group(
        "tool",
        attribute("plugin", tool.pluginId) + attribute("name", tool.toolName),
        tool.instructions,
      ).text,
    );
  }
  const body = parts.filter((part) => part.length > 0).join("\n\n");
  return body.length === 0 ? null : group("bb_tools", "", body);
}

function connectedMcpsGroup(text: string | null): InstructionGroup | null {
  const trimmed = text?.trim() ?? "";
  return trimmed.length === 0 ? null : { tag: "connected_mcps", text: trimmed };
}

function pluginGroups(
  contributions: readonly InstructionPluginContribution[],
): InstructionGroup[] {
  return contributions
    .filter((contribution) => contribution.text.trim().length > 0)
    .map((contribution) =>
      group("bb_plugin", attribute("id", contribution.pluginId), contribution.text),
    );
}

function rulesGroups(
  rules: readonly InstructionRulesSource[],
): InstructionGroup[] {
  return rules
    .filter((entry) => entry.text.trim().length > 0)
    .map((entry) =>
      group("bb_rules", attribute("source", entry.source), entry.text),
    );
}

function operatingModelGroup(text: string): InstructionGroup | null {
  return text.trim().length === 0 ? null : group("bb_operating_model", "", text);
}

function agentGroup(agent: InstructionAgentSection | null): InstructionGroup | null {
  if (agent === null) return null;
  const instructions = agent.instructions.trim();
  if (instructions.length === 0 && agent.homePath === null) return null;
  const attributes =
    attribute("name", agent.name) +
    (agent.homePath === null ? "" : attribute("home", agent.homePath));
  return group(
    "bb_agent",
    attributes,
    instructions.length > 0 ? instructions : AGENT_HOME_ONLY_INSTRUCTION,
  );
}

function runGroup(runMode: ThreadRunMode): InstructionGroup | null {
  if (runMode !== "unattended") return null;
  return group("bb_run", attribute("mode", "unattended"), UNATTENDED_RUN_INSTRUCTIONS);
}

export function buildInstructionGroups(
  args: BuildInstructionGroupsArgs,
): InstructionGroup[] {
  return [
    toolsGroup(args),
    connectedMcpsGroup(args.connectedMcps),
    ...pluginGroups(args.pluginInstructions),
    ...pluginGroups(args.dynamicInstructions),
    ...rulesGroups(args.rules),
    operatingModelGroup(args.operatingModel),
    agentGroup(args.agent),
    runGroup(args.runMode),
  ].filter((entry): entry is InstructionGroup => entry !== null);
}

export function joinInstructionGroups(
  groups: readonly InstructionGroup[],
): string {
  return groups.map((entry) => entry.text).join("\n\n");
}

export function estimateInstructionTokens(text: string): number {
  return Math.ceil(text.length / ESTIMATED_CHARS_PER_TOKEN);
}

export function measureInstructionGroups(
  groups: readonly InstructionGroup[],
): InstructionGroupMeasurement[] {
  return groups.map((entry) => ({
    tag: entry.tag,
    chars: entry.text.length,
    estimatedTokens: estimateInstructionTokens(entry.text),
  }));
}

export function resolveThreadRunMode(
  thread: Pick<Thread, "parentThreadId" | "originPluginId">,
): ThreadRunMode {
  return thread.parentThreadId !== null || thread.originPluginId !== null
    ? "unattended"
    : "attended";
}
