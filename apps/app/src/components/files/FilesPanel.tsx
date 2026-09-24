import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Button } from "@bb/shared-ui/button";
import {
  COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { useMediaQuery } from "@bb/shared-ui/hooks/use-media-query";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { cn } from "@bb/shared-ui/lib/utils";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { useEnvironment } from "@/hooks/queries/environment-queries";
import { defaultFolderToOpen, type FileEntry } from "./file-paths";
import { FileGlyph, FolderGlyph } from "./FileGlyph";
import {
  useFilesTransport,
  type DirectoryLocation,
  type FilesTransport,
} from "./files-transport";
import { FILES_COPY } from "./files-copy";
import { ScrollEdgeFades, useOverflowEdges } from "./scroll-fade";
import {
  expandedDirectoryPaths,
  pruneDirectories,
  sameEntries,
  treeRows,
  visibleRange,
  type TreeDirectory,
  type TreeRow,
} from "./tree-model";

const REFRESH_MS = 10_000;
const MAX_LISTINGS_IN_FLIGHT = 4;
const SEARCH_DEBOUNCE_MS = 150;
const ROW_HEIGHT = 28;
const COARSE_ROW_HEIGHT = 36;
const COARSE_QUERY = "(max-width: 767px) and (pointer: coarse)";
const LINE = "flex w-full min-w-0 items-center";
const ITEM = cn(
  "flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left text-sm font-normal text-foreground",
  "cursor-pointer border-0 bg-transparent hover:bg-state-hover",
  "focus-visible:bg-state-hover focus-visible:outline-none",
  "max-md:pointer-coarse:h-9",
);

function IndentGuides({ depth }: { depth: number }) {
  if (depth <= 0) return null;
  return (
    <span
      className="flex h-7 shrink-0 self-stretch max-md:pointer-coarse:h-9"
      aria-hidden="true"
    >
      {Array.from({ length: depth }, (_, index) => (
        <span key={index} className="relative w-3 self-stretch">
          <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
        </span>
      ))}
    </span>
  );
}

function TreeSkeleton({ rows, depth = 0 }: { rows: number; depth?: number }) {
  return (
    <ul
      className="m-0 list-none p-0"
      aria-busy="true"
      aria-label={FILES_COPY.loading}
    >
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="min-w-0">
          <div className={cn(LINE, "pointer-events-none")}>
            <IndentGuides depth={depth} />
            <div className={cn(ITEM, "hover:bg-transparent")}>
              <Skeleton className="size-4 shrink-0 rounded-sm" />
              <Skeleton
                className="h-3 rounded-sm"
                style={{ width: `${42 + ((index * 17) % 36)}%` }}
              />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function StatusLine({
  depth = 0,
  destructive = false,
  children,
}: {
  depth?: number;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <p
      role={destructive ? "alert" : undefined}
      className={cn(
        "flex h-7 items-center px-2 text-sm max-md:pointer-coarse:h-9",
        destructive ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <IndentGuides depth={depth} />
      {children}
    </p>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface TreeSession {
  directories: Map<string, TreeDirectory>;
  expanded: ReadonlySet<string>;
  scrollTop: number;
}

const MAX_TREE_SESSIONS = 8;
const treeSessions = new Map<string, TreeSession>();

function rememberTreeSession(key: string, session: TreeSession): void {
  treeSessions.delete(key);
  treeSessions.set(key, session);
  for (const oldest of treeSessions.keys()) {
    if (treeSessions.size <= MAX_TREE_SESSIONS) break;
    treeSessions.delete(oldest);
  }
}

const TreeRowItem = memo(function TreeRowItem({
  row,
  index,
  rowHeight,
  open,
  onClick,
}: {
  row: TreeRow;
  index: number;
  rowHeight: number;
  open: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const entry = row.entry;
  return (
    <li
      data-row-index={index}
      data-row-key={row.key}
      className="absolute inset-x-0 min-w-0"
      style={{ top: index * rowHeight, height: rowHeight }}
    >
      {entry !== undefined ? (
        <div className={LINE}>
          <IndentGuides depth={row.depth} />
          <button
            type="button"
            className={ITEM}
            data-path={entry.relativePath}
            data-kind={entry.kind}
            aria-expanded={entry.kind === "directory" ? open : undefined}
            onClick={onClick}
          >
            {entry.kind === "directory" ? (
              <FolderGlyph open={open} />
            ) : (
              <FileGlyph path={entry.relativePath} />
            )}
            <span className="min-w-0 truncate">{entry.name}</span>
          </button>
        </div>
      ) : row.status === "Loading" ? (
        <TreeSkeleton rows={1} depth={row.depth} />
      ) : (
        <StatusLine depth={row.depth} destructive={row.error === true}>
          {row.status}
        </StatusLine>
      )}
    </li>
  );
});

function FileTree({
  directory,
  transport,
  scroller,
  isActive,
  onOpenFile,
}: {
  directory: DirectoryLocation;
  transport: FilesTransport;
  scroller: RefObject<HTMLDivElement | null>;
  isActive: boolean;
  onOpenFile: (path: string) => void;
}) {
  const sessionKey = `${directory.hostId}\u0000${directory.rootPath}`;
  const [initialSession] = useState(() => treeSessions.get(sessionKey));
  const [directories, setDirectories] = useState(
    () => initialSession?.directories ?? new Map<string, TreeDirectory>(),
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => initialSession?.expanded ?? new Set([""]),
  );
  const [epoch, setEpoch] = useState(() => Date.now());
  const pending = useRef(new Set<string>());
  const autoOpened = useRef(initialSession !== undefined);
  const list = useRef<HTMLUListElement>(null);
  const controller = useRef(new AbortController());
  const session = useRef({ directories, expanded });
  session.current = { directories, expanded };
  const onOpenFileRef = useRef(onOpenFile);
  onOpenFileRef.current = onOpenFile;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el !== null && initialSession !== undefined) {
      el.scrollTop = initialSession.scrollTop;
    }
    return () => {
      rememberTreeSession(sessionKey, {
        ...session.current,
        scrollTop: el?.scrollTop ?? 0,
      });
    };
  }, [initialSession, scroller, sessionKey]);

  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, []);

  useEffect(() => {
    if (!isActive) return;
    setEpoch(Date.now());
    const timer = window.setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        (list.current?.getClientRects().length ?? 0) > 0
      ) {
        setEpoch(Date.now());
      }
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [isActive]);

  const rows = useMemo(
    () => treeRows(directories, expanded),
    [directories, expanded],
  );

  useEffect(() => {
    const paths = expandedDirectoryPaths(rows, expanded);
    const signal = controller.current.signal;
    for (const path of paths) {
      if (pending.current.size >= MAX_LISTINGS_IN_FLIGHT) break;
      const cached = directories.get(path);
      if (
        pending.current.has(path) ||
        (cached !== undefined && cached.checkedAt >= epoch)
      ) {
        continue;
      }
      pending.current.add(path);
      void transport
        .listDirectory(directory, path, signal)
        .then((entries) => {
          pending.current.delete(path);
          if (signal.aborted) return;
          setDirectories((current) => {
            const previous = current.get(path);
            const next = new Map(current);
            next.delete(path);
            next.set(path, {
              entries:
                previous !== undefined && sameEntries(previous.entries, entries)
                  ? previous.entries
                  : entries,
              checkedAt: Date.now(),
            });
            pruneDirectories(next, new Set(paths));
            return next;
          });
          if (path === "" && !autoOpened.current) {
            autoOpened.current = true;
            const folder = defaultFolderToOpen(entries);
            if (folder !== null) {
              setExpanded((current) =>
                current.has(folder) ? current : new Set([...current, folder]),
              );
            }
          }
        })
        .catch((error: unknown) => {
          pending.current.delete(path);
          if (signal.aborted) return;
          setDirectories((current) =>
            new Map(current).set(path, {
              entries: current.get(path)?.entries ?? [],
              checkedAt: Date.now(),
              error: errorText(error),
            }),
          );
        });
    }
  }, [directories, directory, epoch, expanded, rows, transport]);

  useEffect(() => {
    setDirectories((current) => {
      const next = new Map(current);
      pruneDirectories(
        next,
        new Set(expandedDirectoryPaths(treeRows(current, expanded), expanded)),
      );
      return next.size === current.size ? current : next;
    });
  }, [expanded]);

  const rowHeight = useMediaQuery(COARSE_QUERY)
    ? COARSE_ROW_HEIGHT
    : ROW_HEIGHT;
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  const [focused, setFocused] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    const update = () =>
      setViewport((previous) =>
        previous.top === el.scrollTop && previous.height === el.clientHeight
          ? previous
          : { top: el.scrollTop, height: el.clientHeight },
      );
    update();
    el.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      resize.disconnect();
    };
  }, [scroller]);

  const range = visibleRange(
    rows.length,
    viewport.top,
    viewport.height,
    rowHeight,
  );
  const indices: number[] = [];
  for (let index = range.start; index < range.end; index++) indices.push(index);
  const focusedIndex =
    focused === null ? -1 : rows.findIndex((row) => row.key === focused);
  if (focusedIndex >= 0 && !indices.includes(focusedIndex)) {
    indices.push(focusedIndex);
    indices.sort((a, b) => a - b);
  }

  const onRowClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const { path, kind } = event.currentTarget.dataset;
    if (path === undefined) return;
    if (kind !== "directory") {
      onOpenFileRef.current(path);
      return;
    }
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if (!(event.target instanceof HTMLElement)) return;
    const index = Number(
      event.target.closest("[data-row-index]")?.getAttribute("data-row-index"),
    );
    let next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? rows.length - 1
          : index + (event.key === "ArrowDown" ? 1 : -1);
    const direction = event.key === "ArrowUp" || event.key === "End" ? -1 : 1;
    while (next >= 0 && next < rows.length && rows[next]?.entry === undefined) {
      next += direction;
    }
    const row = rows[next];
    if (row === undefined) return;
    event.preventDefault();
    setFocused(row.key);
    scroller.current?.scrollTo({
      top: Math.max(0, next * rowHeight - viewport.height / 2),
    });
    requestAnimationFrame(() =>
      list.current
        ?.querySelector<HTMLElement>(`[data-row-index="${next}"] button`)
        ?.focus({ preventScroll: true }),
    );
  };

  return (
    <ul
      ref={list}
      data-files-tree=""
      className="relative m-0 list-none p-0"
      style={{ height: rows.length * rowHeight }}
      onFocus={(event) => {
        const key =
          event.target instanceof HTMLElement
            ? event.target.closest<HTMLElement>("[data-row-key]")?.dataset
                .rowKey
            : undefined;
        if (key !== undefined) setFocused(key);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(null);
      }}
      onKeyDown={onKeyDown}
    >
      {indices.map((index) => {
        const row = rows[index];
        if (row === undefined) return null;
        return (
          <TreeRowItem
            key={row.key}
            row={row}
            index={index}
            rowHeight={rowHeight}
            open={expanded.has(row.key)}
            onClick={onRowClick}
          />
        );
      })}
    </ul>
  );
}

function SearchHits({
  entries,
  onOpenFile,
}: {
  entries: readonly FileEntry[];
  onOpenFile: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  if (entries.length === 0) {
    return <StatusLine>{FILES_COPY.noMatches}</StatusLine>;
  }
  return (
    <ul className="m-0 list-none p-0">
      {entries.map((entry) => (
        <li key={entry.relativePath} className="min-w-0">
          <button
            type="button"
            className={ITEM}
            title={entry.relativePath}
            data-path={entry.relativePath}
            onClick={onOpenFile}
          >
            <FileGlyph path={entry.relativePath} />
            <span className="min-w-0 truncate">{entry.relativePath}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function useFileSearch(
  directory: DirectoryLocation | null,
  query: string,
  transport: FilesTransport,
) {
  const [result, setResult] = useState<{
    key: string;
    entries: readonly FileEntry[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const key =
    directory === null
      ? null
      : `${directory.hostId}\u0000${directory.rootPath}\u0000${query}`;

  useEffect(() => {
    if (directory === null || query === "") {
      setResult(null);
      setSearching(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      setError(null);
      void transport
        .search(directory, query, controller.signal)
        .then((entries) => {
          if (controller.signal.aborted) return;
          setResult({
            key: `${directory.hostId}\u0000${directory.rootPath}\u0000${query}`,
            entries,
          });
          setSearching(false);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setSearching(false);
          setError(errorText(cause));
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [directory, query, transport]);

  return {
    hits: result !== null && result.key === key ? result.entries : null,
    error,
    searching,
  };
}

export function FilesPanel({
  environmentId,
  isActive,
  onOpenFile,
}: {
  environmentId: string | null;
  isActive: boolean;
  onOpenFile: (path: string) => void;
}) {
  const transport = useFilesTransport();
  const environment = useEnvironment(environmentId, {
    enabled: environmentId !== null,
  });
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const edges = useOverflowEdges(scroller, content);
  const [filter, setFilter] = useState("");
  const query = filter.trim();
  const hostId = environment.data?.hostId ?? null;
  const rootPath = environment.data?.path ?? null;
  const directory = useMemo<DirectoryLocation | null>(
    () => (hostId === null || rootPath === null ? null : { hostId, rootPath }),
    [hostId, rootPath],
  );
  const search = useFileSearch(directory, query, transport);
  const filtering = query !== "";
  const onOpenFileRef = useRef(onOpenFile);
  onOpenFileRef.current = onOpenFile;
  const onHitClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const path = event.currentTarget.dataset.path;
    if (path !== undefined) onOpenFileRef.current(path);
  }, []);

  let tree: ReactNode;
  if (environmentId === null) {
    tree = <StatusLine>{FILES_COPY.noEnvironment}</StatusLine>;
  } else if (environment.data === undefined && environment.error !== null) {
    tree = <StatusLine destructive>{environment.error.message}</StatusLine>;
  } else if (environment.data !== undefined && rootPath === null) {
    tree = <StatusLine>{FILES_COPY.noEnvironment}</StatusLine>;
  } else if (directory === null) {
    tree = <TreeSkeleton rows={8} />;
  } else {
    tree = (
      <>
        <div hidden={filtering}>
          <FileTree
            key={`${directory.hostId}\u0000${directory.rootPath}`}
            directory={directory}
            transport={transport}
            scroller={scroller}
            isActive={isActive}
            onOpenFile={onOpenFile}
          />
        </div>
        {filtering ? (
          search.error !== null ? (
            <StatusLine destructive>{search.error}</StatusLine>
          ) : search.hits === null ? (
            <TreeSkeleton rows={6} />
          ) : (
            <SearchHits entries={search.hits} onOpenFile={onHitClick} />
          )
        ) : null}
      </>
    );
  }

  return (
    <div
      data-files-panel=""
      className="flex h-full min-h-0 flex-col gap-1.5 px-4 pt-0.5 pb-1.5"
    >
      <div className="relative min-w-0 shrink-0">
        <Icon
          name="Search"
          className={cn(
            "pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground",
            COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
          )}
          aria-hidden
        />
        <Input
          type="search"
          maxLength={200}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && filter !== "") {
              event.stopPropagation();
              setFilter("");
            }
          }}
          placeholder={FILES_COPY.searchPlaceholder}
          aria-label={FILES_COPY.searchPlaceholder}
          spellCheck={false}
          className="h-8 pl-8 pr-8 text-sm focus-visible:ring-0 max-md:pointer-coarse:h-10 [&::-webkit-search-cancel-button]:hidden"
        />
        {search.searching ? (
          <Icon
            name="Spinner"
            className={cn(
              "pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground",
              COARSE_POINTER_ICON_SIZE_CLASS,
            )}
            aria-hidden
          />
        ) : filter !== "" ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={FILES_COPY.clearSearch}
            className={cn(
              COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
              "absolute right-0.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setFilter("")}
          >
            <Icon name="X" aria-hidden />
          </Button>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div ref={scroller} className="h-full overflow-auto">
          <div ref={content}>{tree}</div>
        </div>
        <ScrollEdgeFades
          above={edges.above}
          below={edges.below}
          color="var(--background)"
        />
      </div>
    </div>
  );
}
