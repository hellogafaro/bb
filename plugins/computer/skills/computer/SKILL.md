---
name: computer
description: Use the Computer plugin to observe and control the machine a thread runs on, or any other enrolled machine by host ID. Use for desktop automation, clicking and typing into native apps, screenshots, and recordings.
---

Resolve the target machine first: `computer_machines` lists enrolled hosts by
ID and name. `computer_doctor --hostId <id>` reports whether Cua Driver is
ready (binary, daemon, accessibility, on-screen windows); it also starts the
daemon on first use, so call it once before the first observe on a machine
you have not used yet.

Drive one step at a time with the fast loop, never with coordinates or shell
commands:

1. `computer_observe { hostId, appId? }` returns the target table for the
   active window (or the first window matching `appId`): each target has an
   `index`, `targetId`, `role`, `name`, `value`, `bounds`, and
   `allowedOperations`. It also returns a `snapshotId`. If the window reports
   zero elements, `hint` explains why: Chromium-based apps (Chrome, Chromium,
   Electron) need to be launched with `--force-renderer-accessibility` to
   expose their accessibility tree, and for a web page the browser binding is
   usually a better fit than desktop automation.
2. Pick one target by `targetId` and one operation from its
   `allowedOperations`. Call `computer_act { hostId, action }` with that exact
   `targetId` and the observation's `snapshotId`. Never invent a target,
   guess a coordinate, or reuse a `targetId`/`snapshotId` from an older
   observation — a stale snapshot is rejected so you re-observe instead of
   acting blind.
3. `computer_act` returns the new observation after the action. Read it before
   deciding the next step; do not assume the previous target table still
   applies.
4. Operations: `click`, `double_click`, `type` (text you supply), `set_value`,
   `select`, `scroll` (direction + amount), `hotkey` (a short key list),
   `wait`. Use `done` when the goal is reached and `blocked` when no safe next
   step exists — both end the interaction without further action.

Evidence: `computer_screenshot { hostId, appId? }` writes a JPEG/PNG into this
thread's storage and returns its path. `computer_record { hostId, action,
runId }` starts or stops a recording for a run ID you choose; stopping writes
the finished MP4 and a trajectory folder into thread storage.

`computer_start { hostId, goal, ... }` begins a goal-driven run. Without a
configured TypeSafe key (the common case) it always runs in agent mode: it
immediately returns an `escalated` status telling you to drive the goal
yourself with `computer_observe`/`computer_act`, then report progress with
`computer_status { runId }` and end it with `computer_cancel { runId }` when
you are done or give up. With a TypeSafe key configured in plugin settings,
`jev` mode runs a typed-choice decision loop in the background; poll
`computer_status` for its state (`observing`, `deciding`, `acting`,
`escalated`, `blocked`, `done`, `error`) and take over with
`computer_observe`/`computer_act` whenever it escalates.

A person can watch the Computer tab in the thread's side panel at any time and
press "Take control" to pause automation and type directly; `computer_act`
then waits for them to release control before dispatching again. Do not act
against a machine a person is actively controlling — check `computer_doctor`
or simply retry after a short wait if `computer_act` stalls.

Browser windows are observed and acted on through the same tools; the browser
binding is not yet implemented, so treat non-desktop targets as unsupported
for now.
