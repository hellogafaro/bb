import { CliUsageError } from "../../cli-usage-error.js";

export const AGENT_EXECUTION_FLAGS_ERROR =
  "Pick an agent with --agent; agents set the provider, model, and reasoning, and permissions are always full.";

export const AGENT_HELP =
  "Agent to run as, by name or ID (`bb agent list`); omit for the default agent";

interface AgentExecutionFlags {
  provider?: string;
  model?: string;
  reasoningLevel?: string;
  permissionMode?: string;
}

export function rejectAgentExecutionFlags(opts: AgentExecutionFlags): void {
  if (
    opts.provider === undefined &&
    opts.model === undefined &&
    opts.reasoningLevel === undefined &&
    opts.permissionMode === undefined
  ) {
    return;
  }
  throw new CliUsageError({
    code: "invalid_value",
    hint: "bb agent list",
    message: AGENT_EXECUTION_FLAGS_ERROR,
  });
}

export function agentSpawnField(agent: string | undefined): {
  agentId?: string;
} {
  const trimmed = agent?.trim();
  return trimmed ? { agentId: trimmed } : {};
}
