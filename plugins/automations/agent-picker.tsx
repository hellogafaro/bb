import { useEffect, useState } from "react";
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";

type AgentResult = Awaited<
  ReturnType<PluginBrowserBbSdk["agents"]["list"]>
>[number];

export function useAutomationAgents(): readonly AgentResult[] | null {
  const sdk = useSdk();
  const [agents, setAgents] = useState<readonly AgentResult[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    sdk.agents.list({ signal: controller.signal }).then(
      (next) => setAgents(next),
      () => {
        if (!controller.signal.aborted) setAgents([]);
      },
    );
    return () => controller.abort();
  }, [sdk]);
  return agents;
}

export function automationAgentLabel(
  agents: readonly AgentResult[] | null,
  agentId: string | null,
): string {
  if (agents === null) return agentId ?? "Default agent";
  const agent =
    agentId === null ? undefined : agents.find((entry) => entry.id === agentId);
  if (agent !== undefined) return agent.name;
  const fallback = agents[0];
  return fallback === undefined ? "Default agent" : `${fallback.name} (default)`;
}

function agentDescription(agent: AgentResult): string {
  return `${agent.providerId} · ${agent.model ?? "default model"}`;
}

export function AutomationAgentPicker({
  agents,
  agentId,
  disabled,
  onChange,
}: {
  agents: readonly AgentResult[] | null;
  agentId: string | null;
  disabled: boolean;
  onChange?: (agentId: string | null) => void;
}) {
  const label = automationAgentLabel(agents, agentId);
  const readOnly = onChange === undefined;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled || readOnly}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Agent"
          className="h-6 max-w-full gap-1.5 px-2 text-xs text-muted-foreground"
        >
          <Icon name="Bot" className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{label}</span>
          {readOnly ? null : (
            <Icon name="ChevronDown" className="size-3 shrink-0" aria-hidden />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => onChange?.(null)}>
          <span className="flex min-w-0 flex-col">
            <span>Default agent</span>
            <span className="text-xs text-muted-foreground">
              Whichever agent is the default when the automation runs
            </span>
          </span>
        </DropdownMenuItem>
        {(agents ?? []).map((agent) => (
          <DropdownMenuItem key={agent.id} onSelect={() => onChange?.(agent.id)}>
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{agent.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {agentDescription(agent)}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
