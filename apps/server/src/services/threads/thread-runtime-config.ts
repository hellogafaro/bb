import {
  resolveHostEnvironment,
  mergeHostAndProviderEnvironment,
} from "../hosts/host-environment.js";
import {
  getEnvironment,
  getHost,
  getProject,
  getThreadPluginMetadata,
} from "@bb/db";
import type {
  DynamicTool,
  InstructionMode,
  PermissionEscalation,
  Thread,
  ThreadTurnInitiator,
  EnvironmentStatus,
} from "@bb/domain";
import type {
  HostDaemonContributedEnvEntry,
  HostDaemonInjectedSkillSource,
} from "@bb/host-daemon-contract";
import { ApiError } from "../../errors.js";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { throwEnvironmentNotReady } from "../lib/lifecycle-api-errors.js";
import { requireLiveThreadStoragePath } from "./thread-storage.js";
import {
  listPluginAgentTools,
  listPluginInstructionContributions,
  getPluginSkillRootContributions,
  resolvePluginAgentConfiguration,
  resolvePluginProviderEnv,
} from "../plugins/plugin-agent-contributions.js";
import { resolveSkillCatalog } from "../skills/skill-catalog.js";
import { discoverPluginSkillIds } from "../skills/injected-skills.js";
import { resolveWorkspaceProjectSkills } from "../skills/workspace-skills.js";
import { resolveSharedSkills } from "../skills/shared-skills.js";
import { UPDATE_ENVIRONMENT_DIRECTORY_TOOL } from "./thread-environment-directory.js";
import { mcpDynamicToolContributions } from "./mcp-tools.js";
import { currentMcpService } from "../mcp/mcp-service-registry.js";
import { MCP_TOOLS_GUIDANCE, threadServerSelection } from "../mcp/context.js";
import {
  DATA_DIR_AGENT_INSTRUCTIONS_RELATIVE_PATH,
  WORKSPACE_AGENT_INSTRUCTIONS_RELATIVE_PATH,
  readDataDirAgentInstructions,
  readWorkspaceAgentInstructions,
} from "./workspace-agent-instructions.js";
import { resolveDeprecatedWorkspaceProvisionType } from "../environments/environment-response.js";
import {
  agentHomeEnvEntry,
  syncThreadAgentMcpScope,
} from "../agents/agent-runtime.js";
import { FORK_NATIVE_WORKSPACE_INSTRUCTIONS } from "../../fork-config.js";
import {
  buildInstructionGroups,
  joinInstructionGroups,
  resolveThreadRunMode,
  type InstructionGroup,
  type InstructionPluginContribution,
  type InstructionRulesSource,
} from "./instruction-sections.js";
import { resolveThreadAgent } from "../agents/agents.js";
import { agentSkillsRootPath, ensureAgentHome } from "../agents/agent-home.js";
import { isServerMachineHost } from "../hosts/primary-host.js";

const UPDATE_ENVIRONMENT_DIRECTORY_INSTRUCTIONS =
  "If the user asks you to move this thread to another checkout, worktree, or directory, make sure the target directory exists, then call `update_environment_directory` with its absolute path. After it succeeds, stop work in the current turn; future turns will run in the updated environment.";

const PLUGIN_INSTRUCTION_CONTRIBUTION_MAX_CHARS = 4096;
const MCP_THREAD_METADATA_KEY = "mcp";

export interface ThreadRuntimeCommandEnvironment {
  hostId: string;
  id: string;
  path: string | null;
  status: EnvironmentStatus;
}

interface ResolveThreadRuntimeCommandConfigArgs {
  environment: ThreadRuntimeCommandEnvironment;
  model: string;
  thread: Thread;
}

interface ResolvePermissionEscalationArgs {
  initiator: ThreadTurnInitiator;
}

export interface ResolvedThreadRuntimeCommandConfig {
  contributedEnv: HostDaemonContributedEnvEntry[];
  dynamicTools: DynamicTool[];
  injectedSkillSources: HostDaemonInjectedSkillSource[];
  instructionGroups: InstructionGroup[];
  instructionMode: InstructionMode;
  instructions: string;
  projectId: string;
  providerId: string;
  threadStoragePath: string;
  workspacePath: string;
}

function requireWorkspacePath(
  environment: ThreadRuntimeCommandEnvironment,
): string {
  if (!environment.path) {
    throwEnvironmentNotReady(environment);
  }

  return environment.path;
}

interface DynamicToolContribution {
  tool: DynamicTool;
  instructions: string | null;
  pluginId: string | null;
}

function resolveDynamicTools(
  pluginTools: ReturnType<typeof listPluginAgentTools>,
  includeMcpTools: boolean,
): DynamicToolContribution[] {
  return [
    {
      tool: UPDATE_ENVIRONMENT_DIRECTORY_TOOL,
      instructions: UPDATE_ENVIRONMENT_DIRECTORY_INSTRUCTIONS,
      pluginId: null,
    },
    ...(includeMcpTools
      ? mcpDynamicToolContributions().map((contribution) => ({
          ...contribution,
          pluginId: null,
        }))
      : []),
    ...pluginTools.map((contribution) => ({
      tool: contribution.tool,
      instructions: contribution.instructions,
      pluginId: contribution.pluginId,
    })),
  ];
}

export function resolvePermissionEscalation(
  args: ResolvePermissionEscalationArgs,
): PermissionEscalation {
  if (args.initiator !== "user") {
    return "deny";
  }

  return "ask";
}

export async function resolveThreadRuntimeCommandConfig(
  deps: LoggedWorkSessionDeps,
  args: ResolveThreadRuntimeCommandConfigArgs,
): Promise<ResolvedThreadRuntimeCommandConfig> {
  const workspacePath = requireWorkspacePath(args.environment);
  const project = getProject(deps.db, args.thread.projectId);
  if (!project) {
    throw new ApiError(404, "project_not_found", "Project not found");
  }
  const environment = getEnvironment(deps.db, args.environment.id);
  if (!environment) {
    throw new ApiError(404, "environment_not_found", "Environment not found");
  }
  const host = getHost(deps.db, args.environment.hostId);
  if (!host) {
    throw new ApiError(404, "host_not_found", "Host not found");
  }

  const [projectSkillSources, sharedSkills, workspaceAgentInstructions] =
    await Promise.all([
      resolveWorkspaceProjectSkills(deps, {
        hostId: args.environment.hostId,
        workspacePath,
      }),
      resolveSharedSkills(deps, {
        hostId: args.environment.hostId,
        cwd: workspacePath,
      }),
      FORK_NATIVE_WORKSPACE_INSTRUCTIONS
        ? null
        : readWorkspaceAgentInstructions(deps, {
            hostId: args.environment.hostId,
            workspacePath,
          }),
    ]);
  const pluginSkillRoots = getPluginSkillRootContributions();
  const skillIdsByPlugin = discoverPluginSkillIds(deps.logger, {
    pluginSkillRoots,
    skillTreeRegistry: deps.skillTreeRegistry,
  });
  const conditionalConfiguration = await resolvePluginAgentConfiguration({
    context: {
      thread: {
        id: args.thread.id,
        title: args.thread.title,
        parentThreadId: args.thread.parentThreadId,
        sourceThreadId: args.thread.sourceThreadId,
      },
      project: {
        id: project.id,
        kind: project.kind,
        name: project.name,
        gitRemoteUrl: project.gitRemoteUrl,
      },
      environment: {
        id: environment.id,
        name: environment.name,
        path: environment.path,
        branchName: environment.branchName,
        workspaceProvisionType: resolveDeprecatedWorkspaceProvisionType(
          environment.environmentProviderId,
        ),
      },
      host: { id: host.id, name: host.name },
      provider: {
        id: args.thread.providerId,
        model: args.model,
        capabilities: {
          supportsNativeUserQuestion:
            deps.providerRegistry.get(args.thread.providerId)?.info.capabilities
              .supportsNativeUserQuestion ?? false,
        },
      },
      origin: {
        kind: args.thread.originKind,
        pluginId: args.thread.originPluginId,
      },
    },
    skillIdsByPlugin,
  });
  const contributedEnv = mergeHostAndProviderEnvironment(
    await resolveHostEnvironment(deps, {
      hostId: host.id,
      projectId: project.id,
    }),
    await resolvePluginProviderEnv({
      providerId: args.thread.providerId,
      context: {
        threadId: args.thread.id,
        projectId: project.id,
        hostId: host.id,
      },
    }),
  );
  const agent = resolveThreadAgent(deps, args.thread);
  const agentHomePath =
    agent !== null && isServerMachineHost(deps, host.id)
      ? ensureAgentHome(deps.config.dataDir, agent)
      : null;
  const runtimeEnv =
    agent !== null && agentHomePath !== null
      ? mergeHostAndProviderEnvironment(contributedEnv, [
          agentHomeEnvEntry(agent, agentHomePath),
        ])
      : contributedEnv;
  const injectedSkillSources = resolveSkillCatalog(deps, {
    ...(agent !== null
      ? { agentSkillsRootPath: agentSkillsRootPath(deps.config.dataDir, agent) }
      : {}),
    projectSkillSources,
    sharedSkillSources: sharedSkills.runtimeSources,
    pluginSkillSelections: conditionalConfiguration.selectedSkillIdsByPlugin,
    ...(agent !== null ? { skillNames: agent.skills } : {}),
  }).map((entry) => entry.runtimeSource);
  const dataDirAgentInstructions = readDataDirAgentInstructions(
    deps.logger,
    deps.config.dataDir,
  );
  const mcpService = currentMcpService();
  const includeMcpTools = mcpService?.hasEnabledServers() ?? false;
  const dynamicToolContributions = resolveDynamicTools(
    conditionalConfiguration.tools,
    includeMcpTools,
  );
  const dynamicTools = dynamicToolContributions.map(
    (contribution) => contribution.tool,
  );
  syncThreadAgentMcpScope(deps, { agent, threadId: args.thread.id });
  const mcpInstructions = mcpService?.instructions(
    threadServerSelection(
      getThreadPluginMetadata(deps.db, args.thread.id, MCP_THREAD_METADATA_KEY)
        .metadata,
    ),
  );
  const pluginInstructions: InstructionPluginContribution[] = [];
  for (const contribution of listPluginInstructionContributions()) {
    let text: string | null;
    try {
      text = contribution.provider({
        threadId: args.thread.id,
        projectId: args.thread.projectId,
      });
    } catch (error) {
      deps.logger.warn(
        {
          err: error,
          pluginId: contribution.pluginId,
          threadId: args.thread.id,
        },
        "Plugin instruction contribution threw; skipping",
      );
      continue;
    }
    if (text === null || text.trim().length === 0) continue;
    if (text.length > PLUGIN_INSTRUCTION_CONTRIBUTION_MAX_CHARS) {
      text = text.slice(0, PLUGIN_INSTRUCTION_CONTRIBUTION_MAX_CHARS);
    }
    pluginInstructions.push({ pluginId: contribution.pluginId, text });
  }
  const rules: InstructionRulesSource[] = [];
  if (dataDirAgentInstructions) {
    rules.push({
      source: `<dataDir>/${DATA_DIR_AGENT_INSTRUCTIONS_RELATIVE_PATH}`,
      text: dataDirAgentInstructions,
    });
  }
  if (workspaceAgentInstructions) {
    rules.push({
      source: WORKSPACE_AGENT_INSTRUCTIONS_RELATIVE_PATH,
      text: workspaceAgentInstructions,
    });
  }
  const instructionGroups = buildInstructionGroups({
    tools: dynamicToolContributions.map((contribution) => ({
      pluginId: contribution.pluginId,
      toolName: contribution.tool.name,
      instructions: contribution.instructions,
    })),
    toolGuidance: includeMcpTools ? [MCP_TOOLS_GUIDANCE] : [],
    connectedMcps: mcpInstructions ?? null,
    pluginInstructions,
    dynamicInstructions: conditionalConfiguration.dynamicInstructions,
    rules,
    agent:
      agent === null
        ? null
        : {
            name: agent.name,
            instructions: agent.instructions,
            homePath: agentHomePath,
          },
    runMode: resolveThreadRunMode(args.thread),
  });
  const instructions = joinInstructionGroups(instructionGroups);
  const threadStoragePath = await requireLiveThreadStoragePath(deps, {
    hostId: args.environment.hostId,
    threadId: args.thread.id,
  });
  return {
    contributedEnv: runtimeEnv,
    dynamicTools,
    injectedSkillSources,
    instructionGroups,
    instructionMode: "append",
    instructions,
    projectId: args.thread.projectId,
    providerId: args.thread.providerId,
    threadStoragePath,
    workspacePath,
  };
}
