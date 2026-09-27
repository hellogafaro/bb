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
- `host.ts` — the host entry: supervises the `cua-driver serve` daemon,
  implements doctor/observe/act/capture/record, and runs a demand-driven live
  frame loop (`live.ts`, adapted from Wayfinder, MIT).
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

## Known gaps (v1)

- Browser windows are not yet bound through Cua's `browser_*` tools; only
  native desktop windows are observed and acted on.
- Run status lives in server memory only; it does not survive a plugin
  reload or server restart.
- The Cua Driver daemon is started with the default (`standard`) permission
  mode, not a reviewed bounded capability manifest.
