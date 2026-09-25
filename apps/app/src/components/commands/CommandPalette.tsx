import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { globalSearchQueryKeyPrefix } from "@/hooks/queries/global-search-query-key";
import {
  CORE_SETTINGS_CATALOG,
  CORE_SETTINGS_PAGES,
  type KeyboardCommandId,
  type ThreadListEntry,
} from "@bb/domain";
import { threadListIndicatorStateForThread } from "@bb/client-core";
import type {
  SearchGroup,
  SearchResult,
  SearchSettingResult,
} from "@bb/server-contract";
import { Dialog, DialogContent, DialogTitle } from "@bb/shared-ui/dialog";
import { ResponsiveDrawerShell } from "@bb/shared-ui/responsive-overlay";
import { Icon } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  useAppCommandHandler,
  useIndexedAppCommandHandlers,
  useAppCommandRunner,
  useAppCommandShortcuts,
} from "./AppCommandProvider";
import {
  buildAppCommandActions,
  PALETTE_COMMAND_IDS,
  paletteActionIdForCommand,
} from "@/lib/command-palette/palette-app-commands";
import type { PaletteAction } from "@/lib/command-palette/palette-action";
import {
  localActionResults,
  matchClass,
  readSearchRecents,
  recordSearchRecent,
  SEARCH_GROUP_LABELS,
  SEARCH_GROUP_ORDER,
  sortSearchGroups,
  type SearchEntry,
  type SearchGroupKind,
} from "@/lib/command-palette/global-search";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useHosts } from "@/hooks/queries/host-queries";
import { useHostDaemon, useLocalHostDaemonAccess } from "@/hooks/useHostDaemon";
import { getBbDesktopInfo } from "@/lib/bb-desktop";
import { sdk } from "@/lib/sdk";
import { useRouteNavigate } from "@/components/ui/app-route-anchor";
import {
  getThreadRoutePath,
  getProjectComposeRoutePath,
  getSettingsRoutePath,
  getSettingsMachineRoutePath,
} from "@/lib/route-paths";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { usePromptDraftHasInput } from "@/hooks/usePromptDraftStorage";
import { usePluginThreadRowStatus } from "@/lib/plugin-thread-row-status";
import {
  resolveThreadStatus,
  ThreadStatusGlyph,
} from "@/components/thread/ThreadStatusGlyph";
import {
  setPreferredTheme,
  useThemePreference,
  type ThemePreference,
} from "@/hooks/useTheme";
import { pluginCommandId, pluginCommandIdSchema } from "@bb/domain";
import { usePluginSlots } from "@/lib/plugin-slots";
import { buildPluginPaletteActions } from "@/lib/command-palette/palette-plugin-actions";
import { getActiveThreadPanelOpener } from "@/components/plugin/plugin-thread-panel-navigation";
import {
  PALETTE_SECTION_LABEL_CLASS,
  PaletteShell,
  PaletteShortcut,
} from "./PaletteShell";

function targetOf(invocation: {
  target: EventTarget | null;
}): EventTarget | null {
  return invocation.target ?? document.activeElement;
}

interface VisibleGroup {
  kind: SearchGroupKind | "recent";
  entries: SearchEntry[];
  nextCursor?: string;
}
interface VisibleOption {
  key: string;
  group: SearchGroupKind | "recent";
  entry?: SearchEntry;
  more?: boolean;
}

function replacementOption(
  previous: readonly VisibleOption[],
  current: readonly VisibleOption[],
  selectedId: string,
): VisibleOption | undefined {
  const previousIndex = previous.findIndex(
    (option) => option.key === selectedId,
  );
  const group = previous[previousIndex]?.group;
  if (!group) return current[0];
  const currentKeys = new Set(current.map((option) => option.key));
  const later = previous
    .slice(previousIndex + 1)
    .find((option) => option.group === group && currentKeys.has(option.key));
  const earlier = previous
    .slice(0, previousIndex)
    .reverse()
    .find((option) => option.group === group && currentKeys.has(option.key));
  return (
    later ??
    earlier ??
    current.find((option) => option.group === group) ??
    current[0]
  );
}

export function CommandPalette({
  threadId,
  projectId,
}: {
  threadId: string | null;
  projectId: string | null;
}) {
  const runner = useAppCommandRunner();
  const navigate = useRouteNavigate();
  const compact = useIsCompactViewport();
  const themePreference = useThemePreference();
  const shortcuts = useAppCommandShortcuts(PALETTE_COMMAND_IDS);
  const pluginSlots = usePluginSlots();
  const pluginCommandIds = useMemo(
    () =>
      pluginSlots.commandPaletteActions.map((slot) =>
        pluginCommandId(slot.pluginId, slot.id),
      ),
    [pluginSlots.commandPaletteActions],
  );
  const pluginShortcuts = useAppCommandShortcuts(pluginCommandIds);
  useIndexedAppCommandHandlers(pluginCommandIds, (index) => {
    const slot = pluginSlots.commandPaletteActions[index];
    if (!slot) return false;
    const action = buildPluginPaletteActions({
      slots: [slot],
      threadId,
      projectId,
      openThreadPanel: getActiveThreadPanelOpener(),
    })[0];
    if (!action) return false;
    action.run();
    return true;
  });
  const listId = useId();
  const optionPrefix = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const openTargetRef = useRef<EventTarget | null>(null);
  const pendingRunRef = useRef<(() => void) | null>(null);
  const pageAbortRef = useRef<AbortController | null>(null);
  const pageRequestRef = useRef(0);
  const revisionRef = useRef(0);
  const previousOptionsRef = useRef<VisibleOption[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [actions, setActions] = useState<PaletteAction[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [userMoved, setUserMoved] = useState(false);
  const [groupOrder, setGroupOrder] = useState<SearchGroupKind[]>([]);
  const [limits, setLimits] = useState<
    Partial<Record<SearchGroupKind, number>>
  >({});
  const [pages, setPages] = useState<
    Partial<Record<SearchGroupKind, SearchGroup>>
  >({});
  const [pageLoading, setPageLoading] = useState<SearchGroupKind | null>(null);
  const [pageError, setPageError] = useState<SearchGroupKind | null>(null);
  const [recentRevision, setRecentRevision] = useState(0);
  const navigation = useSidebarNavigation({ enabled: open });
  const hosts = useHosts({ enabled: open });
  const { accessState } = useLocalHostDaemonAccess();
  const { hasDaemon } = useHostDaemon();
  const settingAvailable = useCallback(
    (availability: SearchSettingResult["availability"]) => {
      if (availability === "desktop-browser")
        return getBbDesktopInfo() !== null;
      if (availability === "local-helper-setup")
        return !hasDaemon && accessState !== "unavailable";
      if (availability === "local-daemon") return hasDaemon;
      return true;
    },
    [accessState, hasDaemon],
  );
  const server = typeof window === "undefined" ? "" : window.location.origin;
  const normalizedQuery = query.startsWith(">")
    ? query.slice(1).trim()
    : query.trim();
  const debouncedQuery = useDebouncedValue(normalizedQuery, 150);
  const isCurrentQuery = debouncedQuery === normalizedQuery;
  const search = useQuery({
    queryKey: [
      ...globalSearchQueryKeyPrefix(),
      server,
      debouncedQuery,
      projectId,
    ],
    queryFn: ({ signal }) =>
      sdk.search.query({
        query: debouncedQuery,
        contextProjectId: projectId ?? undefined,
        limitPerGroup: 20,
        signal,
      }),
    enabled: open && normalizedQuery.length > 0 && isCurrentQuery,
    staleTime: 15_000,
  });
  useEffect(() => {
    pageRequestRef.current += 1;
    pageAbortRef.current?.abort();
    setPages({});
    setPageLoading(null);
    setPageError(null);
  }, [search.dataUpdatedAt]);
  const remoteGroups = isCurrentQuery && search.data ? search.data.groups : [];
  const localActions = useMemo(
    () => localActionResults(actions, normalizedQuery),
    [actions, normalizedQuery],
  );
  const registeredActionCatalog = useMemo(
    () =>
      buildPluginPaletteActions({
        slots: pluginSlots.commandPaletteActions,
        threadId,
        projectId,
        openThreadPanel: getActiveThreadPanelOpener(),
      }).map((action) => ({
        ...action,
        group: "Actions",
        shortcut:
          pluginShortcuts.get(pluginCommandIdSchema.parse(action.id)) ?? null,
      })),
    [pluginShortcuts, pluginSlots.commandPaletteActions, projectId, threadId],
  );
  const registeredActions = useMemo(
    () => localActionResults(registeredActionCatalog, normalizedQuery),
    [normalizedQuery, registeredActionCatalog],
  );
  const themeCatalog = useMemo(() => {
    const themes: { value: ThemePreference; title: string }[] = [
      { value: "light", title: "Switch to light theme" },
      { value: "dark", title: "Switch to dark theme" },
      { value: "system", title: "Use system theme" },
    ];
    return themes.map(({ value, title }): PaletteAction => ({
      id: `theme:${value}`,
      bucket: "Actions",
      group: "Appearance",
      title,
      aliases: value === "system" ? ["system appearance"] : [`${value} mode`],
      shortcut: null,
      run: () => {
        if (themePreference !== value) setPreferredTheme(value);
      },
    }));
  }, [themePreference]);
  const themeActions = useMemo(
    () => localActionResults(themeCatalog, normalizedQuery),
    [normalizedQuery, themeCatalog],
  );
  const allLocalActions = useMemo(
    () => [...localActions, ...registeredActions, ...themeActions],
    [localActions, registeredActions, themeActions],
  );
  const localSettings = useMemo<SearchResult[]>(
    () => [
      ...CORE_SETTINGS_CATALOG.flatMap((setting) => {
        if (!settingAvailable(setting.availability)) return [];
        const rank = matchClass(
          setting.label,
          setting.description,
          normalizedQuery,
          setting.aliases,
        );
        return rank === null
          ? []
          : [
              {
                id: `setting:${setting.id}`,
                kind: "setting" as const,
                label: setting.label,
                subtitle: setting.description,
                matchClass: rank,
                highlights: [],
                destination: setting.path,
                settingId: setting.id,
                availability: setting.availability,
              },
            ];
      }),
      ...CORE_SETTINGS_PAGES.flatMap((page) => {
        const rank = matchClass(
          page.label,
          page.description,
          normalizedQuery,
          page.aliases,
        );
        return rank === null
          ? []
          : [
              {
                id: `settings-page:${page.id}`,
                kind: "setting" as const,
                label: page.label,
                subtitle: page.description,
                matchClass: rank,
                highlights: [],
                destination: page.path,
                settingId: `page:${page.id}`,
                availability: "always" as const,
              },
            ];
      }),
    ],
    [normalizedQuery, settingAvailable],
  );
  const actionsById = useMemo(
    () =>
      new Map(
        [...actions, ...registeredActionCatalog, ...themeCatalog].map(
          (action) => [action.id, action],
        ),
      ),
    [actions, registeredActionCatalog, themeCatalog],
  );
  const recentDestinations = useMemo(
    () => readSearchRecents(server, "destinations"),
    [server, recentRevision],
  );
  const recentActions = useMemo(
    () => readSearchRecents(server, "actions"),
    [server, recentRevision],
  );
  const recentThreads = useMemo<SearchResult[]>(() => {
    if (!navigation.data) return [];
    return [...navigation.data.projects, navigation.data.personalProject]
      .flatMap((project) =>
        project.threads.map((thread) => ({
          id: `thread:${thread.id}`,
          kind: "thread" as const,
          label: getThreadDisplayTitle(thread),
          subtitle: project.name,
          matchClass: 1 as const,
          highlights: [],
          destination: getThreadRoutePath({
            projectId: project.id,
            threadId: thread.id,
          }),
          threadId: thread.id,
          projectId: project.id,
          archived: thread.archivedAt !== null,
          status: "",
          updatedAt: thread.updatedAt,
          thread,
        })),
      )
      .filter((thread) => !thread.archived)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [navigation.data]);
  const sidebarThreadsById = useMemo(
    () =>
      new Map<string, ThreadListEntry>(
        navigation.data
          ? [
              ...navigation.data.projects,
              navigation.data.personalProject,
            ].flatMap((project) =>
              project.threads.map((thread) => [thread.id, thread] as const),
            )
          : [],
      ),
    [navigation.data],
  );
  const recentProjects = useMemo<SearchResult[]>(
    () =>
      navigation.data
        ? [...navigation.data.projects, navigation.data.personalProject].map(
            (project) => ({
              id: `project:${project.id}`,
              kind: "project" as const,
              label: project.name,
              matchClass: 1 as const,
              highlights: [],
              destination: getProjectComposeRoutePath(project.id),
              projectId: project.id,
            }),
          )
        : [],
    [navigation.data],
  );
  const recentSettings = useMemo<SearchResult[]>(
    () => [
      ...CORE_SETTINGS_CATALOG.filter((setting) =>
        settingAvailable(setting.availability),
      ).map((setting) => ({
        id: `setting:${setting.id}`,
        kind: "setting" as const,
        label: setting.label,
        subtitle: setting.description,
        matchClass: 1 as const,
        highlights: [],
        destination: setting.path,
        settingId: setting.id,
        availability: setting.availability,
      })),
      ...CORE_SETTINGS_PAGES.map((page) => ({
        id: `settings-page:${page.id}`,
        kind: "setting" as const,
        label: page.label,
        subtitle: page.description,
        matchClass: 1 as const,
        highlights: [],
        destination: page.path,
        settingId: `page:${page.id}`,
        availability: "always" as const,
      })),
    ],
    [settingAvailable],
  );
  const recentMachines = useMemo<SearchResult[]>(
    () =>
      (hosts.data ?? []).map((host) => ({
        id: `machine:${host.id}`,
        kind: "machine" as const,
        label: host.name ?? host.id,
        matchClass: 1 as const,
        highlights: [],
        destination: getSettingsMachineRoutePath(host.id),
        machineId: host.id,
        status: host.status,
      })),
    [hosts.data],
  );
  const emptyActions = useMemo<SearchEntry[]>(() => {
    const primary = [paletteActionIdForCommand("thread.new")];
    const candidates = [...primary, "open-settings", ...recentActions];
    const entries: SearchEntry[] = [];
    for (const id of candidates) {
      const action =
        id === "open-settings"
          ? {
              id,
              bucket: "Actions" as const,
              group: "App",
              title: "Open settings",
              shortcut: null,
              run: () => navigate(getSettingsRoutePath()),
            }
          : actionsById.get(id);
      if (!action || entries.some((entry) => entry.id === id)) continue;
      entries.push({
        id,
        kind: "local-action",
        label: action.title,
        subtitle: action.group,
        matchClass: 1,
        action,
      });
      if (entries.length === 5) break;
    }
    return entries;
  }, [actionsById, navigate, recentActions]);
  const emptyRecent = useMemo<SearchEntry[]>(() => {
    const byId = new Map<string, SearchEntry>(
      [
        ...recentThreads,
        ...recentProjects,
        ...recentSettings,
        ...recentMachines,
      ].map((entry) => [entry.id, entry]),
    );
    const entries = recentDestinations
      .flatMap((id) => {
        const entry = byId.get(id);
        return entry ? [entry] : [];
      })
      .slice(0, 6);
    for (const thread of recentThreads) {
      if (entries.length === 6) break;
      if (!entries.some((entry) => entry.id === thread.id))
        entries.push(thread);
    }
    return entries;
  }, [
    recentDestinations,
    recentMachines,
    recentProjects,
    recentSettings,
    recentThreads,
  ]);
  const remoteByKind = useMemo(
    () => new Map(remoteGroups.map((group) => [group.kind, group])),
    [remoteGroups],
  );
  const queryGroups = useMemo<VisibleGroup[]>(
    () =>
      SEARCH_GROUP_ORDER.map((kind) => {
        const group = remoteByKind.get(kind);
        const page = pages[kind];
        const serverEntries = [
          ...(group?.results ?? []),
          ...(page?.results ?? []),
        ].filter(
          (entry) =>
            entry.kind !== "setting" || settingAvailable(entry.availability),
        );
        const entries =
          kind === "actions"
            ? [
                ...allLocalActions,
                ...serverEntries.flatMap((entry): SearchEntry[] => {
                  if (entry.kind !== "action") return [];
                  if (entry.actionId === "settings.open") return [];
                  const localId = entry.actionId.startsWith("theme.")
                    ? `theme:${entry.actionId.slice(6)}`
                    : `app:${entry.actionId}`;
                  const action = actionsById.get(localId);
                  return action
                    ? [
                        {
                          id: localId,
                          kind: "local-action",
                          label: entry.label,
                          matchClass: entry.matchClass,
                          action,
                        },
                      ]
                    : [];
                }),
              ]
            : kind === "settings"
              ? [...serverEntries, ...localSettings]
              : serverEntries;
        const byId = new Map<string, SearchEntry>();
        for (const entry of entries) {
          const previous = byId.get(entry.id);
          if (!previous || entry.matchClass < previous.matchClass)
            byId.set(entry.id, entry);
        }
        const unique = [...byId.values()];
        unique.sort((a, b) => a.matchClass - b.matchClass);
        return {
          kind,
          entries: unique,
          nextCursor: page === undefined ? group?.nextCursor : page.nextCursor,
        };
      }),
    [
      actionsById,
      allLocalActions,
      localSettings,
      pages,
      remoteByKind,
      settingAvailable,
    ],
  );
  const rankedOrder = useMemo(
    () =>
      sortSearchGroups(
        queryGroups.map((group) => ({
          kind: group.kind as SearchGroupKind,
          results: group.entries,
        })),
      ),
    [queryGroups],
  );
  useEffect(() => {
    if (!open || !normalizedQuery || !userMoved) return;
    setGroupOrder((current) => {
      const additions = rankedOrder.filter((kind) => !current.includes(kind));
      return additions.length ? [...current, ...additions] : current;
    });
  }, [open, normalizedQuery, rankedOrder, userMoved]);
  const groups = useMemo<VisibleGroup[]>(
    () =>
      normalizedQuery
        ? (userMoved && groupOrder.length ? groupOrder : rankedOrder)
            .map((kind) => queryGroups.find((group) => group.kind === kind))
            .filter((group): group is VisibleGroup =>
              Boolean(group && (group.entries.length || group.nextCursor)),
            )
        : (
            [
              { kind: "recent", entries: emptyRecent },
              { kind: "actions", entries: emptyActions },
              {
                kind: "projects",
                entries: recentProjects
                  .filter(
                    (project) =>
                      !emptyRecent.some((entry) => entry.id === project.id),
                  )
                  .slice(0, 4),
              },
            ] satisfies VisibleGroup[]
          ).filter((group) => group.entries.length > 0),
    [
      emptyActions,
      emptyRecent,
      groupOrder,
      normalizedQuery,
      queryGroups,
      rankedOrder,
      recentProjects,
      userMoved,
    ],
  );
  const options = useMemo<VisibleOption[]>(
    () =>
      groups.flatMap((group) => {
        const limit = normalizedQuery
          ? (limits[group.kind as SearchGroupKind] ?? 4)
          : group.entries.length;
        const visible: VisibleOption[] = group.entries
          .slice(0, limit)
          .map((entry) => ({ key: entry.id, group: group.kind, entry }));
        if (
          normalizedQuery &&
          (group.entries.length > limit || group.nextCursor)
        )
          visible.push({
            key: `more:${group.kind}`,
            group: group.kind,
            more: true,
          });
        return visible;
      }),
    [groups, limits, normalizedQuery],
  );
  const selectedIndex =
    userMoved && selectedId
      ? options.findIndex((option) => option.key === selectedId)
      : 0;
  const replacement =
    userMoved && selectedId && selectedIndex < 0
      ? replacementOption(previousOptionsRef.current, options, selectedId)
      : undefined;
  const activeIndex =
    options.length === 0
      ? -1
      : selectedIndex >= 0
        ? selectedIndex
        : options.findIndex((option) => option.key === replacement?.key);
  const loading = Boolean(
    normalizedQuery && (!isCurrentQuery || search.isFetching || pageLoading),
  );
  const failed = Boolean(normalizedQuery && isCurrentQuery && search.isError);

  const openPalette = useCallback(
    (target: EventTarget | null) => {
      if (open) {
        inputRef.current?.focus();
        return;
      }
      revisionRef.current += 1;
      pageRequestRef.current += 1;
      pageAbortRef.current?.abort();
      openTargetRef.current = target;
      setActions(
        buildAppCommandActions({
          target,
          isCommandAvailable: runner.isCommandAvailable,
          dispatch: runner.dispatch,
          shortcuts,
        }),
      );
      setQuery("");
      setSelectedId(null);
      setUserMoved(false);
      setGroupOrder([]);
      setLimits({});
      setPages({});
      setPageError(null);
      setPageLoading(null);
      setRecentRevision((value) => value + 1);
      setOpen(true);
    },
    [open, runner.dispatch, runner.isCommandAvailable, shortcuts],
  );
  useAppCommandHandler("palette.open", (invocation) => {
    openPalette(targetOf(invocation));
    return true;
  });
  useAppCommandHandler(
    "thread.search",
    (invocation) => {
      openPalette(targetOf(invocation));
      return true;
    },
    100,
  );
  const shortcutActions = useMemo(() => {
    const byId = new Map(actions.map((action) => [action.id, action]));
    const result = new Map<KeyboardCommandId, PaletteAction>();
    for (const id of PALETTE_COMMAND_IDS) {
      const action = byId.get(paletteActionIdForCommand(id));
      if (action) result.set(id, action);
    }
    for (const id of pluginCommandIds) {
      const action = buildPluginPaletteActions({
        slots: pluginSlots.commandPaletteActions.filter(
          (slot) => pluginCommandId(slot.pluginId, slot.id) === id,
        ),
        threadId,
        projectId,
        openThreadPanel: getActiveThreadPanelOpener(),
      })[0];
      if (action)
        result.set(pluginCommandIdSchema.parse(id), {
          ...action,
          shortcut:
            pluginShortcuts.get(pluginCommandIdSchema.parse(id)) ?? null,
        });
    }
    return result;
  }, [
    actions,
    pluginCommandIds,
    pluginShortcuts,
    pluginSlots.commandPaletteActions,
    projectId,
    threadId,
  ]);
  const runAfterClose = useCallback((run: () => void) => {
    pendingRunRef.current = run;
    revisionRef.current += 1;
    pageAbortRef.current?.abort();
    setOpen(false);
  }, []);
  const activate = useCallback(
    (option: VisibleOption | undefined) => {
      if (!option) return;
      if (option.more) {
        const kind = option.group as SearchGroupKind;
        const group = groups.find((candidate) => candidate.kind === kind);
        const visibleLimit = limits[kind] ?? 4;
        if (group && group.entries.length > visibleLimit) {
          setLimits((current) => ({ ...current, [kind]: visibleLimit + 20 }));
          return;
        }
        if (group?.nextCursor && !pageLoading) {
          const revision = revisionRef.current;
          const request = ++pageRequestRef.current;
          const controller = new AbortController();
          pageAbortRef.current?.abort();
          pageAbortRef.current = controller;
          setPageLoading(kind);
          setPageError(null);
          void sdk.search
            .query({
              query: normalizedQuery,
              contextProjectId: projectId ?? undefined,
              limitPerGroup: 20,
              cursor: group.nextCursor,
              signal: controller.signal,
            })
            .then(
              (response) => {
                if (
                  revision !== revisionRef.current ||
                  request !== pageRequestRef.current ||
                  controller.signal.aborted
                )
                  return;
                const next = response.groups.find(
                  (candidate) => candidate.kind === kind,
                );
                if (next)
                  setPages((current) => ({
                    ...current,
                    [kind]: {
                      ...next,
                      results: [
                        ...(current[kind]?.results ?? []),
                        ...next.results,
                      ],
                    },
                  }));
                setLimits((current) => ({
                  ...current,
                  [kind]: visibleLimit + 20,
                }));
              },
              () => {
                if (
                  revision === revisionRef.current &&
                  request === pageRequestRef.current &&
                  !controller.signal.aborted
                )
                  setPageError(kind);
              },
            )
            .finally(() => {
              if (
                revision === revisionRef.current &&
                request === pageRequestRef.current &&
                !controller.signal.aborted
              )
                setPageLoading(null);
            });
        }
        return;
      }
      const entry = option.entry;
      if (!entry) return;
      const type =
        entry.kind === "local-action" || entry.kind === "action"
          ? "actions"
          : "destinations";
      const action =
        entry.kind === "local-action"
          ? entry.action
          : entry.kind === "action"
            ? actionsById.get(`app:${entry.actionId}`)
            : undefined;
      if (action) {
        runAfterClose(() => {
          action.run();
          recordSearchRecent(server, type, entry.id);
        });
        return;
      }
      if (entry.kind === "action") return;
      const destination =
        entry.kind === "local-action" ? "" : entry.destination;
      runAfterClose(() => {
        if (entry.kind === "thread") {
          const state =
            entry.messageAnchor === undefined
              ? undefined
              : {
                  searchMessageSeq: entry.messageAnchor,
                  searchThreadId: entry.threadId,
                };
          navigate(
            getThreadRoutePath({
              projectId: entry.projectId,
              threadId: entry.threadId,
            }),
            { state },
          );
        } else navigate(destination);
        recordSearchRecent(server, type, entry.id);
      });
    },
    [
      actionsById,
      groups,
      limits,
      navigate,
      normalizedQuery,
      pageLoading,
      projectId,
      runAfterClose,
      server,
    ],
  );
  const selectIndex = useCallback(
    (index: number) => {
      setGroupOrder((current) => (current.length ? current : rankedOrder));
      setSelectedId(options[index]?.key ?? null);
      setUserMoved(true);
      listRef.current
        ?.querySelector(`[id="${optionPrefix}-${index}"]`)
        ?.scrollIntoView?.({ block: "nearest" });
    },
    [optionPrefix, options, rankedOrder],
  );
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing || event.key === "Process") return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (options.length === 0) return;
        event.preventDefault();
        selectIndex(
          event.key === "ArrowDown"
            ? (activeIndex + 1) % options.length
            : (activeIndex + options.length - 1) % options.length,
        );
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        activate(options[activeIndex]);
      }
    },
    [activate, activeIndex, options, selectIndex],
  );
  const handleClose = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      revisionRef.current += 1;
      pageAbortRef.current?.abort();
      setQuery("");
      setPages({});
      setPageLoading(null);
    }
  }, []);
  const handleAfterClose = useCallback(() => {
    const target = openTargetRef.current;
    if (target instanceof HTMLElement && target.isConnected)
      target.focus({ preventScroll: true });
    const pending = pendingRunRef.current;
    pendingRunRef.current = null;
    pending?.();
  }, []);
  useEffect(() => {
    if (
      userMoved &&
      selectedId &&
      !options.some((option) => option.key === selectedId)
    ) {
      setSelectedId(
        replacementOption(previousOptionsRef.current, options, selectedId)
          ?.key ?? null,
      );
    }
    previousOptionsRef.current = options;
  }, [options, selectedId, userMoved]);

  const body = (
    <div
      data-testid="command-palette"
      onKeyDownCapture={(event) => {
        const command = runner.getShortcutCommand(event.nativeEvent, [
          "palette.open",
          "thread.search",
          ...shortcutActions.keys(),
        ]);
        if (!command) return;
        event.preventDefault();
        event.stopPropagation();
        if (command === "palette.open" || command === "thread.search") {
          inputRef.current?.focus();
          return;
        }
        const action = shortcutActions.get(command);
        if (action) runAfterClose(action.run);
      }}
    >
      <PaletteShell
        inputRef={inputRef}
        activeDescendantId={
          activeIndex < 0 ? undefined : `${optionPrefix}-${activeIndex}`
        }
        inputDescription="Use arrows to select and Enter to open. Escape closes search."
        inputLabel="Search"
        listId={listId}
        listLabel="Search results"
        listRef={listRef}
        onInputChange={(value) => {
          revisionRef.current += 1;
          pageAbortRef.current?.abort();
          setQuery(value);
          setSelectedId(null);
          setUserMoved(false);
          setGroupOrder([]);
          setLimits({});
          setPages({});
          setPageError(null);
          setPageLoading(null);
          if (listRef.current) listRef.current.scrollTop = 0;
        }}
        onInputKeyDown={handleKeyDown}
        placeholder="Search anything…"
        value={query}
        inputAccessory={
          compact ? (
            <button
              type="button"
              aria-label="Close search"
              className="inline-flex size-11 items-center justify-center"
              onClick={() => handleClose(false)}
            >
              <Icon name="X" className="size-4" />
            </button>
          ) : undefined
        }
      >
        {groups.map((group) => (
          <div
            key={group.kind}
            role="group"
            aria-labelledby={`${optionPrefix}-${group.kind}-label`}
            className="not-last:mb-2"
          >
            <div
              id={`${optionPrefix}-${group.kind}-label`}
              className={PALETTE_SECTION_LABEL_CLASS}
            >
              {group.kind === "recent"
                ? "Recent"
                : SEARCH_GROUP_LABELS[group.kind]}
            </div>
            {options.map((option, index) =>
              option.group !== group.kind ? null : (
                <div
                  key={option.key}
                  id={`${optionPrefix}-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm",
                    index === activeIndex &&
                      "bg-sidebar-accent text-foreground",
                  )}
                  onPointerMove={(event) => {
                    if (event.movementX || event.movementY) selectIndex(index);
                  }}
                  onClick={() => activate(option)}
                >
                  {option.more ? (
                    <>
                      <Icon name="ChevronDown" className="size-4" />
                      <span>
                        Show more{" "}
                        {SEARCH_GROUP_LABELS[
                          group.kind as SearchGroupKind
                        ].toLowerCase()}
                      </span>
                    </>
                  ) : option.entry ? (
                    <SearchResultRow
                      entry={option.entry}
                      thread={
                        option.entry.kind === "thread"
                          ? (sidebarThreadsById.get(option.entry.threadId) ??
                            option.entry.thread)
                          : undefined
                      }
                      themePreference={themePreference}
                      showShortcut={!compact}
                    />
                  ) : null}
                </div>
              ),
            )}
          </div>
        ))}
        {loading ? (
          <p role="status" className="px-3 py-2 text-xs text-subtle-foreground">
            Searching…
          </p>
        ) : null}
        {failed || pageError ? (
          <p role="status" className="px-3 py-2 text-xs text-subtle-foreground">
            Couldn’t load{" "}
            {pageError
              ? SEARCH_GROUP_LABELS[pageError].toLowerCase()
              : "search results"}
            .{" "}
            <button
              type="button"
              className="underline"
              onClick={() => {
                if (pageError) {
                  const option = options.find(
                    (item) => item.more && item.group === pageError,
                  );
                  activate(option);
                } else void search.refetch();
              }}
            >
              Retry
            </button>
          </p>
        ) : null}
        {!loading &&
        !failed &&
        !pageError &&
        normalizedQuery &&
        options.length === 0 ? (
          <p
            role="status"
            className="px-3 py-4 text-center text-sm text-subtle-foreground"
          >
            No results for “{normalizedQuery}”
          </p>
        ) : null}
        {!normalizedQuery && groups.length === 0 ? (
          <p className="px-3 py-4 text-center text-sm text-subtle-foreground">
            No recent items
          </p>
        ) : null}
      </PaletteShell>
      {!compact ? (
        <div className="flex h-10 items-center justify-end gap-4 border-t border-border px-4 text-xs text-subtle-foreground">
          <span className="inline-flex items-center gap-1.5">
            <PaletteShortcut>↵</PaletteShortcut>
            Select
          </span>
          <span className="inline-flex items-center gap-1.5">
            <PaletteShortcut>Esc</PaletteShortcut>
            Close
          </span>
        </div>
      ) : null}
    </div>
  );
  if (compact)
    return (
      <ResponsiveDrawerShell
        open={open}
        onOpenChange={handleClose}
        onAfterCloseAutoFocus={handleAfterClose}
        srLabel="Search"
        contentClassName="bg-sidebar text-sidebar-foreground"
      >
        {body}
      </ResponsiveDrawerShell>
    );
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        hideCloseButton
        aria-describedby={undefined}
        className="top-[12%] max-w-[640px] translate-y-0 gap-0 bg-sidebar p-0 text-sidebar-foreground shadow-lg sm:rounded-xl overflow-hidden"
        onAfterCloseAutoFocus={handleAfterClose}
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        {body}
      </DialogContent>
    </Dialog>
  );
}

function SearchResultRow({
  entry,
  thread,
  themePreference,
  showShortcut,
}: {
  entry: SearchEntry;
  thread?: ThreadListEntry;
  themePreference: ThemePreference;
  showShortcut: boolean;
}) {
  const icon =
    entry.kind === "thread"
      ? "MessageSquare"
      : entry.kind === "project"
        ? "Folder"
        : entry.kind === "setting"
          ? "Settings"
          : entry.kind === "machine"
            ? "Monitor"
            : "Command";
  const shortcut =
    entry.kind === "local-action" && showShortcut
      ? entry.action.shortcut
      : null;
  const activeTheme = entry.id === `theme:${themePreference}`;
  const secondary: ReactNode[] = [];
  if (entry.kind === "thread" && entry.snippet)
    secondary.push(
      <HighlightedField
        text={entry.snippet}
        ranges={entry.highlights.filter((range) => range.field === "snippet")}
      />,
    );
  if (entry.subtitle)
    secondary.push(
      <HighlightedField
        text={entry.subtitle}
        ranges={
          entry.kind === "local-action"
            ? []
            : entry.highlights.filter((range) => range.field === "subtitle")
        }
      />,
    );
  if (entry.kind === "thread" && entry.archived) secondary.push("Archived");
  if (
    entry.kind === "machine" &&
    entry.status &&
    entry.subtitle !== entry.status
  )
    secondary.push(entry.status);
  const labelHighlights =
    entry.kind === "local-action"
      ? []
      : entry.highlights.filter((range) => range.field === "label");
  return (
    <>
      <Icon
        name={icon}
        className="size-4 shrink-0 text-subtle-foreground"
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          <HighlightedField text={entry.label} ranges={labelHighlights} />
        </span>
        {secondary.length ? (
          <span className="block truncate text-xs text-subtle-foreground">
            {secondary.map((part, index) => (
              <span key={index}>
                {index > 0 ? " · " : null}
                {part}
              </span>
            ))}
          </span>
        ) : null}
      </span>
      {entry.kind === "thread" && thread ? (
        <ThreadSearchStatus thread={thread} projectId={entry.projectId} />
      ) : null}
      {activeTheme ? (
        <span aria-label="Current theme">
          <Icon name="Check" className="size-4" />
        </span>
      ) : null}
      {shortcut ? <PaletteShortcut>{shortcut.label}</PaletteShortcut> : null}
    </>
  );
}

function ThreadSearchStatus({
  thread,
  projectId,
}: {
  thread: ThreadListEntry;
  projectId: string;
}) {
  const draft = usePromptDraftHasInput({
    kind: "thread",
    projectId,
    threadId: thread.id,
  });
  const status = threadListIndicatorStateForThread(thread, draft);
  const pluginStatus = usePluginThreadRowStatus(thread.id);
  const { accessibleLabel } = resolveThreadStatus(
    status,
    pluginStatus,
    thread.archivedAt !== null,
  );
  if (!accessibleLabel) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={accessibleLabel}
          className="inline-flex size-3.5 shrink-0 items-center justify-center text-subtle-foreground"
          data-palette-thread-status
        >
          <ThreadStatusGlyph
            {...status}
            archived={thread.archivedAt !== null}
            pluginStatus={pluginStatus}
            size="compact"
            decorative
          />
        </span>
      </TooltipTrigger>
      <TooltipContent side="left">{accessibleLabel}</TooltipContent>
    </Tooltip>
  );
}

function HighlightedField({
  text,
  ranges,
}: {
  text: string;
  ranges: readonly { start: number; end: number }[];
}) {
  if (ranges.length === 0) return <>{text}</>;
  const segments: ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    const start = Math.max(cursor, Math.min(text.length, range.start));
    const end = Math.max(start, Math.min(text.length, range.end));
    if (start > cursor) segments.push(text.slice(cursor, start));
    if (end > start)
      segments.push(
        <mark
          key={start}
          className="bg-transparent font-semibold text-foreground"
        >
          {text.slice(start, end)}
        </mark>,
      );
    cursor = end;
  }
  if (cursor < text.length) segments.push(text.slice(cursor));
  return <>{segments}</>;
}
