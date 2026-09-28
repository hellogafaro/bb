# bb-plugin-canvas

Builtin plugin for the assistant **message directive** slot
(`app.slots.messageDirective`). When the model emits:

```text
::canvas{file="demo.html" title="Demo" kind="demo"}
::canvas{file="notes.md" title="Standup notes" kind="notes"}
```

The omitted `source` defaults to `workspace`; `source="workspace"` is equivalent.
For a read-only artifact in the current thread's storage directory, use:

```text
::canvas{source="thread-storage" file="reports/result.html" title="Weekly report" kind="report"}
```

`::inline-vis{...}` is a deprecated alias for the same directive, kept so
messages emitted before the rename keep rendering. It accepts the same
attributes and is registered on the same component. It will be removed in a
future release; new messages should emit `::canvas`.

## Attributes

- `file` — path relative to the selected source. Accepts `.html`, `.htm`,
  `.md`, and `.markdown`.
- `source` — `workspace` (default) or `thread-storage`.
- `title` — optional card headline. Falls back to the document's HTML
  `<title>` or first Markdown heading (extracted server-side by
  `preparePreview`), then to the filename.
- `kind` — one of `plan`, `report`, `chart`, `demo`, `notes`, `mockup`.
  Selects the card's icon and label. An unknown or missing value shows the
  neutral "Canvas" label and icon.
- `display` — `card` or `inline`. Defaults to `card` for HTML and `inline`
  for Markdown.
- `height` — preview height in pixels, whole numbers from 120 through 1200,
  default 224. Only applies when `display` resolves to `inline`; card mode
  never renders inline content, so height has no effect there.

bb replaces that leaf with this plugin's React component, which:

1. Validates the untrusted `source`, `file`, and `height` attributes.
2. Calls the plugin RPC `preparePreview` with the message `threadId`, source,
   and file path to validate the target, extract a title, and surface clean
   inline errors.
3. Renders a card header: a kind icon tile, the resolved title, a
   "Kind · file" meta line, and an Open action that opens the source file in
   bb's sidebar viewer. In inline mode the header also gets a per-item
   collapse chevron; the collapsed state is local to that message render and
   is not persisted.
4. In card mode, shows the header only — no inline content — and the whole
   header opens the sidebar preview on click. In inline mode, shows the
   header plus the content area at the resolved height.
5. Points HTML files at bb's existing path-shaped worktree or thread storage
   route inside a sandboxed iframe. Relative sibling assets work, scripts are
   enabled, and normal web loading is allowed. The iframe keeps an opaque
   origin (no `allow-same-origin`) so scripts cannot access the bb page, its
   cookies, or storage. Remote scripts, styles, images, fonts, media, fetches,
   and WebSockets work subject to ordinary browser CORS, mixed-content, and
   remote-server policies.
6. Renders Markdown files with bb's Markdown renderer. Raw HTML is disabled.
7. Renders every error state (missing file, invalid height, invalid source,
   file not found, oversized, unsupported extension) inside the same card
   chrome as a destructive alert — never a raw stack trace.

## Backend security

`preparePreview` narrows `unknown` input immediately (rejects unknown keys and
source values). Workspace previews load the thread with
`include: "environment"` and require its live `path` and `hostId`. Thread
storage previews use `bb.sdk.threads.storageLocation` instead and do not resolve
the workspace. Both sources confine the relative `.html`, `.htm`, `.md`, or
`.markdown` path under the returned root and read it through `bb.sdk.files`
(host-routed). Absolute paths, traversal, unsupported extensions, missing files,
non-UTF-8 content, and files over 5 MiB are rejected. HTML previews then use
bb's existing confined worktree or thread-storage route to serve the document
and relative assets; Markdown previews render the validated content returned by
the RPC. The same call extracts an optional `title` from the document's HTML
`<title>` or first Markdown heading.

It ships with bb and is reconciled through the builtin plugin lifecycle. Ship
a supported file in either source, then ask the agent to show it with the
directive (see the bundled `canvas` skill).

## Tests

```bash
pnpm exec turbo run test typecheck --filter=bb-plugin-canvas
```

Markdown links and images resolve relative to the document's directory in the
selected source. For `::canvas{source="thread-storage" file="reports/report.md"}`,
`[Notes](notes.md)` and `![Chart](chart.svg)` refer to files under `reports/`
in that thread's storage. The same rule applies to workspace reports.
