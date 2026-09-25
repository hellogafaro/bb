import { memo } from "react";
import { OptionPicker } from "@/components/pickers/OptionPicker";
import { resolveThreadAgent, useAgents } from "@/hooks/queries/agent-queries";
import { useSystemProviders } from "@/hooks/queries/system-queries";
import { agentExecutionLabel } from "./agent-display";
import { agentIconComponent } from "./AgentIcon";

export interface ExecutionAgentConfig {
  agentId: string | null;
  onChange?: (agentId: string) => void;
}

export const AgentPicker = memo(function AgentPicker({
  agentId,
  onChange,
  disabled,
}: ExecutionAgentConfig & { disabled?: boolean }) {
  const agentsQuery = useAgents();
  const providersQuery = useSystemProviders();
  const agents = agentsQuery.data ?? [];
  const agent = resolveThreadAgent(agents, agentId);
  if (agent === null) return null;
  const readOnly = onChange === undefined;
  return (
    <OptionPicker
      label="Agent"
      muted
      modal={false}
      value={agent.id}
      disabled={disabled || readOnly}
      displayOverride={{
        label: agent.name,
        title: `${agent.name} · ${agentExecutionLabel(agent, providersQuery.data)}`,
      }}
      options={agents.map((entry) => ({
        value: entry.id,
        label: entry.name,
        description: agentExecutionLabel(entry, providersQuery.data),
        icon: agentIconComponent(entry.providerId),
      }))}
      onChange={(value) => onChange?.(value)}
    />
  );
});
