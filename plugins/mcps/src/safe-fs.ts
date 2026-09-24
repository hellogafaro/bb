import * as fsp from "node:fs/promises";
import * as path from "node:path";

export function isWithinRoot(resolvedPath: string, root: string): boolean {
  const rel = path.relative(root, resolvedPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export async function ensureDir(p: string): Promise<void> {
  await fsp.mkdir(p, { recursive: true });
}

export async function rimraf(p: string): Promise<void> {
  await fsp.rm(p, { recursive: true, force: true });
}
