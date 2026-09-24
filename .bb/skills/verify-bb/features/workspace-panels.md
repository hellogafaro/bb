# Panels, files, terminals, splits, and embedded browser

Status: **2026-09-05: 12 passed, 3 partial/blocked**. See [the audit](../MAINTENANCE.md) and [per-recipe ledger](../validation-2026-09-05.json).

## Setup and entry points

Synthetic workspace with text, Markdown, CSV, image, HTML, PDF, and binary fixtures. Some browser integrations require Electron.

Follow the main skill’s isolated launch, doctor, evidence, and cleanup rules.
CLI examples below omit the `node apps/cli/dist/index.js` prefix; use that source CLI
against the same dev instance. Resolve IDs with list/show and inspect the named
command’s `--help` before mutation. Use fresh browser snapshots for controls.

## Source

- `apps/app/src/views/SplitWorkspaceRoute.tsx`
- `apps/app/src/components/secondary-panel/FilePreview.tsx`
- `apps/app/src/components/files/FilesPanel.tsx`
- `apps/app/src/components/files/FileEditor.tsx`
- `apps/app/src/components/files/file-document-store.ts`
- `apps/app/src/components/secondary-panel/SidebarSplitContainer.tsx`
- `apps/cli/src/commands/thread/open.ts`
- `apps/cli/src/commands/thread/pane.ts`
- `apps/cli/src/commands/file.ts`
- `apps/cli/src/commands/terminal.ts`

## Feature recipes

| Feature | Drive | Observable success |
| --- | --- | --- |
| Open, close, and reopen tabs | Open New panel tab, select files/terminal/plugin content, close and reopen the last tab; reload. | Correct content and tab order persist without duplicating sessions. |
| Panel tab concurrency | Read thread tabs show, modify tabs from one client, then submit a stale revision with tabs set. | Conflict is surfaced rather than overwriting the other client’s tab state. |
| Split and focus panes | Open a thread in split, drag/reorder, focus previous/next/numbered panes, maximize and restore, then close one. | Focus and layout refer to the right thread; closing the last remaining pane is handled deliberately. |
| Agent pane controls | With the same thread open in a connected client, use thread pane maximize/restore/toggle/spotlight/clear-spotlight. | Delivered result matches visible client action; a delivered event is not assumed proof without observing the UI. |
| Quick open and file tree | Search a unique path with Quick open file, expand tree folders, and open a line-specific link. | Results and displayed content match the selected host/workspace; missing paths remain explicit. |
| Files tab | In a thread with a workspace, open New panel tab → Files; expand a folder, scroll, switch to another tab and back; confirm New tab still offers Search files. | Files appears before plugin actions without waiting for plugins; rows list dotfiles in daemon order; the expanded folder and scroll position survive the tab switch; only visible rows are mounted. |
| Files tab search and refresh | Type a unique filename in the Files search, open a hit, clear it; create a file in an expanded folder with file write and wait 10 s with the tab active. | At most 80 hits appear after the 150 ms debounce and open the chosen path; the new row appears on the next refresh; nothing refreshes while the tab or window is hidden. |
| Open files in the editor | Open a .ts, a .md, a .png, and a binary fixture from the Files tree, from a timeline file link, and with thread open <thread> <path> --line 12. | .ts opens in the code editor with highlighting and line 12 selected; .md opens rich with a working Code toggle; .png renders; binary shows its notice; head and merge-base diff sources keep the read-only preview. |
| Edit and save | Type in a .ts fixture and press Mod-s; type again and wait 5 s; repeat on a CRLF fixture. | file read shows the new bytes after each save, the dirty dot clears, and CRLF line endings are unchanged. |
| External change and conflict | With a clean buffer, change the file with file write; then type without saving and change it again; choose Overwrite, repeat and choose Reload. | The clean buffer reloads in place without losing caret or scroll; the dirty buffer shows the changed-on-disk banner; Overwrite writes the buffer over the latest disk version; Reload shows the disk content; both are disabled while a save runs. |
| Deleted file and delete | Type in an open fixture and remove it with file remove, then Recreate; delete another fixture from File actions → Delete. | The deleted-or-moved banner offers Recreate, which writes the buffer back; Delete removes the file after confirmation and the tree drops the row. |
| Editor Add to chat and remote host | Select lines in the code editor and text in the rich Markdown editor and choose Add to chat; open and save a file in a thread on a remote host. | The composer quotes path:start-end with the selected text; remote reads, polls, and writes go to that host. |
| Read-only previews | Open each fixture type, a large text file, and an unsupported binary. | Renderer or download fallback matches type/size; original bytes are unchanged. |
| Host, workspace, and thread-storage files | Open a same-named fixture from each source and compare file read/project content/thread storage APIs. | Source identity is maintained; no accidental cross-root content leak. |
| File mutation CLI | Use file mkdir/write/list/paths/read/move/remove on a temporary subtree only; verify bytes after each. | Path routing and recursive flags obey scope; errors preserve unrelated files. |
| Terminal scopes and output | Create terminals at thread, environment, and host scope using terminal create --help; run printf with a unique marker; attach and inspect output/wait. | Each terminal uses the requested working directory and output remains available after detach. |
| Terminal interaction and lifecycle | Send input, resize, rename, restart, and close a synthetic terminal. | Input reaches only the target; dimensions/title update; restart returns a new terminal ID in the same scope; use that ID for subsequent output/input and close. |
| Diff and Add to chat | Open environment diff, select changed lines, add them to the composer. | Selected patch and file identity are preserved with correct old/new line numbers. |
| External editor and file openers | Choose a configured editor/terminal, use Open in preferred app, and test one-off Open with. | Host-local opener receives the intended path and line; unavailable integration reports failure. |
| Embedded browser | In a capable desktop client open a local fixture URL, focus location, navigate, reload, find text, hide/show the panel, and close. | History/search and native view visibility follow the active tab; hidden views do not cover dialogs. |
| Thread storage and raw files | Inspect a synthetic thread’s storage location, list paths/files, and open text/binary assets through the documented storage/raw-file API and UI link. | Stored artifacts resolve from thread storage rather than the worktree, content bytes/MIME agree, and missing files fail explicitly. |
| Preview lifecycle | Request a fixture file preview through the public files API, follow its returned preview URL and test a missing/unsupported file. | Preview references only the chosen source and renders the expected bytes/error; the returned URL is not invented from a workspace path. |

## Evidence and cleanup

Record a result for each row separately, including the chosen entry point,
initial state, action, resulting state, and relevant persisted value. Repeat
mutations through the available agent interface to establish parity. Preserve
failed attempts and prerequisites; source documentation is not a passing test.
Restore preferences and remove only the fixtures and sessions created by this
recipe. External writes require a disposable test target and task authorization.

## Maintenance notes

- Use New tab and its recent file entry to reopen a closed file in the web app. The default Ctrl+Shift+T reopen shortcut applies only to desktop; verify that shortcut in Electron separately. Source: `apps/server/src/services/system/app-keybindings.ts:195`, `apps/app/src/components/secondary-panel/terminalPanelTabs.ts:115`.
- Use the command palette for Focus previous/next chat pane (unassigned by default). Numbered pane focus on Linux web uses Ctrl+Shift+1–8; inspect current keybindings before driving. Source: `apps/app/src/views/thread-detail/SplitThreadArea.tsx:692`, `apps/app/src/views/thread-detail/SplitThreadArea.tsx:748`, `apps/server/src/services/system/app-keybindings.ts:183`.
- Pane/open commands broadcast to connected app clients and have no browser-profile targeting flag. Coordinate a short window with other browser owners, and verify the intended client after each delivered result. Source: `apps/cli/src/commands/thread/pane.ts:1`, `apps/app/src/views/thread-detail/splitThreadNavigation.ts:168`.
- terminal restart returns a new terminal ID. Use that returned ID for later send/output/close checks. Source: `apps/cli/src/commands/terminal.ts:189`.
- Start with a Git fixture and choose Uncommitted changes when no merge-base exists. The Diff button accessible name includes its current shortcut; select by prefix rather than exact "Show diff panel". Source: `apps/app/src/views/thread-detail/ThreadDetailView.tsx:1487`, `apps/app/src/components/git-diff/GitDiffCardBody.tsx:241`.
- The editor polls with file read --if-none-match semantics: every 1.5 s while the tab is active, the window visible, and the file changed within 30 s, otherwise every 5 s, and never while inactive. Tabs of one host path share one document. Tabs persisted by the retired Sidetree plugin reopen as the Files tab and the editor. Source: `apps/app/src/components/files/file-document-store.ts`, `apps/app/src/lib/thread-tabs-sync.ts`.
- POST /files/previews accepts hostId, rootPath and optional ttlMs, and returns baseUrl plus expiresAtMs. Append encoded relative path segments to the returned baseUrl; binary files may download rather than render. Source: `packages/server-contract/src/api/files.ts:101`, `packages/server-contract/src/public-api.ts:586`.
