See an agent's chart, demo, report, plan, mockup, or Markdown notes in the conversation without opening a side panel. The agent writes an HTML or Markdown file to the workspace or the thread's storage directory. The plugin shows that file as a card in the assistant message.

## What you get

- A titled card with a kind icon (plan, report, chart, demo, notes, or mockup) and an Open action that jumps to the file in bb's sidebar viewer, for workspace and thread-storage previews alike.
- Card mode by default for HTML: the whole header opens the sidebar, no iframe renders in chat.
- Inline mode by default for Markdown: the document renders at a default viewport height of 224 pixels. The agent can set a height from 120 to 1200 pixels; `display` can override the mode for either file type.
- A per-item collapse control in inline mode. It does not persist across reloads.
- A clear inline error, inside the same card chrome, when the file is missing, too large, or unsupported.

## How it works

The agent emits a message directive that names a source-relative `.html`, `.htm`, `.md`, or `.markdown` file. Omitting `source` defaults to the workspace, and explicit `source="workspace"` is equivalent:

```text
::canvas{file="charts/out.html" title="Revenue by flow" kind="chart" height="480"}
::canvas{file="reports/summary.md" title="Week 38 summary" kind="report"}
```

Read-only artifacts in the thread's storage directory can be rendered without resolving the workspace:

```text
::canvas{source="thread-storage" file="reports/result.html" title="Result" kind="report"}
```

`::inline-vis{...}` is a deprecated alias kept so older assistant messages keep rendering; it takes the same attributes.

The plugin confirms the file exists in the selected source before it renders. Files must be UTF-8 text with a maximum size of 5 MiB. Relative assets next to HTML files load as usual. The card title falls back from the `title` attribute to the document's `<title>` or first Markdown heading, then to the filename.

HTML runs in a sandboxed iframe with an opaque origin. Scripts in the file cannot read the bb page, its cookies, or its storage. Markdown uses bb's renderer with raw HTML disabled.

## For agents

The bundled `canvas` skill teaches the agent when to write a canvas, the shared HTML kit, and how to emit the directive. No account or external service is required.
