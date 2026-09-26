import {
  countAgents,
  deleteAgent,
  getAgent,
  getAgentByName,
  getDefaultAgent,
  getLatestProjectExecutionDefaults,
  insertAgent,
  listAgents,
  updateAgent,
} from "@bb/db";
import {
  AGENT_PERMISSION_MODE,
  agentColorForName,
  agentMascotForName,
  DEFAULT_AGENT_COLOR,
  DEFAULT_AGENT_MASCOT,
  DEFAULT_AGENT_NAME,
  type Agent,
  type PermissionMode,
  type ReasoningLevel,
  type Thread,
} from "@bb/domain";
import type {
  AgentResponse,
  CreateAgentRequest,
  UpdateAgentRequest,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import { currentMcpService } from "../mcp/mcp-service-registry.js";
import type { ProviderRegistryService } from "../providers/provider-registry.js";
import { DEFAULT_REASONING_LEVEL } from "../threads/thread-default-policy.js";
import { getSupportedReasoningLevelsForProvider } from "../threads/thread-reasoning-policy.js";
import {
  agentHomePath,
  agentHomeSlug,
  commitAgentHomeBestEffort,
  ensureAgentHome,
  ensureAgentHomesRepo,
  renameAgentHome,
  retireAgentHome,
} from "./agent-home.js";

type AgentDeps = Pick<
  AppDeps,
  "config" | "db" | "hub" | "logger" | "providerRegistry"
>;
type AgentReadDeps = Pick<AppDeps, "db">;

interface AgentExecutionSeed {
  providerId: string;
  model: string | null;
}

function isProviderAvailable(
  registry: ProviderRegistryService,
  providerId: string,
): boolean {
  return registry.get(providerId)?.info.available === true;
}

function defaultProviderId(registry: ProviderRegistryService): string | null {
  const available = registry
    .list()
    .filter((registration) => registration.info.available)
    .map((registration) => registration.info.id);
  const preferred = registry.getUserDefaultProviderId();
  if (preferred !== null && available.includes(preferred)) return preferred;
  return available[0] ?? null;
}

function resolveDefaultAgentSeed(
  deps: Pick<AppDeps, "db" | "providerRegistry">,
): AgentExecutionSeed | null {
  const remembered = getLatestProjectExecutionDefaults(deps.db);
  if (
    remembered !== null &&
    isProviderAvailable(deps.providerRegistry, remembered.providerId)
  ) {
    return { providerId: remembered.providerId, model: remembered.model };
  }
  const providerId = defaultProviderId(deps.providerRegistry);
  return providerId === null ? null : { providerId, model: null };
}

export function agentPermissionMode(
  registry: ProviderRegistryService,
  providerId: string,
): PermissionMode {
  const supported = registry.getSupportedPermissionModes(providerId);
  if (supported === null || supported.includes(AGENT_PERMISSION_MODE)) {
    return AGENT_PERMISSION_MODE;
  }
  return supported[0] ?? AGENT_PERMISSION_MODE;
}

export function findAgentByRef(deps: AgentReadDeps, ref: string): Agent | null {
  const handle = ref.trim();
  return (
    getAgent(deps.db, handle) ??
    getAgentByName(deps.db, handle) ??
    listAgents(deps.db).find(
      (agent) => agentHomeSlug(agent.name) === agentHomeSlug(handle),
    ) ??
    null
  );
}

export function requireAgentByRef(deps: AgentReadDeps, ref: string): Agent {
  const agent = findAgentByRef(deps, ref);
  if (agent === null) {
    throw new ApiError(404, "agent_not_found", `Agent not found: ${ref}`);
  }
  return agent;
}

export function resolveThreadAgent(
  deps: AgentReadDeps,
  thread: Pick<Thread, "agentId">,
): Agent | null {
  const agent =
    thread.agentId === null ? null : getAgent(deps.db, thread.agentId);
  return agent ?? getDefaultAgent(deps.db);
}

export function listAllAgents(deps: AgentReadDeps): Agent[] {
  return listAgents(deps.db);
}

export function toAgentResponse(
  deps: Pick<AppDeps, "config">,
  agent: Agent,
): AgentResponse {
  return { ...agent, homePath: agentHomePath(deps.config.dataDir, agent) };
}

function assertNameAvailable(
  deps: AgentReadDeps,
  name: string,
  exceptId: string | null,
): void {
  const existing = getAgentByName(deps.db, name);
  if (existing !== null && existing.id !== exceptId) {
    throw new ApiError(
      409,
      "agent_name_taken",
      `An agent named "${existing.name}" already exists`,
    );
  }
  const slug = agentHomeSlug(name);
  const sharesHome = listAgents(deps.db).find(
    (agent) => agent.id !== exceptId && agentHomeSlug(agent.name) === slug,
  );
  if (sharesHome !== undefined) {
    throw new ApiError(
      409,
      "agent_name_taken",
      `The agent "${sharesHome.name}" already uses the home folder "${slug}"`,
    );
  }
}

function assertProvider(
  registry: ProviderRegistryService,
  providerId: string,
): void {
  if (registry.get(providerId) === null) {
    throw new ApiError(
      400,
      "invalid_request",
      `Unknown provider: ${providerId}`,
    );
  }
}

function assertReasoningLevel(
  registry: ProviderRegistryService,
  providerId: string,
  reasoningLevel: ReasoningLevel,
): void {
  const supported = getSupportedReasoningLevelsForProvider(
    registry,
    providerId,
  );
  if (supported.length > 0 && !supported.includes(reasoningLevel)) {
    throw new ApiError(
      400,
      "invalid_request",
      `Provider ${providerId} does not support ${reasoningLevel} reasoning. Supported: ${supported.join(", ")}.`,
    );
  }
}

function normalizeMcpServers(servers: readonly string[]): string[] {
  const mcp = currentMcpService();
  if (mcp === null || servers.length === 0) return [...servers];
  const known = mcp.admin.summaries();
  return servers.map((ref) => {
    const server = known.find(
      (candidate) => candidate.handle === ref || candidate.id === ref,
    );
    if (server === undefined) {
      throw new ApiError(400, "invalid_request", `Unknown MCP server: ${ref}`);
    }
    return server.handle;
  });
}

function runHomeStep(
  deps: Pick<AppDeps, "logger">,
  failure: string,
  step: () => unknown,
): void {
  try {
    step();
  } catch (error) {
    deps.logger.warn({ err: error }, failure);
  }
}

function notifyAgentChanged(deps: Pick<AppDeps, "hub">, agent: Agent): void {
  deps.hub.notifyAgent(agent.id, ["agent-changed"]);
}

export function createAgent(
  deps: AgentDeps,
  request: CreateAgentRequest,
): Agent {
  const name = request.name.trim();
  assertNameAvailable(deps, name, null);
  const fallback = getDefaultAgent(deps.db);
  const seed =
    fallback === null
      ? resolveDefaultAgentSeed(deps)
      : { providerId: fallback.providerId, model: fallback.model };
  const providerId = request.providerId ?? seed?.providerId;
  if (providerId === undefined) {
    throw new ApiError(
      409,
      "no_provider_available",
      "No agent provider is enabled. Pick one with providerId.",
    );
  }
  assertProvider(deps.providerRegistry, providerId);
  const reasoningLevel = request.reasoningLevel ?? DEFAULT_REASONING_LEVEL;
  assertReasoningLevel(deps.providerRegistry, providerId, reasoningLevel);
  const model =
    request.model !== undefined
      ? request.model
      : seed?.providerId === providerId
        ? seed.model
        : null;
  const secondaryReasoningLevel = request.secondaryReasoningLevel ?? null;
  if (secondaryReasoningLevel !== null) {
    assertReasoningLevel(
      deps.providerRegistry,
      providerId,
      secondaryReasoningLevel,
    );
  }
  const agent = insertAgent(deps.db, {
    name,
    description: request.description ?? "",
    providerId,
    model,
    reasoningLevel,
    secondaryModel: request.secondaryModel ?? null,
    secondaryReasoningLevel,
    skills: request.skills ?? [],
    mcpServers: normalizeMcpServers(request.mcpServers ?? []),
    instructions: request.instructions ?? "",
    mascot: request.mascot ?? agentMascotForName(name),
    color: request.color ?? agentColorForName(name),
  });
  ensureAgentHome(deps.config.dataDir, agent);
  notifyAgentChanged(deps, agent);
  return agent;
}

export function updateAgentByRef(
  deps: AgentDeps,
  ref: string,
  request: UpdateAgentRequest,
): Agent {
  const existing = requireAgentByRef(deps, ref);
  const name = request.name?.trim();
  if (name !== undefined) assertNameAvailable(deps, name, existing.id);
  const providerId = request.providerId ?? existing.providerId;
  if (request.providerId !== undefined) {
    assertProvider(deps.providerRegistry, providerId);
  }
  const providerChanged = providerId !== existing.providerId;
  const reasoningLevel = request.reasoningLevel ?? existing.reasoningLevel;
  assertReasoningLevel(deps.providerRegistry, providerId, reasoningLevel);
  const model =
    request.model !== undefined
      ? request.model
      : providerChanged
        ? null
        : undefined;
  const secondaryModel =
    request.secondaryModel !== undefined
      ? request.secondaryModel
      : providerChanged
        ? null
        : undefined;
  const secondaryReasoningLevel =
    request.secondaryReasoningLevel !== undefined
      ? request.secondaryReasoningLevel
      : providerChanged
        ? null
        : undefined;
  if (
    secondaryReasoningLevel !== undefined &&
    secondaryReasoningLevel !== null
  ) {
    assertReasoningLevel(
      deps.providerRegistry,
      providerId,
      secondaryReasoningLevel,
    );
  }
  const updated = updateAgent(deps.db, {
    id: existing.id,
    ...(name !== undefined ? { name } : {}),
    ...(request.description !== undefined
      ? { description: request.description }
      : {}),
    ...(request.providerId !== undefined ? { providerId } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(request.reasoningLevel !== undefined ? { reasoningLevel } : {}),
    ...(secondaryModel !== undefined ? { secondaryModel } : {}),
    ...(secondaryReasoningLevel !== undefined
      ? { secondaryReasoningLevel }
      : {}),
    ...(request.skills !== undefined ? { skills: request.skills } : {}),
    ...(request.mcpServers !== undefined
      ? { mcpServers: normalizeMcpServers(request.mcpServers) }
      : {}),
    ...(request.instructions !== undefined
      ? { instructions: request.instructions }
      : {}),
    ...(request.mascot !== undefined ? { mascot: request.mascot } : {}),
    ...(request.color !== undefined ? { color: request.color } : {}),
  });
  if (updated === null) {
    throw new ApiError(404, "agent_not_found", `Agent not found: ${ref}`);
  }
  const fromSlug = agentHomeSlug(existing.name);
  const toSlug = agentHomeSlug(updated.name);
  runHomeStep(deps, "Agent home rename failed", () =>
    renameAgentHome(deps.config.dataDir, { from: existing, to: updated }),
  );
  if (fromSlug !== toSlug) {
    commitAgentHomeBestEffort(
      { dataDir: deps.config.dataDir, logger: deps.logger },
      {
        slugs: [fromSlug, toSlug],
        message: `${updated.name}: renamed from ${existing.name}`,
      },
    );
  }
  notifyAgentChanged(deps, updated);
  return updated;
}

export function deleteAgentByRef(deps: AgentDeps, ref: string): Agent {
  const agent = requireAgentByRef(deps, ref);
  const removed = deps.db.transaction((tx) => {
    if (countAgents(tx) <= 1) {
      throw new ApiError(
        409,
        "last_agent",
        "Cannot delete the last agent. Create another agent first.",
      );
    }
    return deleteAgent(tx, agent.id);
  });
  if (!removed) {
    throw new ApiError(404, "agent_not_found", `Agent not found: ${ref}`);
  }
  runHomeStep(deps, "Agent home retirement failed", () =>
    retireAgentHome(deps.config.dataDir, agent),
  );
  commitAgentHomeBestEffort(
    { dataDir: deps.config.dataDir, logger: deps.logger },
    { slugs: [agentHomeSlug(agent.name)], message: `${agent.name}: deleted` },
  );
  deps.hub.notifyAgent(agent.id, ["agent-deleted"]);
  return agent;
}

export function ensureDefaultAgent(
  deps: Pick<AppDeps, "config" | "db" | "hub" | "providerRegistry">,
): Agent | null {
  if (countAgents(deps.db) > 0) return null;
  const seed = resolveDefaultAgentSeed(deps);
  if (seed === null) return null;
  const agent = deps.db.transaction((tx) => {
    if (countAgents(tx) > 0) return null;
    return insertAgent(tx, {
      name: DEFAULT_AGENT_NAME,
      description: "The default agent.",
      providerId: seed.providerId,
      model: seed.model,
      reasoningLevel: DEFAULT_REASONING_LEVEL,
      skills: [],
      mcpServers: [],
      instructions: "",
      mascot: DEFAULT_AGENT_MASCOT,
      color: DEFAULT_AGENT_COLOR,
    });
  });
  if (agent !== null) {
    ensureAgentHome(deps.config.dataDir, agent);
    notifyAgentChanged(deps, agent);
  }
  return agent;
}

export async function ensureAgentHomes(
  deps: Pick<AppDeps, "config" | "db">,
): Promise<void> {
  for (const agent of listAgents(deps.db)) {
    ensureAgentHome(deps.config.dataDir, agent);
  }
  await ensureAgentHomesRepo(deps.config.dataDir);
}

export async function seedDefaultAgent(
  deps: Pick<AppDeps, "config" | "db" | "hub" | "logger" | "providerRegistry">,
): Promise<void> {
  await deps.providerRegistry.whenRegistrationsSettled();
  try {
    const agent = ensureDefaultAgent(deps);
    if (agent !== null) {
      deps.logger.info(
        { agentId: agent.id, providerId: agent.providerId },
        "Created the default agent",
      );
    } else if (countAgents(deps.db) === 0) {
      deps.logger.warn(
        "No agent provider is available; the default agent will be created on the next start",
      );
    }
  } catch (error) {
    deps.logger.error({ err: error }, "Default agent seeding failed");
  }
  try {
    await ensureAgentHomes(deps);
  } catch (error) {
    deps.logger.error({ err: error }, "Agent home setup failed");
  }
}
