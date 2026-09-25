# Customize page and MCPs in the fork

One page called **Customize** with two buttons, **Skills** and **MCPs**. No left resource sidebar, no marketplaces, no registry browsing in the UI. "New" on either tab opens a new chat with a prefilled prompt, the way Automations does. The `mcps` plugin moves into the fork and gets the context, policy, and performance improvements from the Craft Agents comparison.

Everything here is a fork change. Keep core edits small and behind constants so upstream merges stay clean.

## Goals

- **Context:** the model knows which MCPs are connected without searching, and pinned servers cost no tokens until used.
- **Accuracy:** typed tool calls for the servers we use daily; per-tool allow/confirm/deny that feeds BB's approval flow.
- **Performance:** no cold catalog on the first search; connections shared across threads, stdio isolated on the host.
- **Simplicity:** one page, two buttons, one way to add things (chat).

## Non-goals

- Skill or MCP marketplaces in the UI. The `bb mcps registry <query>` CLI stays so an agent can search the official registry when asked.
- Per-session MCP pools, in-process stdio, or Craft's OAuth relay. Ours is better on each.
- Mini-model summarization of large results. The 8k truncation with an artifact path is enough.

## Current state

- Skills page: `/skills` routes in `packages/client-core/src/routes/route-paths.ts:13`, `SkillsView` in `apps/app/src/App.tsx:380`, library in `apps/app/src/components/tools/SkillsLibrary.tsx`, resource sidebar in `apps/app/src/components/tools/ResourceSidebar.tsx`, registry browse in `SkillsBrowse.tsx`. "New bb skill" already prefills chat with `CREATE_SKILL_PROMPT` (`SkillsLibrary.tsx:468`), and "Edit" prefills with `buildSkillEditThreadPrompt`.
- Sidebar entry: `apps/app/src/components/sidebar/BuiltInSidebarNavigation.tsx:59` (icon `Zap`, title `Skills`) and `sidebarNavigationItems.ts:79`. Header title: `tools-navigation.ts:308` and `AppLayout.tsx:276`.
- Automations "New": `navigate.toCompose({ focusPrompt: true, initialPrompt })` (`plugins/automations/app.tsx:456`, prompt at `overview-view.tsx:60`).
- MCPs plugin: `~/projects/bb-plugins/bb-plugin-mcp`, loaded by path. Page registered with `app.slots.navPanel({ id: "mcps", path: "mcps" })` (`app.tsx:1281`) with Installed and Browse tabs plus add dialogs. Storage at `~/.bb/plugins/mcp/` (SQLite, secrets, server dirs), keyed by plugin id only.

## Phase A: move `mcps` into the fork

1. Copy `bb-plugin-mcp` to `plugins/mcp`. Drop `node_modules`, `package-lock.json`, `dist`. Match the built-in plugin layout (`package.json` with `bb` manifest, `tsconfig.json`, `vitest.config.ts` using `sharedWorkerProjects`).
2. Add the plugin to the built-in list so `builtin:mcp` resolves, and to `plugins/bb-official.json` if the fork's catalog tests require it.
3. Replace `@hugeicons/*` with the icon set the fork uses (Remix Line), matching commit `f0d0f18b1`.
4. Install with `bb plugin install builtin:mcp --yes`. Do not run `bb plugin remove`; it deletes settings and OAuth credentials. The id is `mcp`, so `~/.bb/plugins/mcp/data.db`, secrets, and server dirs carry over.
5. Verify: `bb mcps list` shows the same servers and auth state as before; one `mcps_search` call from a thread returns results.
6. Archive `bb-plugin-mcp` in the `bb-plugins` repo README as moved.

## Phase B: the Customize page

Core edits, kept minimal.

1. **Rename and icon.** "Skills" becomes "Customize" in `BuiltInSidebarNavigation.tsx`, `sidebarNavigationItems.ts`, `tools-navigation.ts` (`TOOLS_SECTIONS.skills.label` and `resolveSkillsWorkspaceHeaderMeta`), `AppLayout.tsx:276`, and the composer mention/actions menus (`MentionMenu.tsx:199`, `PromptBoxActionsMenu.tsx:73`) where the label means the page rather than the skills themselves. Use a sliders/tune glyph from the host icon set in place of `Zap`/`extensions`. Keep the `/skills` routes and `__bb__/skills` navigation key unchanged so upstream merges and stored sidebar preferences keep working.
2. **Two buttons, no resource sidebar.** Add a `CustomizeTabs` segmented control (Skills | MCPs) rendered at the top of the page band. Skills routes to `/skills?view=library`; MCPs routes to the mcps plugin panel path. Skip rendering `ResourceSidebar` on the skills routes behind a fork constant (`FORK_CUSTOMIZE_PAGE = true` in one small `apps/app/src/lib/fork-flags.ts`), not by deleting the component.
3. **Skills tab.** Keep the library list, search, provider/source filters, detail view, "New skill" (already prefills chat), and "Edit in chat". Behind the same flag, hide the Browse/registry mode (`activeMode === "browse"`, `RegistrySkillsBrowsePage`, `forkRegistrySkill`) and redirect `/skills/registry*` to `/skills?view=library`. Keep the CLI skills settings section as is.
4. **MCPs tab.** The mcps plugin page renders the same `CustomizeTabs` at the top (exported from `@bb/shared-ui` or duplicated as a tiny component in the plugin, whichever avoids a new public plugin API). Hide the plugin's own sidebar entry by adding `mcp/mcp` to `DEFAULT_HIDDEN_SIDEBAR_NAVIGATION_KEYS` in `pluginNavSidebarOrder.ts`, so the panel route still exists but the sidebar shows only Customize.
5. **Header.** Both tabs show the section title "Customize" with a breadcrumb for the tab and, on detail pages, the item name (the mcps plugin already publishes `HeaderCrumbs`).
6. **Verification.** Unit tests for `CustomizeTabs` routing and the flag-gated redirect; `AppLayout.tools-breadcrumbs.test.ts` and `AppLayoutSidebar.test.tsx` updated for the new label; a `verify-bb` recipe that opens Customize, switches tabs, opens a skill detail and an MCP detail, and confirms the sidebar has one entry.

## Phase C: simplify the MCPs plugin UI

1. Remove the Browse pane, `registrySearch` RPC from the UI, the add-URL and add-command dialogs, and the `NewMcpButton` menu. Keep the installed list, detail page (enable, authenticate, reconnect, headers, remove), and the `mcp-changed` realtime refresh.
2. "New MCP" calls `navigate.toCompose({ focusPrompt: true, initialPrompt: CREATE_MCP_PROMPT })` with:

   ```
   Add a new MCP to bb. Use `bb mcps registry <query>` to find it in the official registry, or `bb mcps add <name> <url|command>` for a manual server. After adding, run `bb mcps auth <id>` if it needs sign-in, then `bb mcps list` to confirm. The MCP I want is:
   ```

   Offer two or three templates like Automations does (Notion, Slack, GitHub) that complete the sentence.
3. "Edit in chat" on the detail page prefills a prompt with the server handle and the `bb mcps` commands for headers, enable/disable, and remove.
4. CLI is unchanged: `bb mcps list|registry|add|auth|remove|show`. Add `bb mcps policy` in Phase E.
5. Update `plugins/mcp/PLUGIN_OVERVIEW.md`, the CLI guide surfaces listed in `docs/cli-guide-and-skill.md`, and the `bb-cli` skill for the removed UI paths.

## Phase D: context

1. **Connected list in instructions.** `bb.agents.configure()` returns `instructions` with one line per enabled server: `Connected MCPs: notion (Notion pages and databases), slack (Slack messages). Use mcps_search to find their tools.` Around 15 tokens per server. Rebuild on `mcp-changed`.
2. **Per-server guide.** Add a nullable `guide` column to `sources` (plugin-owned SQLite migration). Editable on the detail page and via `bb mcps guide <id> [text]`. When set, append it under the server's line, capped so the whole block stays under 4096 characters.
3. **Per-thread selection.** `configure()` receives `thread`, `project`, and `pluginMetadata`. Honor `pluginMetadata.servers: string[]` to limit the connected list, search scope, and direct tools for that thread. Default is all enabled servers. No UI yet; agents and the CLI can set thread metadata.

## Phase E: policies and approvals

1. Use the existing `tool_policies` table (`src/store.ts`). Seed `mode` from annotations on first catalog load: `readOnlyHint` → `allow`, `destructiveHint` → `confirm`, otherwise `confirm` for write. `inherit` means "use the seeded default".
2. Enforce in `invokeTool` (`server.ts:518`) and in Phase F's direct handlers. `deny` returns an error; `confirm` raises a BB pending interaction with the server, tool, and arguments, and resumes on approval. Approved calls are logged with who approved.
3. Detail page: a tool table with the risk badge and a policy select. CLI: `bb mcps policy <server> [tool] allow|confirm|deny`, `bb mcps policy <server>` to list.
4. Search rows keep the `risk` field so the model can prefer read tools.
5. Tests: policy seeding from annotations, enforcement paths, and a confirm round trip with the interaction mocked at the plugin API boundary.

## Phase F: direct tools for pinned servers

1. Add `exposeDirect INTEGER` to `mcp_servers`. Toggle on the detail page and via `bb mcps expose <id> on|off`.
2. For each pinned server, register one tool per catalog tool through `bb.agents.registerTool` with the raw JSON `inputSchema`, name `mcp_<handle>_<tool>` sanitized to `[a-zA-Z0-9_-]`, and the plugin's presentation. Execution routes through `invokeTool` so validation and policies apply. Re-register on catalog change; BB applies the new set on the next session start.
3. Claude Code already defers `bb-bridge` tools, so pinned tools cost nothing until used. Codex sends every dynamic tool schema in the prompt, so default `exposeDirect` to off for Codex threads until `deferLoading` is set upstream.
4. Upstream PR to `get-bb/bb`: set `deferLoading: true` in `toCodexDynamicTools` (`plugins/provider-codex/src/session-params.ts:638`) for plugin tools, or accept a per-tool hint. Never edit the provider plugin in the fork.
5. Cap direct tools per thread (for example 60). Beyond the cap, fall back to search for the rest and say so in the instructions line.

## Phase G: performance

1. Warm catalogs for enabled servers on plugin start and after `mcp-changed`, in the background with the existing 5s failure backoff, so the first `mcps_search` in a thread is not a cold load.
2. Pass `onElicitation` to the gateway so servers that ask for input mid-call get a BB pending interaction instead of failing. Sampling and roots stay off.
3. Keep: process-wide gateway, host-isolated stdio with lease, `tools/list_changed` refresh, opaque IDs, 5-minute catalog TTL, 8k output cap with artifacts.

## Phase H: providers use only our MCPs

The providers must not bring their own MCP servers. The provider plugins cannot be edited in the fork, so this is done with settings on each machine, a guard in the mcps plugin, and upstream PRs for the robust version.

1. **Claude Code.** BB passes `settingSources: ["user", "project", "local"]`, so `~/.claude/settings.json` with `"disableClaudeAiConnectors": true` stops the claude.ai connectors (Notion, Slack, Gmail, Composio, Claude Docs) from being auto-fetched. `~/.claude.json` and project `.mcp.json` `mcpServers` entries must stay empty. Today there are none.
2. **Codex.** `~/.codex/config.toml` must have no `[mcp_servers]` table. Today it has none.
3. **Guard in the mcps plugin.** A host RPC `providerMcpStatus` reads those files on the machine and reports: Claude connectors disabled or not, Claude `mcpServers` entries, Codex `mcp_servers` entries. `experimental_contributeEnvHealth` for `provider-claude-code` and `provider-codex` surfaces a warning in BB when the guard fails. `bb mcps providers [--fix]` prints the status; `--fix` merges `disableClaudeAiConnectors: true` into `~/.claude/settings.json` (creating it if missing, never removing other keys) and lists any MCP entries to remove by hand.
4. **Replace the connectors we used.** Add Notion (`https://mcp.notion.com/mcp`) through `bb mcps add` and authenticate. Other connectors are added the same way when a task needs them.
5. **Upstream PRs.** `strictMcpConfig: true` as a BB setting in `provider-claude-code`; `config.mcp_servers = {}` in `ThreadStartParams` as a BB setting in `provider-codex`. Until merged, the guard is the enforcement.

## Fork hygiene

- Core files touched: `BuiltInSidebarNavigation.tsx`, `sidebarNavigationItems.ts`, `tools-navigation.ts`, `AppLayout.tsx`, `SkillsLibrary.tsx`, `pluginNavSidebarOrder.ts`, `App.tsx` (redirect), plus the new `fork-flags.ts` and `CustomizeTabs.tsx`. Expect conflicts in the first four on upstream merges; keep each diff to a few lines.
- Plugin files are ours: `plugins/mcp/**`. No conflicts expected.
- Do not touch `provider-claude-code`, `provider-codex`, provider bridges, connect, or tunnel. The Codex `deferLoading` change goes upstream only.
- Bump nothing in `HOST_DAEMON_PROTOCOL_VERSION`; the mcps host contract is plugin-owned and unchanged.
- Craft Agents is Apache-2.0. Nothing in this plan copies its code; the ideas (connected list, per-source read-only policy) are reimplemented.

## Order and size

| Step | Phase | Size | Depends on |
| --- | --- | --- | --- |
| 1 | A: mcps into the fork | half a day | none |
| 2 | B: Customize page | one day | none |
| 3 | C: simplify MCPs UI | half a day | A |
| 4 | D: context | half a day | A |
| 5 | E: policies and approvals | one to two days | A |
| 6 | G: performance | half a day | A |
| 7 | F: direct tools | one to two days | D, E, upstream PR for Codex |
| 8 | H: providers use only our MCPs | half a day | A |

Steps 1 and 2 can run in parallel. Step 5 is what the "prove one full run" step in [PLAN.md](../PLAN.md) needs for exact-action approvals. Step 7 is last and can wait on the upstream PR.

## Verification per phase

- Turbo tasks: `pnpm exec turbo run typecheck test --filter=@bb/app --filter=bb-plugin-mcp`.
- `verify-bb` recipes: Customize page navigation, skill create via chat, MCP add via chat with `bb mcps add`, a confirm-policy tool call approved from the inbox, and a Codex thread with a pinned server confirming the tool list.
- Manual: `bb mcps list` before and after Phase A shows identical servers and auth; a Claude Code thread shows `mcp__bb-bridge__mcps_*` as deferred tools and the connected-MCPs line in instructions.
