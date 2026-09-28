---
kind: instruction
title: bb Guide JSON Output
summary: The --json contract for core bb commands, including output shapes and the error envelope.
intent: Let agents parse bb output on the first try instead of probing its shape.
editingNotes: Every shape here must match real command output. The CLI help JSON lines come from apps/cli/src/json-shapes.ts, and a CLI test fails when that file and this chapter disagree.
---
JSON output

Every core command accepts --json except the plugin authoring tools (`bb plugin
new`, `types`, `migrate`, `build`, `dev`, `run`, `logs`, `update`). Success
prints one JSON value on stdout and exits 0. Nothing else is written to stdout.

Errors

A failed command exits non-zero. With --json it prints this envelope on stdout
and still prints the readable message on stderr:

  {"ok": false, "error": {"code": "unknown_option", "message": "...", "hint": "..."}}

`hint` is present only when bb knows the fix: the flag to add, the nearest
command or option, or the usage line. Codes for mistakes in the invocation:
unknown_command, unknown_option, missing_required, unexpected_argument,
invalid_value, missing_command. A failed server request uses the server's error
code, such as thread_not_found or terminal_output_unavailable; otherwise the
code is http_<status> or error.

Parse stdout only. `2>&1` mixes the readable message into the JSON, and
`2>/dev/null` hides it. Check the exit code, or test `.ok == false`, before
reading fields.

Shapes

List commands do not share one wrapper. Most print a bare array; a few wrap it.
Fields beyond those shown exist; these are the ones scripts use.

  bb search <query> --json
    {query, groups: [{kind, results: [{id, kind, label, destination, matchClass, highlights, ...}], nextCursor?}]}    (continuations return one group)

  bb status --json
    {project: {id, name} | null, thread: {id, status, title, parentThreadId, environment: {hostId, display} | null} | null, childThreads: [{id, status, title}] | null, pendingTodos, pluginsNeedingAttention: [{id, status}], dataDir}

  bb thread list --json
    [{id, projectId, environmentId, providerId, title, status, parentThreadId, sectionId, visibility, archivedAt, pinnedAt, snoozedUntil, agentId, createdAt, updatedAt, activity}]    (bare array; title can be null)

  bb thread show <id> --json
    {thread: {id, status, title, projectId, environmentId, parentThreadId, agentId, ...}, environment: {id, hostId, path, branchName, ...} | null, pendingTodos}    (thread fields are under .thread)

  bb thread log <id> --json
    [{id, seq, type, createdAt, threadId, scope, data}]    (bare array of raw events, oldest first; page with --after-seq <seq>)

  bb thread output <id> --json
    {output}

  bb thread spawn ... --json
    the created thread: {id, status, title, projectId, environmentId, ...}

  bb thread generate-title <id> --json
    the updated thread: {id, status, title, projectId, environmentId, ...}

  bb thread snooze <id> <until> --json
    the updated thread: {id, status, title, snoozedUntil, ...}    (snoozedUntil is epoch ms or null)

  bb thread unsnooze <id> --json
    the updated thread: {id, status, title, snoozedUntil, ...}    (snoozedUntil is epoch ms or null)

  bb thread tell <id> ... --json
    {threadId, ...delivery outcome}

  bb thread wait <id> --json
    {threadId, matched: true, target}

  bb thread count --json
    {total}

  bb thread search <query> --json
    {active: {total, results}, archived: {total, results}}

  bb thread section list --json
    [{id, name, createdAt, updatedAt}]

  bb thread queue list <id> --json, bb thread interactions list <id> --json, bb thread history <id> --json
    bare arrays

  bb inbox --json
    {interactions: [{id, threadId, status, payload, ...}], summaries: [{threadId, goal, state, needs, sourceVersion, updatedAt}], pendingSummaries: [threadId]}    (interactions are the pending rows across threads, newest first; summaries are the model-written goal/state/needs per thread; pendingSummaries lists threads still being summarized)

  bb project list --json
    [{id, kind, name, gitRemoteUrl, color, sources: [{id, hostId, path, isDefault}]}]    (bare array; color is the label palette index 1-24)

  bb project show <id> --json
    {id, kind, name, gitRemoteUrl, color, sources}

  bb machine list --json
    [{id, name, type, status, lifecycle, maxPermissionMode, lastSeenAt}]    (bare array)

  bb provider list --json
    [{id, displayName, available, capabilities, reasoningLevels, serviceTiers}]    (bare array)

  bb provider models [providerId] --json
    [{id, model, displayName, supportedReasoningEfforts, defaultReasoningEffort, isDefault}]    (bare array)

  bb environment list --json
    [{id, name, projectId, hostId, path, branchName, status, lifecycle}]    (bare array)

  bb environment show <id> --json
    {id, name, projectId, hostId, path, branchName, baseBranch, status, lifecycle}

  bb terminal list --thread <id> --json
    {sessions: [{id, title, status, exitCode, closeReason, cols, rows}]}    (wrapped in .sessions)

  bb terminal output <terminalId> --json
    {chunks: [{seq, dataBase64}], nextSeq, truncated, status, exitCode, closeReason}    (chunk data is base64; status is "exited" once the command has finished)

  bb terminal wait <terminalId> ... --json
    {terminalId, matched, nextSeq, exitCode}

  bb plugin list --json
    {plugins: [{id, version, enabled, status, source, rootDir}]}    (wrapped in .plugins)

  bb skill list [--scope <scope>]... [--provider <id>]... --json
    {skills: [{id, name, description, scope, provider, filePath}]}    (wrapped in .skills)

  bb agent list --json
    [{id, name, description, providerId, model, reasoningLevel, secondaryModel, secondaryReasoningLevel, skills, mcpServers, instructions, mascot, color, createdAt, updatedAt, homePath}]    (bare array; the first agent is the default; model null = provider default; empty skills/mcpServers = all; mascot is a pixel sprite name; color is 0 (neutral) or palette 1-8; homePath is the absolute home folder on the server's machine)

  bb agent show <agent> --json
    {id, name, description, providerId, model, reasoningLevel, skills, mcpServers, instructions, mascot, color, createdAt, updatedAt, homePath}

  bb agent create <name> --json
    {id, name, description, providerId, model, reasoningLevel, skills, mcpServers, instructions, mascot, color, createdAt, updatedAt, homePath}

  bb agent set <agent> <field> <value> --json
    {id, name, description, providerId, model, reasoningLevel, skills, mcpServers, instructions, mascot, color, createdAt, updatedAt, homePath}

  bb agent home <agent> --json
    {id, name, homePath}

  bb agent remove <agent> --json
    {deleted: true, id}

  bb mcp list [--details] --json
    [{id, handle, type, status, tools}]    (bare array; tools is absent until the catalog is known; --details prints full records as in bb mcp show)

  bb mcp show <server> --json
    {id, handle, name, description, type, status, sourceKind, enabled, authStatus, lastError, sourceRef, registryName, registryVersion, config, toolCount, promptCount, resourceCount, guide}

  bb mcp add ... --json
    {id, handle, name}

  bb mcp registry <query> --json
    [{name, description, version, status, installable, sourceRef, type, remote, requiredHeaders}]    (bare array)

  bb mcp auth <server> --json
    {url, status}    (url is null when no browser step is needed)

  bb mcp header <server> ... --json, bb mcp remove <server> --json
    {updated: true, id}, {deleted: true, id}

  bb mcp enable <server> --json, bb mcp disable <server> --json
    {enabled, status}

  bb mcp guide <server> [text] [--clear] --json
    {id, handle, guide}

  bb mcp call <tool-id> [json-args] --json
    the MCP tool result: {content, isError?, structuredContent?} or {isError: true, error}

  bb mcp tools <query> --json
    {tools: [{id, server, name, description, risk?, policy?, input?, schemaRequired?}], unavailable?}    (wrapped in .tools)

  bb mcp policy <server> [tool] [mode] --json
    [{tool, risk, mode, policy}]    (bare array; one object when a tool is named)

  bb provider guard [--fix] --json
    {hostId, hostName, status: {claude: {settingsPath, connectorsDisabled, bundledSkillsDisabled, enabledPlugins, mcpServers, pluginsDir, marketplaces, knownMarketplacesFile, installedPlugins, skillsDir, extraSkills}, codex: {configPath, features: [{key, value}], systemSkills: [{name, path, disabled}], mcpServers, pluginCacheDir, pluginCache, skillsDir, extraSkills}}, issues: [{provider, message, fixable}], changes, text}

  bb mcp providers [--fix] --json
    {hostId, hostName, status: {claude: {settingsPath, connectorsDisabled, bundledSkillsDisabled, enabledPlugins, mcpServers, pluginsDir, marketplaces, knownMarketplacesFile, installedPlugins, skillsDir, extraSkills}, codex: {configPath, features: [{key, value}], systemSkills: [{name, path, disabled}], mcpServers, pluginCacheDir, pluginCache, skillsDir, extraSkills}}, issues: [{provider, message, fixable}], changes, text}

  bb computer machines --json
    {machines: [{hostId, name, status, type, lastSeenAt}], currentHostId}

  bb computer doctor --host <id> --json
    {hostId, state, version, probes: [{label, status, message}]}

  bb computer setup --host <id> --json
    {hostId, state, version, probes: [{label, status, message}]}

  bb computer observe --host <id> [--app <name>] --json
    {hostId, surface, title, snapshotId, observedAt, targets: [{index, targetId, role, name, value, bounds, ref, allowedOperations}], hint}

  bb computer act --host <id> --action <json> --json
    {state, summary, observation: {hostId, surface, title, snapshotId, observedAt, targets, hint} | null}

  bb computer screenshot --host <id> [--thread <id>] --json
    {path, mimeType}

  bb computer record --host <id> --action start|stop [--run <id>] --json
    {runId, recording, path, trajectoryPath}

  bb computer start --host <id> --goal <text> --json
    {runId, hostId, mode, goal, state, steps, noProgressSteps, lastSummary, startedAt, updatedAt}

  bb computer status --run <id> --json
    {runId, hostId, mode, goal, state, steps, noProgressSteps, lastSummary, startedAt, updatedAt}

  bb computer cancel --run <id> --json
    {runId, hostId, mode, goal, state, steps, noProgressSteps, lastSummary, startedAt, updatedAt}

  bb computer active-run --host <id> --json
    {runId}    (runId is null when no run is active)

  bb computer take-control --host <id> --client <id> --json
    {owner: "human" | "busy"}

  bb computer release-control --host <id> --client <id> --json
    {released}

  bb computer control-status --host <id> --client <id> --json
    {owner: "you" | "other" | "agent"}

  bb computer preview --host <id> --viewer <id> --json
    {sequence, state, mimeType, dataBase64, width, height, capturedAt}

  bb marketplace list --json
    bare array

  bb settings show --json
    one object keyed by settings area (generalSettings, serverAccess, keybindings, experiments, appearance, ...)

  bb guide commands [group] --json
    {chapter, commands: [{path, aliases, arguments, options, description}]}

Commands contributed by plugins document their own JSON in `bb <command> --help`
and the plugin's skill.
