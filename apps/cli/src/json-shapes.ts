export const JSON_SHAPE_BY_COMMAND_PATH: Readonly<Record<string, string>> = {
  search:
    "{query, groups: [{kind, results: [{id, kind, label, destination, matchClass, highlights, ...}], nextCursor?}]}    (continuations return one group)",
  status:
    "{project: {id, name} | null, thread: {id, status, title, parentThreadId, environment: {hostId, display} | null} | null, childThreads: [{id, status, title}] | null, pendingTodos, pluginsNeedingAttention: [{id, status}], dataDir}",
  "thread list":
    "[{id, projectId, environmentId, providerId, title, status, parentThreadId, sectionId, visibility, archivedAt, pinnedAt, createdAt, updatedAt, activity}]    (bare array; title can be null)",
  "thread show":
    "{thread: {id, status, title, projectId, environmentId, parentThreadId, ...}, environment: {id, hostId, path, branchName, ...} | null, pendingTodos}    (thread fields are under .thread)",
  "thread log":
    "[{id, seq, type, createdAt, threadId, scope, data}]    (bare array of raw events, oldest first; page with --after-seq <seq>)",
  "thread output": "{output}",
  "thread spawn":
    "the created thread: {id, status, title, projectId, environmentId, ...}",
  "thread wait": "{threadId, matched: true, target}",
  "thread search": "{active: {total, results}, archived: {total, results}}",
  "project list":
    "[{id, kind, name, gitRemoteUrl, sources: [{id, hostId, path, isDefault}]}]    (bare array)",
  "machine list":
    "[{id, name, type, status, lifecycle, maxPermissionMode, lastSeenAt}]    (bare array)",
  "provider list":
    "[{id, displayName, available, capabilities, reasoningLevels, serviceTiers}]    (bare array)",
  "provider models":
    "[{id, model, displayName, supportedReasoningEfforts, defaultReasoningEffort, isDefault}]    (bare array)",
  "environment list":
    "[{id, name, projectId, hostId, path, branchName, status, lifecycle}]    (bare array)",
  "environment show":
    "{id, name, projectId, hostId, path, branchName, baseBranch, status, lifecycle}",
  "terminal list":
    "{sessions: [{id, title, status, exitCode, closeReason, cols, rows}]}    (wrapped in .sessions)",
  "terminal output":
    '{chunks: [{seq, dataBase64}], nextSeq, truncated, status, exitCode, closeReason}    (chunk data is base64; status is "exited" once the command has finished)',
  "terminal wait": "{terminalId, matched, nextSeq, exitCode}",
  "plugin list":
    "{plugins: [{id, version, enabled, status, source, rootDir}]}    (wrapped in .plugins)",
  "skill list":
    "{skills: [{id, name, description, scope, provider, filePath}]}    (wrapped in .skills)",
  "mcp list":
    "[{id, handle, type, status, tools}]    (bare array; tools is absent until the catalog is known; --details prints full records as in bb mcp show)",
  "mcp show":
    "{id, handle, name, description, type, status, sourceKind, enabled, authStatus, lastError, sourceRef, registryName, registryVersion, config, toolCount, promptCount, resourceCount, guide}",
  "mcp tools":
    "{tools: [{id, server, name, description, risk?, policy?, input?, schemaRequired?}], unavailable?}    (wrapped in .tools)",
  "mcp policy":
    "[{tool, risk, mode, policy}]    (bare array; one object when a tool is named)",
  "mcp providers":
    "{hostId, status: {claude: {settingsPath, connectorsDisabled, mcpServers}, codex: {configPath, mcpServers}}, issues: [{provider, message}], text}",
};

export function jsonShapeHelp(commandPath: string): string | null {
  const shape = JSON_SHAPE_BY_COMMAND_PATH[commandPath];
  return shape === undefined
    ? null
    : `\nJSON (--json): ${shape}\nErrors with --json: {"ok": false, "error": {code, message, hint?}} on stdout. Run \`bb guide json\` for every shape.`;
}
