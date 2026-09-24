import { describe, expect, it } from "vitest";
import type { FileEntry } from "./file-paths";
import {
  pruneDirectories,
  sameEntries,
  treeRows,
  visibleRange,
  type TreeDirectory,
} from "./tree-model";

describe("tree model", () => {
  it("windows a 10k file directory to the viewport plus overscan", () => {
    const entries: FileEntry[] = Array.from({ length: 10_000 }, (_, i) => ({
      name: `file-${i}`,
      relativePath: `file-${i}`,
      kind: "file",
    }));
    const rows = treeRows(
      new Map([["", { entries, checkedAt: 0 }]]),
      new Set([""]),
    );
    expect(rows).toHaveLength(10_000);
    const range = visibleRange(rows.length, 140_000, 700, 28);
    expect(range.end - range.start).toBe(41);
    expect(rows[range.start]?.key).toBe("file-4992");
  });

  it("flattens expanded branches and exposes loading, empty and errors", () => {
    const dirs = new Map<string, TreeDirectory>([
      [
        "",
        {
          entries: [{ name: "a", relativePath: "a", kind: "directory" }],
          checkedAt: 0,
        },
      ],
    ]);
    expect(treeRows(dirs, new Set())).toHaveLength(1);
    expect(treeRows(dirs, new Set(["a"]))[1]?.status).toBe("Loading");
    dirs.set("a", { entries: [], checkedAt: 0 });
    expect(treeRows(dirs, new Set(["a"]))[1]?.status).toBe("Empty");
    dirs.set("a", { entries: [], checkedAt: 0, error: "EACCES" });
    expect(treeRows(dirs, new Set(["a"]))[1]).toMatchObject({
      status: "EACCES",
      error: true,
    });
  });

  it("evicts collapsed directories while keeping the active set", () => {
    const dirs = new Map<string, TreeDirectory>(
      Array.from({ length: 200 }, (_, i) => [
        `d${i}`,
        { entries: [], checkedAt: 0 },
      ]),
    );
    pruneDirectories(dirs, new Set(["d0"]));
    expect(dirs.size).toBe(128);
    expect(dirs.has("d0")).toBe(true);
  });

  it("compares listings by identity fields", () => {
    const a: FileEntry[] = [{ name: "x", relativePath: "x", kind: "file" }];
    expect(sameEntries(a, [{ ...a[0]! }])).toBe(true);
    expect(sameEntries(a, [{ ...a[0]!, kind: "directory" }])).toBe(false);
    expect(sameEntries(a, [])).toBe(false);
  });
});
