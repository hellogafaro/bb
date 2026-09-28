---
kind: instruction
title: bb Computer Guide
summary: Observing and controlling a machine's desktop through Cua Driver — the target table, actions, screenshots, recordings, goal-driven runs, and human takeover.
intent: Help agents drive desktop automation one step at a time instead of guessing coordinates, and help users inspect or take over a run.
editingNotes: Keep commands and flags aligned with bb computer --help and apps/cli/src/commands/computer.ts.
---
Computer

BB observes and controls a machine's desktop (or any other enrolled machine by
host ID) through [Cua Driver](https://github.com/trycua/cua): a target table of
named, indexed elements, never coordinates or shell commands.

Resolve the target machine first:

  bb computer machines [--json]
  bb computer doctor --host <id> [--json]

`machines` lists enrolled hosts by ID and name, and marks the current thread's
host. `doctor` reports whether Cua Driver is ready (binary, daemon,
accessibility, on-screen windows) and starts the daemon on first use; call it
once before the first observe on a machine you have not used yet.

The fast loop:

  bb computer observe --host <id> [--app <name>] [--json]
  bb computer act --host <id> --action <json> [--json]

`observe` returns the target table for the active window (or the first window
matching `--app`): each target has an `index`, `targetId`, `role`, `name`,
`value`, `bounds`, and `allowedOperations`, plus a `snapshotId` for the whole
observation. If a window reports zero elements, `hint` explains why —
Chromium-based apps (Chrome, Chromium, Electron) need
`--force-renderer-accessibility` to expose their accessibility tree, and a web
page is usually a better fit for a browser binding than desktop automation.

Pick one target by `targetId` and one operation from its `allowedOperations`,
then call `act` with that exact `targetId` and the observation's `snapshotId`.
Never invent a target, guess a coordinate, or reuse a `targetId`/`snapshotId`
from an older observation — a stale snapshot is rejected so the next step
re-observes instead of acting blind. `act` returns the new observation after
the action; read it before deciding the next step, since the previous target
table no longer applies.

Operations (the `--action` JSON's `kind`): `click`, `double_click`, `type`
(text supplied inline), `set_value`, `select`, `scroll` (direction + amount),
`hotkey` (a short key list), `wait`. Use `done` when the goal is reached and
`blocked` when no safe next step exists — both end the interaction without
further action.

Evidence:

  bb computer screenshot --host <id> [--app <name>] [--thread <id>] [--json]
  bb computer record --host <id> [--thread <id>] --action start|stop --run <id> [--json]

Both write into thread storage — the target thread defaults to BB_THREAD_ID,
so pass `--thread <id>` outside a thread environment. `screenshot` captures a
JPEG/PNG of the desktop or a named app's window and returns its path.
`record` starts or stops a recording for a run ID chosen by the caller;
stopping writes the finished MP4 and a trajectory folder into thread storage.

Goal-driven runs:

  bb computer start --host <id> --goal <text> [--mode agent|jev]
      [--app <name>]... [--max-steps <n>] [--json]
  bb computer status --run <id> [--json]
  bb computer cancel --run <id> [--json]
  bb computer active-run --host <id> [--json]

Without a TypeSafe key configured in server config, `start` always runs in
agent mode: it immediately returns an `escalated` status telling the caller
to drive the goal with `observe`/`act`, then report progress with `status` and
end it with `cancel` when done or stuck. With a TypeSafe key, `jev` mode runs
a typed-choice decision loop in the background; poll `status` for its state
(`observing`, `deciding`, `acting`, `escalated`, `blocked`, `done`, `error`)
and take over with `observe`/`act` whenever it escalates. `active-run` reports
the running run ID for a machine, if any.

Human takeover:

  bb computer take-control --host <id> --client <id> [--json]
  bb computer control-status --host <id> --client <id> [--json]
  bb computer release-control --host <id> --client <id> [--json]

A person can watch the Computer tab in the thread's side panel at any time and
take control to pause automation and act directly; `act` then waits for
control to be released before dispatching again. `--client` is a stable ID
identifying the caller across these three calls. Do not act against a machine
someone is actively controlling — check `control-status` or `doctor`, or
simply retry after a short wait if `act` stalls.

Live preview:

  bb computer preview --host <id> --viewer <id> [--size thumbnail|full]
      [--after-sequence <n>] [--json]

Polls the machine's live frame stream; pass the previous response's sequence
number as `--after-sequence` to wait for the next frame instead of getting
the latest one immediately.

Browser windows are observed and acted on through the same commands; the
browser binding is not yet implemented, so treat non-desktop targets as
unsupported for now.

Agent tools:

Threads on a project with at least one machine get the built-in tools
computer_machines, computer_doctor, computer_observe, computer_act,
computer_screenshot, computer_record, computer_start, computer_status, and
computer_cancel — the same operations as the CLI commands above, scoped to
the calling thread.

SDK and API:

  sdk.computer.{machines, doctor, observe, act, screenshot, record, start,
    status, cancel, activeRun, takeControl, releaseControl, controlStatus,
    preview}
  REST: POST /api/v1/computer/<method>
