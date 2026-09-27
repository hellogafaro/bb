# Upstream desktop-v0.44.0 sidebar fixes vs. fork main

Checked against fork `main` at 446f610a8. Merge base with upstream is 9b8c1d345 (bb-app 0.43.4).

## Why most of these don't apply

The status thread list is built in. With no thread-list plugin installed, `PluginThreadList` renders `StatusThreadList` (`apps/app/src/components/sidebar/PluginThreadList.tsx:52`), which has:

- Only Pinned and the fixed status sections: Waiting, Ready, Working, Done, and Snoozed (`status-list/status-sections.ts:9`). There are no project groups, custom sections, environment/worktree group headers, section rename, section new-thread button, or More menu for hidden sections.
- No thread drag and drop. `StatusThreadList` never passes `dragBindings`, `nestDrop`, or `consumeClickSuppression` to `ThreadRow`. `useSectionThreadDnd()` is defined in `components/sidebar/useSectionThreadDnd.ts:836` but has no caller, and `SectionThreadDndProvider` is never mounted.
- No "Move to section". The fork deleted it with `ThreadSectionMoveProvider`.
- No cross-project marker in `ThreadRow`. The project name is on the meta line instead (`ThreadRowMeta.tsx:73`).

Still live, and shared with upstream core: `ThreadRow`, `SidebarChildToggleChevron`, `useReorderDnd` (used for plugin nav items, footer settings, and new-tab actions), and the split-drag session (thread rows and plugin nav items).

## Verdicts

| sha | title | verdict | fork location | port notes |
|---|---|---|---|---|
| 669fb335d | Restore mobile thread row status-area navigation | NOT PRESENT | `apps/app/src/components/sidebar/ThreadRow.tsx:493-531` | The fork dropped `relative` from the link's column span (`:494`), so the `absolute inset-0` NavLink now covers the whole row, whose container is `relative` or sticky. On coarse pointers the trailing slot (`:606`) and the meta line (`ThreadRowMeta.tsx:78`) are `pointer-events-none`, so taps there fall through to the link. Upstream still had the link inside a `relative` title span (base `ThreadRow.tsx:506`), which is what caused the dead zone. Nothing to port. |
| b33f2a74f | Fix duplicate divider in thread list actions menu | NOT APPLICABLE | none | No section-header actions menu and no `ThreadListVisibilityMenuItems`. |
| fb5d7af04 | Restore Move to section in sidebar thread menu | NOT APPLICABLE | none | The fork deleted Move to section. The status list has no custom sections. |
| f502e6a5d | Polish the sidebar More menu | NOT APPLICABLE | none | No More popover or hidden sections in the fork sidebar. |
| b19304866 | Exclude Personal from project sidebar groups | NOT APPLICABLE | none | No project groups. Personal appears only as meta text (`ThreadRowMeta.tsx:73`). |
| 853e1e9a1 | Cancel sidebar drags on Escape and reduce accidental reorders | **BUG PRESENT** | `components/ui/useReorderDnd.ts:94`; `lib/split-drag/splitDragSession.ts:42-75,196-207`; `components/sidebar/usePaneContentSplitDrag.ts:163` | All three files are unchanged from the merge base. `git show 853e1e9a1 -- apps/ \| git apply --check` passes cleanly. Port the `apps/` hunks only (drop `plugins/`): MouseSensor distance 4→8; a capture-phase `keydown` Escape listener that calls `handleCancel` and is removed on teardown; a `cancelingSidebarReorder` guard so the synthetic Escape doesn't cancel the split drag itself; `cancelSidebarReorderOnEngage: true` in `beginSidebarPaneContentSplitDrag`. The two tests come with it. |
| 922b19bdd | Keep the collapsed environment group chevron visible without hover | NOT APPLICABLE | none | `StatusThreadList` flattens environment groups into plain nodes (`itemNodes`, `StatusThreadList.tsx:80`). No environment header. Parent thread rows already use `revealOnHover={!isParentCollapsed}` (`ThreadRow.tsx:569`). |
| a60b895dc | Center the collapsed environment header status glyph like thread rows | NOT APPLICABLE | none | No environment header. The fork's section-header rollup slot already uses `justify-center` (`TopLevelSidebarSection.tsx:124`). |
| 239eb2fa3 | Fix nesting worktree groups under threads | NOT APPLICABLE | `components/sidebar/useSectionThreadDnd.ts` (dead code) | The fix is to thread/group DnD, which the fork doesn't run. The core hunks (`plugin-bound-sdk.ts` coalescing, `plugin-sidebar-hooks.ts` `setPinned`, SDK contract/version bump, cache-owner transaction) only affect third-party thread-list plugins, and 53d710222 partly reverts them. Take them with a general upstream sync, not a sidebar port. |
| 53d710222 | Drag worktree groups through the single-thread drop rules | NOT APPLICABLE | same as above | Plugin DnD refactor. Its core part only removes mutation helpers that 239eb2fa3 added. |
| 0759af84f | Align cross-project sidebar icon after thread title | NOT APPLICABLE | none | The fork removed the cross-project marker from `ThreadRow`. |
| 264796477 | Fix flicker when renaming sidebar sections | NOT APPLICABLE | `TopLevelSidebarSection.tsx:64` (`onRename` unused) | Status sections are fixed and can't be renamed. `StatusThreadList` never passes `onRename`. |
| 822ab17f6 | Keep selected project when starting a thread in a section | NOT APPLICABLE | `lib/plugin-sidebar-hooks.ts:301` | No per-section new-thread button. Core `openNewThread` already leaves the project alone when `projectId` is undefined. Upstream only changed a test there. |
| 98706229e | Fix overlapping mobile thread list More menus | NOT APPLICABLE | none | No More menu or hidden-section drawer. |
| 129c2a914 | Require a deliberate long press to reorder sidebar threads | NOT APPLICABLE | `components/sidebar/useSidebarReorderDnd.ts:39` | Thread rows aren't sortable in the fork, so a slow tap can't unpin or reorder. The core `SidebarTouchSensor` (200 ms) is only used by plugin nav items. Upstream left its core copy at 200 ms too. |
| 623f638cd | Toggle provider row icons in the sidebar thread list | NOT APPLICABLE | none | A new opt-in feature, default off, not a bug fix. The fork shows the agent mascot in the trailing slot instead. It's a product call whether to add it. |
| 85738107f | Fix thread reparenting with only the default section | NOT APPLICABLE | `components/sidebar/useSectionThreadDnd.ts` (dead code) | Plugin chronological DnD enablement and nest-target resolution. No live DnD in the fork. |
| 204912503 | Stop the sidebar More menu from highlighting Search threads on open | NOT APPLICABLE | none | The fork's Search is a plain button (`SidebarPrimaryActions.tsx:80`), not a Popover. |
| 2ab91b848 | Enlarge the sidebar collapse caret's touch target on phones | **BUG PRESENT** | `apps/app/src/components/sidebar/SidebarChildToggleChevron.tsx:44-50` | Same 20×20 px caret as the merge base, and on phones the rest of the row is the thread link (see 669fb335d). Add `COARSE_POINTER_CHILD_TOGGLE_HIT_AREA_CLASS` (`max-md:pointer-coarse:after:absolute …-inset-y-2 …-left-1.5 …-right-2.5 …content-['']`) and put it in the button's `cn(...)` after the base class. The button is already `relative z-10`. The upstream patch fails only on import-path context, so apply it by hand. The −6 px left edge matches the fork's `gap-1.5` before the caret (`ThreadRow.tsx:494`). |

## BUG PRESENT, by user impact

1. **2ab91b848: phone collapse caret hit area.** On phones, the parent rows in every status section and in Pinned have a 20×20 caret, and the rest of the row opens the thread. A tap that just misses the caret opens the thread and closes the compact sidebar instead of expanding or collapsing the family. It's a one-constant, one-line port in `SidebarChildToggleChevron.tsx`. Verify on an iOS Simulator at 390×844: a tap slightly off the caret should toggle it, and a title tap should still navigate.
2. **853e1e9a1: drag Escape and jitter threshold.** On desktop, pressing Escape during a thread-row or nav-item drag to a split pane doesn't cancel it. The drag only ends on pointer release. Plugin nav-item reorders, footer settings, and new-tab actions start after 4 px of mouse movement, so click jitter can reorder them. When a nav item turns into a split drag, the reorder isn't cancelled. The core hunks apply cleanly with `git show 853e1e9a1 -- apps/ | git apply` and include tests. Run `pnpm exec turbo run test --filter=@bb/app -- --run src/components/ui/useReorderDnd.test.tsx src/lib/split-drag/splitDragSession.test.ts`.

## Side note

`useSectionThreadDnd.ts` (1431 lines) and its tests, `SectionThreadDndContext.ts`, and parts of `useSidebarReorderDnd.ts` can't be reached from the fork's built-in list. If thread DnD won't come back, deleting them would shrink future upstream merges.
