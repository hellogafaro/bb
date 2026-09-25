import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_SOURCE_ROOT = path.resolve(import.meta.dirname, "../../..");
const FORBIDDEN_REFERENCES = [
  "plugins/thread-list",
  "thread-list/thread-list",
  'pluginId === "thread-list"',
  "bb-plugin-thread-list",
];

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = path.join(directory, entry);
    if (statSync(fullPath).isDirectory()) return listSourceFiles(fullPath);
    return /\.(?:css|ts|tsx)$/u.test(entry) && !/\.test\.tsx?$/u.test(entry)
      ? [fullPath]
      : [];
  });
}

describe("built-in thread list", () => {
  it("does not reference the removed thread-list plugin from app source", () => {
    const files = listSourceFiles(APP_SOURCE_ROOT);
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return FORBIDDEN_REFERENCES.filter((reference) =>
        source.includes(reference),
      ).map(
        (reference) => `${path.relative(APP_SOURCE_ROOT, file)}: ${reference}`,
      );
    });
    expect(offenders).toEqual([]);
  });
});
