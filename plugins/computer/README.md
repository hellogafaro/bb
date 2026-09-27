# bb-plugin-computer

Observes and controls the machine a thread runs on, or any other enrolled
machine by host ID, through [Cua Driver](https://github.com/trycua/cua).

- `contracts.ts` — the target table, operations, run states, and the two RPC
  contracts: `rpcContract` (server-facing, used by the CLI, agent tools, and
  the app) and `hostContract` (server → the daemon on the target machine).
- `cua-transport.ts` — a bounded child-process transport to `cua-driver call`.
- `target-table.ts` — builds the target table from Cua's AT-SPI window state
  and resolves an action's target back to a live element, adapted from
  `bb-plugin-wayfinder`'s Cua adapter (MIT).
- `host.ts` — the host entry: supervises the `cua-driver serve` daemon under a
  reviewed bounded capability manifest, implements doctor/observe/act/capture/
  record, and runs a demand-driven live frame loop (`live.ts`, adapted from
  Wayfinder, MIT).
- `manifest.ts` — builds that capability manifest: a fixed tool allowlist
  (capture, windows, accessibility, bounded input, recording, and the
  `browser_*` tools for the future browser binding — never `kill_app`,
  `clipboard_read/write`, or `launch_app`) plus a narrow, dynamically grown
  set of exact `{pid, window_id}` grants for the windows the plugin has
  actually observed or acted on (capped at 8, oldest evicted first).
- `control-gate.ts` / `controller-queue.ts` — one human-vs-agent gate and one
  controller queue per machine (adapted from Wayfinder, MIT).
- `decision.ts` — the jev-mode decision loop: TypeSafe System One typed
  choices for operation/target, OpenRouter for free text on `type` only
  (adapted from Wayfinder, MIT).
- `evidence.ts` — writes screenshots and recordings into the calling thread's
  own storage via `bb.sdk.files`.
- `server.ts` — RPC methods, `computer_*` agent tools, and the `bb computer`
  CLI, all backed by the same internal functions.
- `app.tsx` — the Computer side-panel tab (live view + Take control) and the
  inline `::computer-preview{host="..."}` chat card.
- `skills/computer/SKILL.md` — tells agents how to use the fast loop.

## Settings

`typesafeApiKey` / `typesafeEndpoint` / `typesafeModel` and
`openrouterApiKey` / `openrouterModel` (`bb plugin config computer`) enable
`computer_start`'s jev mode. Without a TypeSafe key, `computer_start` always
runs in agent mode and says so.

## Try it

```
bb computer doctor --host <id>
bb computer observe --host <id>
bb computer screenshot --host <id> --thread <thread-id>
```

## Measured latency

Measured on this server (`host_bvm3m5yxq7`, the primary/local host) against a
real Chromium window on its Xvfb desktop, over loopback HTTP to the plugin
RPC. The live loop always captures a full `get_desktop_state` PNG (no
separate low-resolution thumbnail render); `thumbnail` vs `full` only change
the target frame rate (6 fps vs 12 fps) and the client poll interval (160ms
vs 80ms), per the design brief.

| Measurement | n | avg | min | max |
| --- | --- | --- | --- | --- |
| Live frame latency, thumbnail (6 fps target) | 22 frames / 6s (~3.7 fps achieved) | 212.6 ms | 137 ms | 304 ms |
| Live frame latency, full (12 fps target) | 34 frames / 6s (~5.7 fps achieved) | 192.0 ms | 138 ms | 304 ms |
| `computer_observe` (desktop, AT-SPI walk) | 8 | 106–546 ms depending on window/tree freshness | 95 ms | 585 ms |
| `computer_act` click (dispatch + mandatory re-observe) | 8 | 552.4 ms | 357 ms | 656 ms |

Frame latency is capture-to-response-received (server and client clocks are
the same machine here, so this approximates capture-to-displayed within
render/paint time). The achieved frame rate is capture-bound: a
`get_desktop_state` PNG capture at 1280×720 costs roughly 150–270 ms on this
host, which caps thumbnail mode below its 6 fps target and full mode below
its 12 fps target. `observe` varies widely because Cua's AT-SPI walk is far
faster once a window's accessibility tree is warm (~100 ms) than right after
a fresh window/tab appears (~550 ms). `act`'s cost is dominated by the
mandatory post-action re-observe (host.ts always re-walks the tree after
dispatching input, so it is roughly one `act` dispatch plus one `observe`).

## Bounded capability manifest

`host.ts` always launches `cua-driver serve --permission-mode bounded
--capability-manifest <dataDir>/capability-manifest.json
--approve-capability-manifest`. The manifest (`manifest.ts`) is rewritten and
the daemon is restarted (a few hundred ms) whenever `observe`/`act`/`capture`
discovers a window that is not yet granted; verified live against a real
daemon:

- `allow.tools` never includes `kill_app`, `clipboard_read`,
  `clipboard_write`, or `launch_app` — confirmed refused with `Permission
  denied: tool '<name>' is outside the capability manifest`.
- `resources.desktop.display: true` grants full-desktop capture
  (`get_desktop_state`, used by screenshots and the live loop).
- `resources.desktop.windows` grants only the exact `{pid, window_id}` pairs
  the plugin has actually observed or acted on; a window outside that set is
  refused with `bounded_resource_outside_manifest`.
- `resources.files.write` is scoped to this plugin's own
  `<dataDir>/runs` directory, for recordings.

**Known environment blocker (this sandbox):** under bounded mode, any tool
touching `resources.desktop` (`get_desktop_state`, `list_windows`,
`get_window_state`) fails here with `authorization_host_failed: confirmation
provider failed: display identity could not be read`, even though the exact
same manifest's tool-allowlist enforcement works correctly (`health_report`,
which needs no desktop resource, succeeds under the identical daemon).
`cua-driver status` shows `authorization host: unavailable` in this
container; bounded mode apparently requires a working authorization-host
confirmation provider (a desktop-portal/polkit-style service) that this
headless bb-Xvfb sandbox does not run. This is a platform gap in the sandbox,
not in the manifest — confirmed by isolating it to desktop-resource calls
specifically. `CUA_DRIVER_PERMISSION_MODE` (env var, default `bounded`) is an
internal escape hatch for exactly this: set it to `standard` to keep the
plugin usable in an environment without that confirmation provider, at the
cost of the bounded guarantees above. Needs checking on a real desktop
session (this repo's own dev machine, or `pro`) where a login session's
authorization host is actually present.

## Known gaps (v1)

- Browser windows are not yet bound through Cua's `browser_*` tools; only
  native desktop windows are observed and acted on. Their tool names are
  already in the manifest's allowlist for when that lands.
- Run status lives in server memory only; it does not survive a plugin
  reload or server restart.
- Live frames are always full desktop screenshots; there is no separate
  lower-resolution thumbnail render, only a lower target frame rate.
- Restarting the daemon to widen a window grant drops the live-preview
  loop's in-memory viewer registrations; a viewer resumes within its next
  poll (viewers re-touch every 80–160ms) but this shows as a brief gap in
  the live feed the first time a new window is engaged.
- **`computer_record` writes only the continuous screen video, never Cua's
  per-turn folders** (`turn-00001/` with before/after screenshots and
  `action.json`). Verified live: after `start_recording`, a real dispatched
  `click` produces a growing `recording.mp4` but no `turn-00001/` directory,
  and `get_recording_state` shows the click's own `cua-driver call` process
  under a different ephemeral `owner` id than the one `start_recording` was
  issued under. `cua-transport.ts` spawns one `cua-driver call <tool>`
  subprocess per action (matching Wayfinder's original design) rather than
  keeping one persistent Cua session across a run, so Cua's per-turn capture
  — which is scoped to the session that enabled recording — never sees these
  calls as belonging to that session. Fixing this needs a persistent-session
  transport (`start_session` once per run, then routing every call through
  it), which is a real transport-layer change, not a one-line fix.
