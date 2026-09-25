import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { Agent, ReasoningLevel } from "@bb/domain";
import { defaultAgent, useAgents } from "@/hooks/queries/agent-queries";

export const composerAgentByProjectAtom = atomWithStorage<
  Record<string, string>
>("bb:composer-agent-by-project", {});

export interface ComposerAgentSelection {
  agents: readonly Agent[];
  selected: Agent | null;
  select: (agentId: string) => void;
}

export function resolveComposerAgent(
  agents: readonly Agent[],
  rememberedAgentId: string | undefined,
): Agent | null {
  const remembered =
    rememberedAgentId === undefined
      ? undefined
      : agents.find((agent) => agent.id === rememberedAgentId);
  return remembered ?? defaultAgent(agents);
}

export function useComposerAgent(projectId: string): ComposerAgentSelection {
  const agentsQuery = useAgents();
  const [byProject, setByProject] = useAtom(composerAgentByProjectAtom);
  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const selected = resolveComposerAgent(agents, byProject[projectId]);
  const select = useCallback(
    (agentId: string) =>
      setByProject((current) => ({ ...current, [projectId]: agentId })),
    [projectId, setByProject],
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
