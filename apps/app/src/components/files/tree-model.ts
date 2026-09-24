import type { FileEntry } from "./file-paths";

export interface TreeDirectory {
  entries: readonly FileEntry[];
  checkedAt: number;
  error?: string;
}

export interface TreeRow {
  key: string;
  depth: number;
  entry?: FileEntry;
  status?: "Loading" | "Empty" | string;
  error?: boolean;
}

const ROOT_SKELETON_ROWS = 8;
const BRANCH_SKELETON_ROWS = 4;
const OVERSCAN_ROWS = 8;
const MAX_CACHED_DIRECTORIES = 128;
const MAX_CACHED_ENTRIES = 50_000;

export function treeRows(
  directories: ReadonlyMap<string, TreeDirectory>,
  expanded: ReadonlySet<string>,
): TreeRow[] {
  const rows: TreeRow[] = [];
  const stack: Array<
    { path: string; depth: number } | { entry: FileEntry; depth: number }
  > = [{ path: "", depth: 0 }];
  while (stack.length > 0) {
    const item = stack.pop();
    if (item === undefined) break;
    if ("entry" in item) {
      rows.push({
        key: item.entry.relativePath,
        depth: item.depth,
        entry: item.entry,
      });
      if (
        item.entry.kind === "directory" &&
        expanded.has(item.entry.relativePath)
      ) {
        stack.push({ path: item.entry.relativePath, depth: item.depth + 1 });
      }
      continue;
    }
    const directory = directories.get(item.path);
    if (directory === undefined) {
      const count =
        item.depth === 0 ? ROOT_SKELETON_ROWS : BRANCH_SKELETON_ROWS;
      for (let index = 0; index < count; index++) {
        rows.push({
          key: `${item.path}//loading/${index}/`,
          depth: item.depth,
          status: "Loading",
        });
      }
      continue;
    }
    if (directory.entries.length === 0 || directory.error !== undefined) {
      rows.push({
        key: `${item.path}/`,
        depth: item.depth,
        status: directory.error ?? "Empty",
        error: directory.error !== undefined,
      });
    }
    for (let index = directory.entries.length - 1; index >= 0; index--) {
      const entry = directory.entries[index];
      if (entry !== undefined) stack.push({ entry, depth: item.depth });
    }
  }
  return rows;
}

export function expandedDirectoryPaths(
  rows: readonly TreeRow[],
  expanded: ReadonlySet<string>,
): string[] {
  return [
    "",
    ...rows.flatMap((row) =>
      row.entry?.kind === "directory" && expanded.has(row.key) ? [row.key] : [],
    ),
  ];
}

export function visibleRange(
  count: number,
  top: number,
  height: number,
  rowHeight: number,
): { start: number; end: number } {
  const start = Math.max(
    0,
    Math.min(count, Math.floor(top / rowHeight) - OVERSCAN_ROWS),
  );
  const end = Math.min(
    count,
    Math.max(start, Math.ceil((top + height) / rowHeight) + OVERSCAN_ROWS),
  );
  return { start, end };
}

export function pruneDirectories(
  directories: Map<string, TreeDirectory>,
  active: ReadonlySet<string>,
): void {
  let count = 0;
  for (const directory of directories.values()) {
    count += directory.entries.length;
  }
  for (const [path, directory] of directories) {
    if (
      directories.size <= MAX_CACHED_DIRECTORIES &&
      count <= MAX_CACHED_ENTRIES
    ) {
      break;
    }
    if (path === "" || active.has(path)) continue;
    directories.delete(path);
    count -= directory.entries.length;
  }
}

export function sameEntries(
  left: readonly FileEntry[],
  right: readonly FileEntry[],
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        other.relativePath === entry.relativePath &&
        other.kind === entry.kind &&
        other.name === entry.name
      );
    })
  );
}
