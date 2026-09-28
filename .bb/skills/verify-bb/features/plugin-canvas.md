# Canvas

Status: **needs revalidation** (renamed from `inline-vis`, chrome and directive contract changed 2026-09-28). Prior audit: [the audit](../MAINTENANCE.md) and [per-recipe ledger](../validation-2026-09-05.json), recorded under the old `inline-vis` name.

## Setup and entry points

Enable Canvas; create a harmless workspace HTML file and produce its documented directive in a synthetic conversation.

Use the main skill’s isolated targets and evidence rules. A plugin can be present
in this checkout but disabled in an installation. Enable it only in the test
store before checking its surfaces. Read its current command/schema definitions
from the source below; CLI references use the matching source CLI described in
SKILL.md. Inspect nested `--help` before selecting flags and IDs.

## Source

- `plugins/canvas/package.json`
- `plugins/canvas/server.ts`
- `plugins/canvas/app.tsx`

## Feature recipes

| Feature | Drive | Observable success |
| --- | --- | --- |
| Render and open | Emit `::canvas{file="demo.html"}` with a relative .html/.htm path, open the header's Open action, and reload the thread. | The file renders and opens from the correct thread workspace. |
| Deprecated alias | Emit `::inline-vis{file="demo.html"}`. | Renders through the same component as `::canvas`, unchanged. |
| Relative assets | Reference a fixture stylesheet, script, and image beside the HTML. | Assets resolve from the authorized workspace location and render without unrelated filesystem access. |
| Title fallback | Try an explicit `title` attribute, then omit it with an HTML `<title>`/Markdown heading present, then omit both. | Title shows the attribute, then the extracted `<title>`/heading, then the filename. |
| Kind mapping | Try each of `plan`, `report`, `chart`, `demo`, `notes`, `mockup`, an unknown value, and an omitted value. | Known kinds show their label and icon; unknown or missing shows the neutral "Canvas" label and icon. |
| Display defaults | Emit an `.html` file and a `.md` file with no `display` attribute, then override each with the other. | HTML defaults to card, Markdown defaults to inline; the attribute overrides both. |
| Height | In inline mode, try omitted height and values around the declared 120–1200 bounds; then set height in card mode. | Omitted height is 224px; whole numbers from 120 to 1200 are accepted in inline mode; invalid or out-of-range values show an explicit error. In card mode height has no effect and no error. |
| Sandbox | Have the fixture attempt to read parent DOM, cookies, and origin storage; report only success/failure. | The sandbox blocks parent-origin access while allowing the intended visualization interaction. |
| Invalid artifacts | Try missing file, missing attribute, non-HTML, invalid UTF-8, and greater-than-5MiB fixtures. | Clear artifact errors render inside the card chrome; no raw stack trace, no silent blank success. |

## Evidence and cleanup

Record each row’s UI/tool/CLI action and observed result separately. Inspect the
registered plugin command and SDK call before claiming agent parity; do not
invent a plugin CLI where the feature uses a core command instead. Preserve
failed attempts and missing prerequisites as unverified results. Restore plugin
configuration and remove only this run’s fixtures, registrations, and workers.
External account changes use authorized disposable targets.

## Maintenance notes

- Omitted height uses 224px and only applies in inline display mode. Whole-number heights from 120 through 1200 are accepted; out-of-range or invalid values show an explicit height error rather than clamping. Source: `plugins/canvas/app.tsx`.
- Collapse is per-item and does not persist across reloads (no `localStorage` key).
