import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { Agent, ReasoningLevel } from "@bb/domain";
import { defaultAgent, useAgents } from "@/hooks/queries/agent-queries";

export const composerAgentIdAtom = atomWithStorage<string | null>(
  "bb:composer-agent",
  null,
);

export interface ComposerAgentSelection {
  agents: readonly Agent[];
  selected: Agent | null;
  select: (agentId: string) => void;
}

export function resolveComposerAgent(
  agents: readonly Agent[],
  selectedAgentId: string | null,
): Agent | null {
  const selected =
    selectedAgentId === null
      ? undefined
      : agents.find((agent) => agent.id === selectedAgentId);
  return selected ?? defaultAgent(agents);
}

export function useComposerAgent(): ComposerAgentSelection {
  const agentsQuery = useAgents();
  const [selectedAgentId, setSelectedAgentId] = useAtom(composerAgentIdAtom);
  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const selected = resolveComposerAgent(agents, selectedAgentId);
  const select = useCallback(
    (agentId: string) => setSelectedAgentId(agentId),
    [setSelectedAgentId],
  );
  return { agents, selected, select };
}

interface ComposerExecutionSelection {
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel;
}

interface ApplyComposerAgentArgs {
  agent: Agent | null;
  selection: ComposerExecutionSelection;
  setProviderModelReasoning: (selection: ComposerExecutionSelection) => void;
  setReasoningLevel: (level: ReasoningLevel) => void;
  setSelectedProviderId: (providerId: string) => void;
}

function agentSignature(agent: Agent): string {
  return [
    agent.id,
    agent.providerId,
    agent.model ?? "",
    agent.reasoningLevel,
  ].join("\0");
}

export function useApplyComposerAgent({
  agent,
  selection,
  setProviderModelReasoning,
  setReasoningLevel,
  setSelectedProviderId,
}: ApplyComposerAgentArgs): void {
  const appliedRef = useRef<string | null>(null);
  const signature = agent === null ? null : agentSignature(agent);
  useEffect(() => {
    if (agent === null || signature === null) return;
    if (appliedRef.current === signature) return;
    appliedRef.current = signature;
    if (agent.model !== null) {
      if (
        selection.providerId !== agent.providerId ||
        selection.model !== agent.model ||
        selection.reasoningLevel !== agent.reasoningLevel
      ) {
        setProviderModelReasoning({
          providerId: agent.providerId,
          model: agent.model,
          reasoningLevel: agent.reasoningLevel,
        });
      }
      return;
    }
    if (selection.providerId !== agent.providerId) {
      setSelectedProviderId(agent.providerId);
    }
    if (selection.reasoningLevel !== agent.reasoningLevel) {
      setReasoningLevel(agent.reasoningLevel);
    }
  }, [
    agent,
    selection.model,
    selection.providerId,
    selection.reasoningLevel,
    setProviderModelReasoning,
    setReasoningLevel,
    setSelectedProviderId,
    signature,
  ]);
}
