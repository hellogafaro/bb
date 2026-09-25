import type { Agent, ProviderInfo } from "@bb/domain";
import { formatModelLabel } from "@/hooks/useThreadCreationOptions";

export function providerDisplayName(
  providers: readonly ProviderInfo[] | undefined,
  providerId: string,
): string {
  return (
    providers?.find((provider) => provider.id === providerId)?.displayName ??
    providerId
  );
}

export function agentModelLabel(
  agent: Pick<Agent, "model">,
): string {
  return agent.model === null ? "Default model" : formatModelLabel(agent.model);
}

export function agentExecutionLabel(
  agent: Pick<Agent, "providerId" | "model">,
  providers: readonly ProviderInfo[] | undefined,
): string {
  return `${providerDisplayName(providers, agent.providerId)} · ${agentModelLabel(agent)}`;
}

export function agentScopeLabel(
  names: readonly string[],
  singular: string,
  plural: string,
): string {
  if (names.length === 0) return `all ${plural}`;
  return `${names.length} ${names.length === 1 ? singular : plural}`;
}

export function agentRowSubtitle(
  agent: Agent,
  providers: readonly ProviderInfo[] | undefined,
): string {
  return [
    agentExecutionLabel(agent, providers),
    agentScopeLabel(agent.skills, "skill", "skills"),
    agentScopeLabel(agent.mcpServers, "MCP", "MCPs"),
  ].join(" · ");
}
