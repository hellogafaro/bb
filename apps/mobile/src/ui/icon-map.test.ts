import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ICON_NAMES, isIconName } from "./icon-names";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHARED_UI_DIR = join(
  HERE,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "shared-ui",
  "src",
  "components",
  "ui",
);
const SHARED_UI_CORE_ICON_PATH = join(SHARED_UI_DIR, "icon.tsx");
const SHARED_UI_EXTENDED_ICON_PATH = join(SHARED_UI_DIR, "icon-extended.tsx");
const MOBILE_ICON_MAP_PATH = join(HERE, "icon-map.ts");
const WEB_GLYPH = /^Pi([A-Za-z0-9]+)Bold$/;
const MOBILE_GLYPH = /^([A-Za-z0-9]+)Icon$/;

function iconMapEntries(
  source: string,
  { start: startMarker, end: endMarker }: { start: string; end: string },
  glyphPattern: RegExp,
): Map<string, string> {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error(`${startMarker} literal not found`);
  }
  const body = source.slice(start, end);
  return new Map(
    Array.from(
      body.matchAll(/^\s+([A-Za-z0-9]+):\s*([A-Za-z0-9]+),/gm),
      (m) => [m[1], m[2].match(glyphPattern)?.[1] ?? m[2]],
    ),
  );
}

function webIconMapEntries(): Map<string, string> {
  const core = iconMapEntries(
    readFileSync(SHARED_UI_CORE_ICON_PATH, "utf8"),
    {
      start: "const CORE_ICON_MAP = {",
      end: "} as const satisfies",
    },
    WEB_GLYPH,
  );
  const extended = iconMapEntries(
    readFileSync(SHARED_UI_EXTENDED_ICON_PATH, "utf8"),
    {
      start: "export const EXTENDED_ICON_MAP: ExtendedIconMap = {",
      end: "\n};",
    },
    WEB_GLYPH,
  );
  for (const [name, glyph] of extended) {
    if (core.has(name)) throw new Error(`icon ${name} in both web maps`);
    core.set(name, glyph);
  }
  return core;
}

describe("ICON_MAP", () => {
  it("binds every name to the same glyph as @bb/shared-ui", () => {
    const web = webIconMapEntries();
    const mobile = iconMapEntries(
      readFileSync(MOBILE_ICON_MAP_PATH, "utf8"),
      {
        start: "const ICON_MAP = {",
        end: "} as const satisfies",
      },
      MOBILE_GLYPH,
    );
    expect(web.size).toBeGreaterThan(100);
    expect([...mobile.keys()]).toEqual([...ICON_NAMES]);
    for (const [name, glyph] of mobile) {
      expect(web.get(name), name).toBe(glyph);
    }
  });

  it("isIconName narrows strings without walking the prototype", () => {
    expect(isIconName("Plus")).toBe(true);
    expect(isIconName("toString")).toBe(false);
    expect(isIconName("")).toBe(false);
    expect(isIconName(42)).toBe(false);
  });
});
