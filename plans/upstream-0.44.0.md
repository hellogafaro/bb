# Upstream desktop-v0.44.0: inspection and pick list

State on 2026-09-27. Fork `main` is based on `desktop-v0.43.4` (merge base
`9b8c1d345`). Upstream's latest stable release is `desktop-v0.44.0` at
`0baa605b3` (2026-09-25), 169 commits ahead of our base. Upstream `main` has 22
more unreleased commits, which PLAN.md says we do not take.

Method: every upstream commit was cherry-picked in isolation onto `main` in a
throwaway worktree (`git cherry-pick -n`, then reset). CLEAN means it applied
without conflict on its own. Commits in a chain (navigation plugin, forkable
plugins, machine service, account stack) conflict in isolation but may apply in
order; `MERGE` below means take them only through a full release merge.

PLAN.md rule: "Follow upstream by stable release ... an agent merges the commit
it was built from, never unreleased `main`." Cherry-picking is a smaller step
that can precede or replace that merge for this release. Decide per group.

## A. Recommended: server, host, providers, tunnel fixes (all CLEAN)

These do not touch files the fork changed, or only touch them trivially.

| Commit | Change |
|---|---|
| a000c22b2 | Avoid bypass permissions when listing Claude Code models |
| 3d70b9613 | Speed up Docs mention search |
| 4c42240b6 | Fix dropped keystrokes and lag in plugin search |
| a13140ac1 | fix(turbo): pass pnpm store config to tasks |
| 66b97374f | Open threads from hidden sections without reloading the app |
| eee15e3f7 | Fix question keyboard focus and Enter submission |
| 103d9873f | Let the machine installer adopt an enrolled data directory |
| 2bb1d8727 | Read range-wide selection values once per selection report |
| 778264c9e | Paste text copied from inside a composer quote without quoting it |
| bb34cef42 | Keep outline jumps on target with timeline windowing |
| b4fc38640 | Recheck exhausted Account Pool usage before refusing a request |
| 384666f97 | Keep shared project checkout environments when a starting thread is cancelled |
| 4810c0161 | Speed up host plugin builds by reusing the resolved import graph |
| 6eb9254ac | Close every Claude thinking block in a multi-thinking response |
| 248445e15 | Fix turn details 500 when a summary range reaches turn completion |
| 4277998ed | Restart a tunnel Durable Object whose tunnel socket vanished |
| 96fee8ac1 | Keep secret requests alive through bb connect and in place in the timeline |
| 6f21bdeb4 | Fix Cancel leaving pending interactions stuck after runtime shutdown |
| dcc58375c | Fix stuck workspace claims after failed thread setup |
| 7c28ca1eb | Debounce reassignment notices for two seconds |
| c89ac32ea (MERGE) | fix(pi): preserve conversations when switching directories |
| 3cbba5230 | fix(provider-pi): render batched edit diffs |
| 8c7684ca6 | fix(provider-pi): add select keyboard shortcuts |
| e128105e2 (MERGE) | fix(provider-acp): accept grouped select options |
| f045186a2 | Track telemetry opt-outs |

Note 96fee8ac1 touches `plugins/secrets`, which the fork rewrote around
Infisical; it applied cleanly but needs a manual read.

## B. Recommended: desktop and mobile shell (CLEAN)

| Commit | Change |
|---|---|
| 94d77da09 | feat(desktop): add Cmd+F find in window |
| 5eeeab4b6 | Move the desktop Server menu under bb → Desktop Settings |
| d25c320c9 | Keep keyboard focus off automation-controlled browser tabs |
| 3f1bad6d5 | Run the desktop Electron startup smoke in CI |
| a27404951 | Show server error pages in the mobile shell |
| 262449da6 | Keep keyboard open when removing composer attachments on iOS |
| cfc8d686f | Keep mobile sidebar thread titles stable on touch |
| 9e6e45587 | Recover compact sidebar swipes after interrupted drags |
| c8ee6881b | Keep message edits expanded on mobile |

Conflicting but small, worth a manual port: 165a2ec4b + 3f352508a (desktop zoom
indicator and clamp), ef8af6260 (desktop startup recovery), 2f61160fe (focus
off hidden browser tabs), 1a4ddf493 + 97d6b34b0 (voice input fixes).

## C. Optional features (CLEAN unless marked)

| Commit | Change | Note |
|---|---|---|
| 1caad15c9 | git-diff: persist diff view mode and line wrap | plugin we do not touch |
| 1841c3c09 | Filter diff-panel files by path with globs | |
| 9c8112e54 (MERGE) | Funnel icon for the diff filter | icon set differs; skip |
| 57784a53f | Add `bb server install-machine-service` | 4174; 4175/4176/4198 conflict |
| 2d5d5e3d7 | Launch the multi-machine picker to everyone | |
| 71bd54e9e | Require confirmation before agents move a bb server | |
| 32eb5cb4b | Allow editing sent messages while ordinary messages are queued | |
| 36fdd7f17 | Show the server's host package error in the machine installer | |
| d7d8507d3 | Keep saved environment names out of thread chrome | |
| d016aa9be | Explain disabled checkout branch actions | |
| 7a4042bf6 | Align icons in short system timeline rows | icon set differs; check |
| b87b91609 (MERGE) | Block new threads on a missing provider CLI | |
| e1df4e57a (MERGE) | Enable Claude Code fast mode | touches provider-claude-code, which PLAN.md says never edit; take via merge |
| 3b319202f (MERGE) | GPT-6 Luna for Codex AI tasks | same rule |
| dd9529130 (MERGE) | Allow machine removal while preserving thread history | 66 files |
| 6984eba87 (MERGE) | Keep destroyed environment rows | |
| 90971b159 (MERGE) | Restore a destroyed thread workspace on request | 45 files |
| f86f33801 (MERGE) | Reconnect an offline machine without changing its host ID | 37 files |
| c730a01a6 (MERGE) | Fix byte ranges for thread-storage videos | overlaps our file preview work |
| 51d0e9744 (MERGE) | Move plugin compilation off the server event loop | 30 files |
| c3d0a185b (MERGE) | Plugin safe mode | 33 files |
| a8ce7a39a (MERGE) | Update bb from inside the app | 69 files; fork runs from ~/.local/bb |
| 9781a2126 (MERGE) | Ride bb connect through tunnel resets | connect package; never edit, merge only |

## D. Skip: replaced or removed in the fork

- Sidebar navigation plugin and thread-list forkability: 5813038bf, a28207d1c,
  ff60d44e2, d0fd16f36, db500967a, eff9e5a7d, b200b0460, 62ec21578, 890775c6e.
  The fork built the status sidebar into core and removed both plugins.
- Sidebar thread list polish: 669fb335d, b33f2a74f, fb5d7af04, f502e6a5d,
  b19304866, 853e1e9a1, 922b19bdd, a60b895dc, 239eb2fa3, 53d710222, 0759af84f,
  264796477, 822ab17f6, 98706229e, 129c2a914, 623f638cd, 85738107f, 204912503,
  2ab91b848. All edit files the fork deleted.
- Monaco: c9f439563. Removed in the fork.
- "Make X forkable" series 9158444cc..0bb004ad2 and c1a52e976, 93f781b99,
  bd8336244, 175d5acbb, 3853f3010: plugin marketplace plumbing the fork
  retired with plugin skills and the Plugins sidebar entry.
- Plugin detail page polish: 42d9bbdd7, b1b46e3e9, 705bb8931, 9eb4896eb,
  2031deee0, 1592e1c71, fd6a09dda, 24539cbb8.
- Account stack 900070df4, a67f21bab, f706e54f9, 2bbdf6612 and its revert
  9bfe862b3: net effect is only connect-db migrations; take through merge.
- Contributor approvals and website: 36f21755c, e60c0070b, e24f7367e,
  4e4fbb33d, eb2f4e351, 2bf69f9cc, ddb962879, fb1e6ac67, 6f9d6f44d,
  b2ff250e5, 2e75839c2, 0baa605b3.
- Settings reorganisation 94851e204, 08b27c02c, 3bcb0ec6a: the fork moved
  Skills, MCPs, Agents into a Customize group; port by hand if wanted.
- Helper AI tasks a67f21bab: the fork routes helper inference through
  OpenRouter (27cf5eb71); this is the largest structural conflict of the
  release and must be resolved in the full merge.

## Implementation plan

1. Branch `hg/upstream-0.44.0-picks` from `main`.
2. `git cherry-pick -x` group A, then B, in upstream order. Read 96fee8ac1
   against `plugins/secrets` before committing.
3. Cherry-pick the chosen rows from group C. For MERGE rows, stop.
4. `pnpm exec turbo run typecheck test --filter=@bb/server --filter=@bb/app
   --filter=@bb/host` and the desktop smoke; pipe output to a file.
5. Open a PR on `origin` with this file's table as the summary, per PLAN.md.
6. Schedule the full `0baa605b3` merge as its own PR afterwards; its conflict
   surface is the sidebar core files, `plugins/secrets`, helper AI tasks, and
   the file preview work.

## Result (branch `hg/upstream-0.44.0-picks`, 2026-09-27)

Taken: 93 upstream commits cherry-picked with `-x`, plus two hand ports
(853e1e9a1 drag Escape and threshold, app files only; 2ab91b848 phone caret
hit area) and one host-daemon protocol bump to 223. Migration 0131 from
upstream was regenerated as `0137_environment_retention_indexes`.

Skipped beyond the original list, with reasons:

| Commit | Reason |
|---|---|
| 492aaf982 install hook for plugin backends | exists for the deleted navigation plugin; docs conflicts only |
| da5be0055 filled empty submit button | Dusk composer keeps the ghost look; design call, review |
| 5bd4e1c4b unchecked switch visibility | Dusk switch already has the border and shadowed thumb |
| 94851e204, 08b27c02c Appearance and Interface cards | fork owns the Appearance card (wallpaper, search IDs) |
| 3bcb0ec6a provider choice menu | thread-list and navigation pickers are hidden in the fork |
| c3d0a185b plugin safe mode | depends on the skipped built-in fork checks and install hook |
| 3b319202f GPT-6 Luna for Codex AI tasks | file belongs to the skipped AI-tasks refactor |
| 97d6b34b0 voice transcription across navigation | fork rewrote both voice hooks; manual port candidate |
| c730a01a6 video byte ranges | fork already streams ranges through host.read_file_range |

Sidebar fixes checked against the fork's status sidebar are in
`plans/upstream-0.44.0-sidebar-bugcheck.md`: 2 applied, 17 not applicable.
