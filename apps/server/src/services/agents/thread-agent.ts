import { getDefaultAgent, setThreadExecutionOverride } from "@bb/db";
import type { Agent, ReasoningLevel, Thread } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import type { ThreadCreateServiceRequestInput } from "../threads/thread-create-request.js";
import {
  agentPermissionMode,
  requireAgentByRef,
  resolveThreadAgent,
} from "./agents.js";

interface ResolveCreateThreadAgentArgs {
  input: ThreadCreateServiceRequestInput;
  sourceThread: Thread | null;
}

interface PinnedThreadExecution {
  model: string | null;
  reasoningLevel: ReasoningLevel | null;
}

export interface CreateThreadAgentResolution {
  agentId: string | null;
  input: ThreadCreateServiceRequestInput;
  pinned: PinnedThreadExecution;
}

const NOTHING_PINNED: PinnedThreadExecution = {
  model: null,
  reasoningLevel: null,
};

function withoutAgentExecution(
  input: ThreadCreateServiceRequestInput,
): ThreadCreateServiceRequestInput {
  const {
    agentId: _agentId,
    executionInputSources: _executionInputSources,
    model: _model,
    permissionMode: _permissionMode,
    providerId: _providerId,
    reasoningLevel: _reasoningLevel,
    ...rest
  } = input;
  return rest;
}

export function agentModelForThread(
  agent: Pick<
    Agent,
    "model" | "reasoningLevel" | "secondaryModel" | "secondaryReasoningLevel"
  >,
  isChildThread: boolean,
): { model: string | null; reasoningLevel: ReasoningLevel } {
  if (!isChildThread || agent.secondaryModel === null) {
    return { model: agent.model, reasoningLevel: agent.reasoningLevel };
  }
  return {
    model: agent.secondaryModel,
    reasoningLevel: agent.secondaryReasoningLevel ?? agent.reasoningLevel,
  };
}

function agentExecutionInput(
  deps: Pick<AppDeps, "providerRegistry">,
  agent: Agent,
  input: ThreadCreateServiceRequestInput,
): ThreadCreateServiceRequestInput {
  const execution = agentModelForThread(
    agent,
    input.parentThreadId !== undefined,
  );
  return {
    ...withoutAgentExecution(input),
    providerId: agent.providerId,
    ...(execution.model !== null ? { model: execution.model } : {}),
    reasoningLevel: execution.reasoningLevel,
    permissionMode: agentPermissionMode(
      deps.providerRegistry,
      agent.providerId,
    ),
  };
}

function callerExecutionInput(
  deps: Pick<AppDeps, "providerRegistry">,
  agent: Agent,
  input: ThreadCreateServiceRequestInput,
): CreateThreadAgentResolution {
  const providerId = input.providerId ?? agent.providerId;
  const sameProvider = providerId === agent.providerId;
  const model = input.model ?? (sameProvider ? agent.model : null);
  const reasoningLevel =
    input.reasoningLevel ?? (sameProvider ? agent.reasoningLevel : undefined);
  return {
    agentId: agent.id,
    input: {
      ...withoutAgentExecution(input),
      providerId,
      ...(model !== null ? { model } : {}),
      ...(reasoningLevel !== undefined ? { reasoningLevel } : {}),
      permissionMode: agentPermissionMode(deps.providerRegistry, providerId),
    },
    pinned: {
      model: input.model ?? null,
      reasoningLevel: input.reasoningLevel ?? null,
    },
  };
}

export function resolveCreateThreadAgent(
  deps: Pick<AppDeps, "db" | "providerRegistry">,
  args: ResolveCreateThreadAgentArgs,
): CreateThreadAgentResolution {
  const requested =
    args.input.agentId === undefined
      ? null
      : requireAgentByRef(deps, args.input.agentId);
  if (args.input.originKind !== undefined && args.input.originKind !== null) {
    const agent =
      requested ??
      (args.sourceThread !== null
        ? resolveThreadAgent(deps, args.sourceThread)
        : getDefaultAgent(deps.db));
    if (agent === null) {
      return { agentId: null, input: args.input, pinned: NOTHING_PINNED };
    }
    const { agentId: _agentId, ...rest } = args.input;
    const providerId = rest.providerId ?? agent.providerId;
    return {
      agentId: agent.id,
      input: {
        ...rest,
        permissionMode: agentPermissionMode(deps.providerRegistry, providerId),
      },
      pinned: NOTHING_PINNED,
    };
  }
  if (requested !== null) {
    return {
      agentId: requested.id,
      input: agentExecutionInput(deps, requested, args.input),
      pinned: NOTHING_PINNED,
    };
  }
  const agent = getDefaultAgent(deps.db);
  if (agent === null) {
    const { agentId: _agentId, ...rest } = args.input;
    return { agentId: null, input: rest, pinned: NOTHING_PINNED };
  }
  if (args.input.providerId === undefined && args.input.model === undefined) {
    return {
      agentId: agent.id,
      input: agentExecutionInput(deps, agent, args.input),
      pinned: NOTHING_PINNED,
    };
  }
  return callerExecutionInput(deps, agent, args.input);
}

export function pinThreadExecution(
  deps: Pick<AppDeps, "db">,
  args: { threadId: string; pinned: PinnedThreadExecution },
): void {
  if (args.pinned.model === null && args.pinned.reasoningLevel === null) {
    return;
  }
  setThreadExecutionOverride(deps.db, {
    threadId: args.threadId,
    ...(args.pinned.model !== null ? { modelOverride: args.pinned.model } : {}),
    ...(args.pinned.reasoningLevel !== null
      ? { reasoningLevelOverride: args.pinned.reasoningLevel }
      : {}),
  });
}

export interface ThreadAgentExecution {
  model: string | undefined;
  permissionMode: ReturnType<typeof agentPermissionMode> | undefined;
  reasoningLevel: ReasoningLevel | undefined;
}

export function resolveThreadAgentExecution(
  deps: Pick<AppDeps, "db" | "providerRegistry">,
  thread: Pick<Thread, "agentId" | "providerId" | "parentThreadId">,
): ThreadAgentExecution {
  const agent = resolveThreadAgent(deps, thread);
  if (agent === null) {
    return {
      model: undefined,
      permissionMode: undefined,
      reasoningLevel: undefined,
    };
  }
  const sameProvider = agent.providerId === thread.providerId;
  const execution = agentModelForThread(agent, thread.parentThreadId !== null);
  return {
    model: sameProvider ? (execution.model ?? undefined) : undefined,
    permissionMode: agentPermissionMode(
      deps.providerRegistry,
      thread.providerId,
    ),
    reasoningLevel: sameProvider ? execution.reasoningLevel : undefined,
  };
}
