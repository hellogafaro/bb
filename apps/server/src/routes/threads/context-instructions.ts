import type { Hono } from "hono";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
  type ThreadContextInjectedSkill,
  type ThreadContextInstructionsResponse,
} from "@bb/server-contract";
import type { HostDaemonInjectedSkillSource } from "@bb/host-daemon-contract";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { requirePublicThread } from "../../services/lib/entity-lookup.js";
import { isServerMachineHost } from "../../services/hosts/primary-host.js";
import { readSkillTreeManifest } from "../../services/skills/injected-skills.js";
import { requireThreadCommandEnvironment } from "../../services/threads/thread-command-environment.js";
import { tryResolveExistingThreadExecutionPlan } from "../../services/threads/thread-execution-plan.js";
import {
  resolveThreadRuntimeCommandConfig,
  type ResolvedThreadRuntimeCommandConfig,
} from "../../services/threads/thread-runtime-config.js";
import {
  estimateInstructionTokens,
  measureInstructionGroups,
} from "../../services/threads/instruction-sections.js";

function measureSkillRoot(
  rootPath: string | undefined,
): Pick<ThreadContextInjectedSkill, "fileCount" | "bytes"> {
  if (rootPath === undefined) return { fileCount: null, bytes: null };
  try {
    const { entries } = readSkillTreeManifest(rootPath);
    return {
      fileCount: entries.length,
      bytes: entries.reduce((sum, entry) => sum + entry.bytes.length, 0),
    };
  } catch {
    return { fileCount: null, bytes: null };
  }
}

function describeSkillSource(
  deps: Pick<AppDeps, "db" | "skillTreeRegistry">,
  source: HostDaemonInjectedSkillSource,
  hostIsServerMachine: boolean,
): ThreadContextInjectedSkill {
  if (source.kind === "tree") {
    const rootPath = deps.skillTreeRegistry.resolve(source.treeHash);
    return {
      name: source.name,
      sourceType: source.sourceType,
      rootPath: rootPath ?? `skill-tree:${source.treeHash}`,
      ...measureSkillRoot(rootPath),
    };
  }
  return {
    name: source.name,
    sourceType: source.sourceType,
    rootPath: source.sourceRootPath,
    ...measureSkillRoot(hostIsServerMachine ? source.sourceRootPath : undefined),
  };
}

export function buildThreadContextInstructionsResponse(
  deps: Pick<AppDeps, "db" | "skillTreeRegistry">,
  runtime: ResolvedThreadRuntimeCommandConfig,
  hostIsServerMachine: boolean,
): ThreadContextInstructionsResponse {
  return {
    instructionMode: runtime.instructionMode,
    instructions: runtime.instructions,
    chars: runtime.instructions.length,
    estimatedTokens: estimateInstructionTokens(runtime.instructions),
    groups: measureInstructionGroups(runtime.instructionGroups),
    skills: runtime.injectedSkillSources.map((source) =>
      describeSkillSource(deps, source, hostIsServerMachine),
    ),
    dynamicTools: runtime.dynamicTools.map((tool) => tool.name),
    contributedEnv: runtime.contributedEnv.map((entry) => entry.name),
  };
}

export function registerThreadContextInstructionsRoutes(
  app: Hono,
  deps: AppDeps,
): void {
  const { get } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  get(publicApiRoutes.threads.contextInstructions, async (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const environment = await requireThreadCommandEnvironment(deps, { thread });
    const plan = await tryResolveExistingThreadExecutionPlan(deps, {
      executionSource: "client/turn/requested",
      input: {},
      threadId: thread.id,
    });
    const model = plan?.resolvedExecution.model ?? thread.modelOverride;
    if (model === null) {
      throw new ApiError(
        409,
        "invalid_request",
        "Thread has no execution model yet; send it a message first",
      );
    }
    await deps.providerRegistry.whenRegistrationsSettled();
    const runtime = await resolveThreadRuntimeCommandConfig(deps, {
      thread,
      environment: {
        hostId: environment.hostId,
        id: environment.id,
        path: environment.path,
        status: environment.status,
      },
      model,
    });
    return context.json(
      buildThreadContextInstructionsResponse(
        deps,
        runtime,
        isServerMachineHost(deps, environment.hostId),
      ),
    );
  });
}
