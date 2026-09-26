# Plan

Our BB is one place to capture, run, review, and communicate work. Notion is the source of truth for tasks, skills, decisions, evidence, and actual time. A task uses only the steps it needs.

## Flow

```mermaid
flowchart LR
    A[Request from any channel] --> I[Intake]
    I --> C[Context: Notion task]
    T[Existing task link] --> O[Orchestration: durable run]
    C --> O
    O --> E[Execution: inspect, plan, act]
    E --> R[Review: independent checks and real QA]
    R -->|Needs work| E
    R -->|Pass| M[Communication: draft in original thread]
    M --> H[Approve exact message]
    H --> S[Send and log in Notion]
    O <-->|Decisions and blockers| B[Inbox]
```

Quick help stays in a personal chat. A deliverable or external commitment becomes a task.

## The six loops

| Loop | Job |
| --- | --- |
| **Intake** | Capture requests from messages, email, meetings, forms, or direct chat. Preserve the original content and channel details. |
| **Context** | Create or enrich a concise Notion task with the desired outcome, source thread, relevant history, assets, and repo when useful. Keep the solution open. |
| **Orchestration** | Start and resume a durable run, coordinate dependencies, route decisions and approvals, and keep the task moving. No standing PM agent is required. |
| **Execution** | Inspect, write a proportional plan and independent “done” checks before acting, execute, self-check, and attach evidence. Use milestones for complex work. |
| **Review** | Fresh context checks the artifact and real outcome. Record findings in Notion, send failures back for repair, and repeat until accepted or a limit is reached. |
| **Communication** | Draft the right update for the right people in the original channel, obtain required approval, send, confirm delivery, and comment on the Notion task. |

## Operating rules

- Start with “create a task from this” or “work on this” plus a source or task link. The system chooses the steps and agent profile. No agent selector is required.
- A task is a short brief plus natural-language bullets. Keep the original message or meeting link and conversation ID so the reply goes to the right place.
- Run independent tasks in parallel. Sequence work that changes the same code, document, account, or other shared resource.
- The executor leaves a short handoff: result, checks run, evidence, open issues, and actual work time. Reviewers have fresh context and can use browser or computer use to test behavior.
- Failed review creates corrective work automatically. Escalate only when a decision, missing access, or time or cost limit blocks progress.
- Review depth follows impact. Consequential plans, changes, and deployments need approval when appropriate. Every external message needs approval of its exact text, recipients, channel, and attachments before sending.
- Log actual work time, never agent runtime. Notion records progress, evidence, review, time, and who received the final update. BB keeps run history without becoming a second task list.

## Shared capabilities

Notion and search; durable sessions; agents with role profiles, models, tools, skills, and limits; skills; automations; workflows; channel and app connections; remote computer use; artifacts; an action inbox; exact-action approvals; collaboration; permissions; and an audit trail. Inbox and sessions must work on mobile. Runs must recover after interruption without duplicate tasks or sends.

## Build path

1. **Run the fork.** Build `main` in `~/.local/bb`, a clean clone outside the projects folder, and run `bb-server` from it. It keeps the same `~/.bb` data, BB Connect pairing, machines, and BB apps as the npm-installed BB it replaces.
2. **Hide the noise.** Done. Hide the core surfaces we do not use and remove only what gets in the way. The Customize page (Skills and MCPs, no marketplaces) and moving `mcps` into the fork are in [plans/customize-and-mcps.md](plans/customize-and-mcps.md). What is hidden:
   - **Provider sources.** `bb provider guard [--fix]` (alias `bb mcp providers`, and a Fix button on the MCPs page) makes BB the only source of MCPs, skills, and plugins for Claude Code and Codex. It sets `disableClaudeAiConnectors`, `disableBundledSkills`, `syncClaudeAiSkills: false`, and an empty `enabledPlugins` in `~/.claude/settings.json`; turns off the Codex `remote_plugin`, `plugins`, `apps`, and `skill_mcp_dependency_install` features and every bundled `.system` skill in `~/.codex/config.toml`; and deletes the Claude Code marketplace clones and the Codex plugin cache. It reports provider-owned MCP servers and non-BB skill folders for removal by hand.
   - **Customize skills.** The Skills tab and its count show only BB user, BB project, and BB plugin skills (`FORK_CUSTOMIZE_PAGE`). `bb skill list --scope ... --provider bb` gives the same view.
   - **Plugin skills in agent context.** The `claude-code-provider`, `codex-provider`, `provider-retry`, `concurrency-limit`, and `thread-list` skills are neither injected into threads nor listed (`FORK_EXCLUDED_PLUGIN_SKILLS` in `apps/server/src/fork-config.ts`). Their CLI commands still work.
   - **Settings.** Browser, Plugin marketplaces, and Community are gone from the settings navigation and search, and their routes open General (`FORK_HIDDEN_SETTINGS_SECTIONS`). Updates stays visible because it reads our own releases.
   - **Built-in browser.** No entry point opens a browser tab, the `browser.*` commands are out of the palette, and a persisted browser tab shows "Browser is disabled in this build" (`FORK_HIDE_BROWSER`).
3. **Prove one full run.** Build the run into the fork with its own page. Start from a Notion task link, plan, execute, review, repair, update Notion, draft in the original thread, approve, and send. Make the run visible in the BB inbox. The design is in [plans/one-full-run.md](plans/one-full-run.md).
4. **Expand intake and coverage.** Add email, WhatsApp, meetings, and other sources one at a time. Apply the same run to coding, marketing, and other work. Track failures and improve skills and checks from real cases.

## Base decision

This repo is our soft fork of [BB](https://github.com/get-bb/bb) (MIT). The app keeps BB's name, so upstream merges stay clean and BB Connect, the BB apps, push, and the machine installer keep working. We compared BB, Orca, T3 Code, Synara, and Craft Agents in September 2026. We also tried renaming BB and forking T3 Code, then deleted both trials. A full rename cost us clean upstream merges and BB's hosted services, so we went back to a soft fork.

- **BB** runs Claude Code and Codex on our subscriptions, supports multiple machines, mobile, push, workflows, automations, and computer use, and is already our daily tool. Its code is well tested and organized by domain, and most features are removable plugin folders. Upstream ships one squash-merged PR per commit, so changes are easy to track.
- **Orca** was too large (about 2M lines) and too fast-moving to maintain.
- **T3 Code** has the cleanest codebase, the strongest durable run design, device pairing auth, and a polished native mobile app, but no plugins, workflows, automations, or dispatch across machines.
- **Synara** is derived from T3 Code and mostly built by one developer. It is early-stage, desktop-first, and has no mobile app.
- **Craft Agents** is the smallest and closest to non-code work, but its public repo is a release mirror and it has no mobile app.

### What we borrow

- **T3 Code:** the idempotent command and event pattern for durable runs.
- **Synara** (MIT): automations, handoffs between providers, and scoped MCP access for other local clients.
- **Craft Agents** (Apache-2.0, keep its NOTICE attribution): the messaging gateway, the WhatsApp worker, sources such as Notion and Linear, and the inbox.

### Fork rules

- `origin` is `hellogafaro/bb` (public). `upstream` is `get-bb/bb` with pushing disabled. GitHub Actions run only for releases: Build Desktop (manual dispatch) is the one enabled workflow. CI, PR Gate, and every inherited workflow that deploys or publishes upstream's BB are disabled with `gh workflow disable`; run typecheck and tests locally instead. PR Gate would close PRs from authors missing from `.github/APPROVED_CONTRIBUTORS`, so `g4f4r0` is listed in case it is re-enabled. Dependabot is off: `.github/dependabot.yml` is deleted (GitHub cannot disable its workflow) and automatic security fixes are disabled. Re-check all of this after each upstream merge, which can restore `dependabot.yml`.
- Releases live on `hellogafaro/bb`: fork versions are patch bumps on the merged upstream base (upstream 0.44.0 ships as 0.44.1, 0.44.2, ...), tagged `desktop-v<version>` with the moving `desktop-latest`. Build Desktop with `publish=true` and `release_channel=stable` attaches the desktop feeds and `bb-app-<version>.tgz` with its `.sha256`. The server's update check, the desktop auto-updater, and `scripts/fork/bb-reload.sh --from-release` read those releases (`packages/domain/src/fork-release.ts`).
- Keep BB's names, packages, env vars, and protocol. Never rename them; this is our BB, not a new product.
- Follow upstream by stable release. When `bb-app` publishes a stable version, an agent merges the commit it was built from (its npm `gitHead`), never unreleased `main` or nightlies, and opens a PR with a summary, test results, and any conflicts. We approve the merge.
- Keep our changes in their own files and folders where possible so upstream merges stay clean. Hide features with settings instead of deleting core files.
- Bake a built-in plugin into core only when we need to change how it works (MCP, the Customize page). Working plugins we do not touch stay plugins: providers, environments, connect, push, automations, workflows, drafts, send later, inline-vis, pdf-preview, provider-retry, wayfinder. The secrets plugin is ours: it was rewritten around Infisical (`bb secret`), so expect conflicts in `plugins/secrets` on upstream merges. Runs (step 3) absorb automations, workflows, inline-vis, and computer use when a run step needs them.
- The Dusk look is built in, not a plugin: palette and code colors, status rings, two-line sidebar rows, the status thread list (Pinned, Waiting, Ready, Working, Done, Snoozed) that replaced the Thread list plugin, snooze, the composer, palette, toasts, wallpaper, and shortcuts. It edits core components directly, so keep each change small and expect conflicts in those files on upstream merges. Snoozes are the threads table's `snoozedUntil` column (the fork's one migration, `0132_thread_snooze`), and the wallpaper lives in `<data-dir>/appearance/`.
- Agent homes live in `<data-dir>/agents/<slug>/` (one git repo, committed after each turn; `BB_AGENT_HOME`, private `skills/`), owned by `apps/server/src/services/agents/agent-home.ts`.
- Never edit the provider plugins (`provider-claude-code`, `provider-codex`), the provider bridge packages, or the connect and tunnel packages. Upstream keeps our subscriptions working.
- Offer generic patches, such as hiding core surfaces, upstream. Drop each one from the fork when upstream accepts it.
- Before copying code from a community plugin or another project, check that its license allows it and keep the required notices.

### Runtime

- **Server:** this Linux server, on the `hellogafaro.com` tailnet as `server.garibaldi-mermaid.ts.net`.
- **Remote access:** BB Connect (getbb.app) for browsers, the BB apps, and machines, plus Tailscale Serve over HTTPS on the tailnet. Never use Funnel or bind BB to a public address, because its API has no login of its own.
- **Machines:** add `pro` and `neo` from Settings → Machines.
- **Mobile:** the official BB iOS app, paired through BB Connect. Push goes through Expo and needs no Apple or Google keys. On the phone, BB focuses on the inbox: notifications, approvals, answers, and run status.
- **Telemetry:** set `BB_TELEMETRY=false`.

## References

Study these when a specific mechanism is needed: [Companion](https://github.com/The-Vibe-Company/companion) for crash recovery without repeated tool effects, the BB community plugins (`inbox`, `operator-inbox`, `triage`, `advisor`, `discord`, `web-push-notify`), [Hermes Agent](https://github.com/NousResearch/hermes-agent), [Omnara](https://github.com/omnara-ai/omnara), [Paperclip](https://github.com/paperclipai/paperclip), [Buzz](https://github.com/block/buzz), [Capy](https://capy.ai/), [Intent](https://github.com/intent-hq/intent), [Unpeel](https://github.com/unpeel-com/unpeel), [MonoCode](https://github.com/hardbeat920/monocode), [Unreal Agent](https://github.com/unreallabsai/unreal-agent), and [Cube](https://cube.computer/).
