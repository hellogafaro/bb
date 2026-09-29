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
  bb computer setup --host <id> [--json]
  bb computer permissions --host <id> [--permission accessibility|screen-recording] [--json]

`machines` lists enrolled hosts by ID and name, and marks the current thread's
host. `doctor` reports whether the bb computer driver is ready as a list of
probes (driver, service, accessibility, screen-recording, capture, windows),
each with an id, a label, a status, and a message, plus the resolved driver
path; it starts the driver service on first use, so call it once before the
first observe on a machine you have not used yet. `setup` installs the pinned
driver release on the machine if it is missing (or reports why it could not,
e.g. no prebuilt driver for that platform), then returns the same readiness
report. `permissions` is for macOS machines: it launches the driver's grant
flow so the prompts appear on that Mac, opens the Privacy & Security pane for
the given permission (or the first missing one), and returns the readiness
report; a person must approve on the Mac. Once a permission works, its row
turns ok even if the driver has not verified it itself yet.

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
`hotkey` (a short key list), `wait`. Some apps (a terminal emulator, for
example) expose no accessible elements at all, so three operations need no
`targetId`: `focus_window` (bring the observed window to the front),
`type_window` (type text into it directly), and `press_key` (one of `Enter`,
`Escape`, `Tab`, `mod+a`, `mod+c`, `mod+v` — `mod` is Cmd on macOS, Ctrl
elsewhere). Use `done` when the goal is reached and `blocked` when no safe
next step exists — both end the interaction without further action.

Evidence:

  bb computer screenshot --host <id> [--app <name>] [--thread <id>] [--json]
  bb computer record --host <id> [--thread <id>] --action start|stop [--run <id>] [--json]

Both write into thread storage — the target thread defaults to BB_THREAD_ID,
so pass `--thread <id>` outside a thread environment. `screenshot` captures a
JPEG/PNG of the desktop or a named app's window and returns its path.
`record` starts or stops a recording for a run ID; omit `--run` on `start` to
generate and print a UUID, then pass that same `--run <id>` to `stop`.
Stopping writes the finished MP4 and a trajectory folder into thread storage.

Goal-driven runs:

  bb computer start --host <id> --goal <text> [--mode agent|jev]
      [--app <name>]... [--max-steps <n>] [--json]
  bb computer status --run <id> [--json]
  bb computer cancel --run <id> [--json]
  bb computer active-run --host <id> [--json]

`jev` mode is the default whenever a TypeSafe or OpenRouter key is configured
for Computer; pass `--mode agent` to override. `jev` runs a single-request
decision loop in the background against TypeSafe's System One protocol: it
calls TypeSafe directly (`COMPUTER_TYPESAFE_ENDPOINT`) when
`COMPUTER_TYPESAFE_API_KEY` is set in server config, and otherwise calls the
real Jev model through OpenRouter's Decisions API
(`POST https://openrouter.ai/api/alpha/decisions`, model
`COMPUTER_OPENROUTER_DECISION_MODEL` — a pinned `typesafe/jev-*` id, default
`typesafe/jev-1.13`, or the `~typesafe/jev-latest` alias; no other OpenRouter
model is supported) with `COMPUTER_OPENROUTER_API_KEY` or, when that is empty,
`OPENROUTER_API_KEY`. Every step asks one request with several `choice` and
`noul` questions answered in parallel as speculative heads, so it stays a
single round trip (median ~300ms): the operation; one target head per
operation that needs a target, restricted to compatible on-screen elements;
a `press_key` head; a `text_candidate` head offering literal text extracted
locally from the goal (quoted text, or text after cues like "type", "enter",
"search for", "the command:") when the offered operations include one that
types; `submit`, a `noul` answered true when Enter should be pressed right
after typing to submit a command line, search box, or single-field form; and
`goal_complete_after`, a `noul` answered true when the chosen operation is
expected to fully satisfy the goal, skipping a whole DONE decision by
re-observing once after the capped wait and finishing the run there when
that re-observe is consistent, otherwise continuing normally. If the chosen
operation needs literal text and no extracted candidate fits, the run
escalates immediately so the calling agent can type it instead of guessing.
Each decision reports the OpenRouter-served model and `usage.cost` in USD;
the run's cumulative cost and last-served model are on its status as
`jevCostUsd`/`jevModel`. A malformed or invalid decision is retried once
against the same observation before the run gives up, and the daemon
pre-warms its persistent driver session at startup and on `doctor` so the
first `observe` of a run does not pay a cold-connect cost. With no TypeSafe
or OpenRouter key configured, `start` falls back to agent mode: it
immediately returns an `escalated` status telling the caller to drive the
goal with `observe`/`act`, then report progress with `status` and end it
with `cancel` when done or stuck. Poll `status` for a jev run's state
(`observing`, `deciding`, `acting`, `escalated`, `blocked`, `done`, `error`)
and take over with `observe`/`act` whenever it escalates. `active-run`
reports the running run ID for a machine, if any.

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

Live view and human input:

  bb computer input --host <id> --client <id> --input <json> [--json]
  bb computer clipboard --host <id> --client <id> --action read|write
      [--text <value>] [--paste] [--json]

The Computer tab in the thread's side panel shows a pushed live view over a
WebSocket (not polled) and streams only while someone has it open; the app
captures pointer and keyboard events there and maps them into human input
for you. When a person holds control from the Computer tab, its copy, cut,
and paste keyboard shortcuts sync transparently with their own OS
clipboard — no separate clipboard buttons. `bb computer input` sends one
human input (`click`, `drag`, `scroll`, `move`, `type`, `key`) over that same
live channel for scripting — hold control with `take-control` first, using
the same `--client` ID, or it is rejected. `--input`'s `frame` field is the
pixel size you are reasoning in (e.g. the desktop's real resolution);
coordinates are mapped to the actual screen from it. `bb computer clipboard`
reads or writes the machine's text clipboard over the same channel for
scripting; `--action write --paste` also presses the platform paste shortcut
after writing. Both close the live connection after one call — they are not
for continuous streaming.

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

  sdk.computer.{machines, doctor, installDriver, requestPermissions, observe, act, screenshot,
    record, start, status, cancel, activeRun, takeControl, releaseControl,
    controlStatus, live}
  REST: POST /api/v1/computer/<method>
  WS: /ws/computer/<hostId>?clientId=<id>&profile=full|thumbnail (frames push as
    binary messages; sdk.computer.live() wraps input, clipboard, and status)
