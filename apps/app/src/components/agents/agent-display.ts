import type { Agent, ProviderInfo } from "@bb/domain";
import { reasoningLevelLabel } from "@/lib/reasoning-labels";

export function providerDisplayName(
  providers: readonly ProviderInfo[] | undefined,
  providerId: string,
): string {
  return (
    providers?.find((provider) => provider.id === providerId)?.displayName ??
    providerId
  );
}

export function formatAgentModel(model: string): string {
  const words: string[] = [];
  for (const part of model.split("-")) {
    const previous = words.at(-1);
    if (
      /^\d+(\.\d+)*$/.test(part) &&
      previous !== undefined &&
      /\d$/.test(previous)
    ) {
      words[words.length - 1] = `${previous}.${part}`;
    } else if (/^gpt$/i.test(part)) {
      words.push("GPT");
    } else if (/^[a-z]+$/i.test(part)) {
      words.push(part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
    } else {
      words.push(part);
    }
  }
  return words.join(" ");
}

export function agentModelLabel(agent: Pick<Agent, "model">): string {
  return agent.model === null ? "Default model" : formatAgentModel(agent.model);
}

export function agentExecutionLabel(
  agent: Pick<Agent, "providerId" | "model">,
  providers: readonly ProviderInfo[] | undefined,
): string {
  return `${providerDisplayName(providers, agent.providerId)} · ${agentModelLabel(agent)}`;
}

export function agentOptionDetail(
  agent: Pick<Agent, "providerId" | "model" | "reasoningLevel">,
  providers: readonly ProviderInfo[] | undefined,
): string {
  const provider = providers?.find((entry) => entry.id === agent.providerId);
  return `${agentExecutionLabel(agent, providers)} · ${reasoningLevelLabel(agent.reasoningLevel, provider)}`;
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
