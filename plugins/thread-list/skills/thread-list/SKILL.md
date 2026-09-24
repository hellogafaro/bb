---
name: thread-list
description: "Inspect or change the sidebar thread list's layout preferences (organization mode, sort, section order, hidden and collapsed groups) and snoozed threads."
---

# Thread list preferences

The Thread list plugin owns the sidebar's layout state. Read it with
`bb thread-list prefs list --json`; keys are `threadLifecycles`, `organizationMode`,
`environmentGrouping`, `chronologicalSort`, `sortDirection`, `sectionOrder`,
`manualSectionOrder`, `machineSectionOrder`, `hiddenGroups` (including the
built-in `threads` group),
`collapsedSections`, `collapsedProjects`, `collapsedThreads`,
`collapsedEnvironments`, `collapsedThreadSections`, `collapsedMachines`, and
`collapsedStatusSections` (defaults to `["snoozed"]`).

```sh
bb thread-list prefs list [--json]
bb thread-list prefs get <key> [--json]
bb thread-list prefs set <key> <value> [--json]
bb thread-list prefs reset <key> [--json]
```

`set` takes JSON; a bare word is read as a string, so
`bb thread-list prefs set organizationMode machine` and
`bb thread-list prefs set manualSectionOrder '["pinned","sections","threads"]'`
both work. A value the key's schema rejects fails with
`invalid_preference_value` and leaves the stored value alone. Every open
window applies a change immediately. Sections themselves and a thread's
section are bb core state: use `bb thread section` and `bb thread update`.

On first load the plugin copies any non-default `sidebar.*` values from
`bb settings ui` once; after that the two are independent.

The header's Filter menu selects Active, Archived, or both; at least one must
remain selected. `bb thread-list prefs set threadLifecycles '["archived"]'`
shows archived threads, and `'["active","archived"]'` shows both. The default
is `'["active"]'`. Archived results load in pages; use Show more at the end
of the list. The same preference is available through `setPreference` RPC.

## Organized by status

`organizationMode` defaults to `status`: Pinned, then Waiting (a question,
approval, unread failure, or failed queued message), Ready (unread results),
Working, Done, and Snoozed. Child threads stay under their parent, and a family
takes its most urgent state. Opening an unread thread keeps it in place for five
seconds; leaving sooner marks it unread again. Other values are `project`,
`chronological` (Custom), and `machine`. Status section headers carry only a count; Organize and the
Active/Archived filter live in Settings → Thread list as well as these prefs.

## Snoozes

```sh
bb thread-list snooze list [--json]
bb thread-list snooze set <thread-id> <until> [--json]
bb thread-list snooze clear <thread-id> [--json]
```

`<until>` accepts `1h`, `3h`, `tomorrow` (9:00), `week` (next Monday 9:00), a
duration such as `45m` or `2d`, an ISO date, or epoch milliseconds. A snoozed
thread wakes at that time or as soon as it gets new activity; archiving or
deleting it clears the snooze. Working threads and threads waiting on input
cannot be snoozed from the list. The app uses the plugin's `listSnoozes`,
`snooze`, and `unsnooze` RPCs.
