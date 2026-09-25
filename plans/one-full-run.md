# One full run

Step 3 of [PLAN.md](../PLAN.md). A run takes a Notion task from "work on this" to a delivered, approved, logged result without a standing PM agent, and survives restarts without duplicate work or sends. This document fixes the model, the steps, and the phases. It is a core BB feature, like MCP: server service, DB tables, routes, SDK, `bb run` CLI, a Runs page, and an inbox.

## Slice 1

Prove the loop end to end on one shape of work before generalizing:

- **Source:** a Notion task link (Tasks database, see the `tasks-operations` skill) with a repo when the task is coding work.
- **Trigger:** a user says "work on this <link>" in any thread, or runs `bb run start <notion-url>`.
- **Channel:** the reply goes back to Notion as a comment on the task, and the task status and time are updated. Slack, email, and WhatsApp intake and replies come in step 4 of PLAN.md.
- **Work kinds:** coding tasks in a project checkout, and document or research tasks in a personal workspace.

## What exists and what we borrow

| Need | Existing primitive | Notes |
| --- | --- | --- |
| Durable steps that replay after a restart | none in core; the workflows plugin caches successful `agent()` calls and replays a script | Runs have a fixed step graph and need approvals and Notion writes, so they get their own service. We borrow the "replay from receipts" idea, not the JS sandbox. |
| Idempotent commands | T3 Code's command receipts: every command carries an id, its result is persisted, a retry returns the receipt | `run_commands` table keyed by `commandId`; every external effect (spawn, Notion write, send) runs as a command. |
| Executor and reviewer agents | child threads with `parentThreadId` and lifecycle notifications to the parent (`parent-system-messages.ts`) | Workers are hidden threads; the run thread is the visible parent. |
| Decisions and approvals | pending interactions (`approval`, `user_question`, `mcp_approval`, …) | Two new kinds: `run_approval` (exact message, recipients, channel, attachments) and `run_decision` (a blocker with options). |
| Notion access | core MCP with policies (`mcp_search`/`mcp_call`, Notion server) | Writes are `confirm` by default; the run service grants them per step through the same policy path, so the agent never asks twice. |
| Evidence and handoff | thread metadata (`thread_plugin_metadata` becomes reusable core metadata), artifacts under `<data-dir>/runs/<id>/` | Handoff is structured, not prose in a message. |
| Mobile | push-notifications plugin, realtime `changed` events | The inbox is the mobile surface. |

## Model

### Entities

- **run**: `id run_…`, `projectId | null`, `source { kind: "notion-task", url, pageId }`, `brief` (title, outcome, constraints, repo, original channel), `state`, `currentStep`, `limits { reviewRounds, wallClockMs, costUsd }`, `threadId` (the visible run thread), `createdAt`, `updatedAt`, `closedAt`.
- **run_step**: `runId`, `step` (enum below), `attempt`, `state` (`pending | running | waiting | done | failed | skipped`), `workerThreadId | null`, `input` JSON, `output` JSON (the handoff), `startedAt`, `endedAt`.
- **run_command**: `commandId` (deterministic: `${runId}:${step}:${attempt}:${name}`), `runId`, `name`, `input` JSON, `receipt` JSON | null, `error` | null, `at`. A command with a receipt is never executed again.
- **run_event**: append-only log (`run.started`, `step.started`, `step.waiting`, `step.done`, `approval.requested`, `approval.resolved`, `message.sent`, `run.closed`, …) used by the page, the inbox, and the audit trail.

### States

`intake → context → plan → execute → review → (repair → review)* → communicate → close`, plus `blocked` (waiting on a `run_decision`), `failed`, and `cancelled`. Every transition is a command with a receipt.

### Idempotency rules

1. The service is a single-writer loop per run: it reads the run, picks the next command, executes it, records the receipt, advances. On restart it re-enters every run in a non-terminal state and continues from the first command without a receipt.
2. External effects are commands: `spawnWorker`, `notionUpdate`, `notionComment`, `sendMessage`, `requestApproval`, `logTime`. Their inputs are fully determined by prior receipts, so a replay produces the same command id and finds the receipt.
3. A worker thread's completion is the receipt for `spawnWorker`; if the server restarts while a worker runs, the run waits for the existing thread rather than spawning another.
4. `sendMessage` requires an `approval.resolved` receipt whose approved text hash equals the message hash. A drift in text invalidates the approval.

## Steps

Each step names its agent profile (provider, model, permission mode, tools, skills), its inputs, its outputs, and its checks. Profiles live in server config so they can change without code.

| Step | Who | Input → output | Checks |
| --- | --- | --- | --- |
| **Intake** | service | URL → Notion page id, task record via MCP (`notion.fetch`) | Page is in the Tasks database; task not already running |
| **Context** | small agent (Sonnet, read-only tools + Notion reads) | task record → brief: outcome, constraints, repo or workspace, original channel, related pages | Brief is filled; otherwise `run_decision` "which repo/outcome?" |
| **Plan** | executor thread, plan mode | brief → plan with proportional "done" checks written as a checklist in the handoff | Plan approval required only when `brief.impact` is high (config); else auto-continue |
| **Execute** | executor thread (Opus for coding, Sonnet for docs; `auto` permissions) | plan → work + handoff `{ result, checksRun, evidence[], openIssues[], workMinutes }` | Handoff parses; every planned check has a result |
| **Review** | fresh reviewer thread (different model when possible; read-only + browser/computer use where relevant) | handoff + artifact → verdict `{ pass | needsWork, findings[] }` | Reviewer never edits; verdict parses |
| **Repair** | the executor thread, continued | findings → new handoff | Bounded by `limits.reviewRounds` (default 2); then `run_decision` "accept, retry, or stop" |
| **Communicate** | drafting agent (Sonnet) + human | handoff + verdict → Notion comment draft; `run_approval` with exact text; then `notionComment`, `notionUpdate` (status, evidence links), `logTime` | Send only after approval receipt; text hash matches |
| **Close** | service | run → `closed`, push notification "Done: <task>" | Notion shows status, comment, time |

Handoff and verdict are JSON with schemas in `packages/domain/src/runs.ts`; workers return them with a structured-output tool (`run_handoff`, `run_verdict`) registered only in worker threads.

## Surfaces

- **Runs page** (`/runs`, sidebar entry "Runs"): list with state chips (`Working n | Waiting n | Done`), row = task title · project · step · elapsed; detail = step timeline with worker thread links, handoffs, findings, approvals, Notion links.
- **Inbox** (`/inbox`, first item in the sidebar and the mobile home): every pending `run_approval` and `run_decision` across runs, plus thread pending interactions, newest first, resolvable inline. This is where the plan's "action inbox" lives.
- **Run thread**: the visible parent thread posts step summaries as system messages so the run reads like a conversation; workers are hidden children.
- **CLI/SDK**: `bb run start <url> [--project]`, `list`, `show <id>`, `approve <interaction>`, `decide <interaction> <option>`, `stop <id>`, `retry <id>`; `sdk.runs.*`; routes under `/api/v1/runs`. `bb guide runs`.
- **Agent tool**: `run_start` (dynamic tool, appears in project threads) so "work on this" from chat starts a run instead of doing the work inline.

## Notion contract

- Read: task page, properties (Status, Owner, Assignee, Project, Priority, Due), body, relations named in the brief.
- Write: Status transitions (`In progress` at execute, `In review` at review, `Done` or `Blocked` at close), one comment per communicate step with result, checks, evidence links, and open issues; time logged per the `tasks-operations` skill's Timesheets rule (actual work minutes from the handoff, never agent runtime). Property names and options are resolved live; nothing is hard-coded beyond the database id.

## Failure modes to test

- Server restart during execute: no second worker; run resumes waiting on the same thread.
- Server restart between approval and send: exactly one comment.
- Reviewer loop exceeds `reviewRounds`: `run_decision` raised, run `blocked`, push sent.
- Notion write fails (auth, rate limit): step `waiting` with retry backoff; no duplicate comment after recovery.
- Worker thread stopped by the user: step `failed`, `run_decision` "retry or stop".
- Approval text edited by the user in the inbox: new hash, new approval receipt, send uses the edited text.
- Two "work on this" for the same task: second is refused with a link to the running run.

## Phases

| Phase | Scope | Size |
| --- | --- | --- |
| **R1 model** | Tables + migration, `RunService` loop with command receipts, events, states; routes + SDK; `run_approval`/`run_decision` interaction kinds; tests for every idempotency rule with the real DB and a fake worker | 2–3 days |
| **R2 workers** | Agent profiles in config; `spawnWorker` on hidden child threads; `run_handoff`/`run_verdict` tools; executor and reviewer prompts as skills under `plugins/../skills` or data-dir skills; Notion intake/context via MCP | 2 days |
| **R3 communicate** | Draft, `run_approval` with exact text and hash, `notionComment`, `notionUpdate`, `logTime`, close + push | 1–2 days |
| **R4 surfaces** | Runs page, Inbox, run-thread system messages, `bb run` CLI, `bb guide runs`, `run_start` tool | 2–3 days |
| **R5 prove it** | Run three real tasks from the Tasks database (one coding, one document, one that fails review once); fix what breaks; write the verification recipe for `verify-bb` | ongoing |

Order: R1 → R2 → R3, then R4 in parallel with R5's first real task. Each phase ships behind the same rules as MCP: server owns policy, boundaries parse, real DB in tests, docs and CLI surfaces updated, no code comments.

## Non-goals for slice 1

- Channels other than Notion for intake and replies.
- Parallel runs that share a repo (sequenced by project until a lock exists).
- Cost accounting beyond a wall-clock limit.
- Editing the step graph per task; the graph is fixed and steps are skipped, not reordered.

## Agents

A run is a task × a project × the agents that do each step, so **agent** is a core entity before the run model.

- **Fields:** id `agent_…`, name (unique), description, provider, model, reasoning, skills (names of BB skills; empty = all), mcpServers (handles; empty = all enabled), instructions (text appended to the thread). Nothing else: no roles, no limits, and permissions are always full (the permission picker is hidden in the fork).
- **Default:** BB ships one agent, "BB": the project's current provider and model, all skills, all MCPs, no instructions. Every thread runs as an agent; `threads.agentId` is set at spawn and resolved in the thread runtime config (provider, model, reasoning, skill catalog, `mcp.servers` metadata, instructions section).
- **Surfaces:** sidebar entry **Agents** (New thread, Search, Customize, Automations, Agents). Page like Customize: description line, search, plain **New agent** that prefills chat with "Create a new bb agent: …", rows (name · provider/model · n skills · n MCPs), detail page with inline-editable fields and Delete. Composer: an Agent picker replaces the provider, model, and permission pickers. CLI `bb agent list|show|create|set|remove`, `bb thread spawn --agent <name>`; SDK `sdk.agents`.
- **Runs:** a run names its executor and reviewer agents by id; defaults are the default agent for both until the run design chooses otherwise.
