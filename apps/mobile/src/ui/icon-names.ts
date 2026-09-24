export const ICON_NAMES = [
  "AlertTriangle",
  "ArrowRight",
  "ArrowReloadHorizontal",
  "Check",
  "ChevronRight",
  "CircleCheck",
  "CircleX",
  "Cloud",
  "Eye",
  "Globe",
  "GridView",
  "Info",
  "Laptop",
  "Loading",
  "Lock",
  "Palette",
  "Plus",
  "RotateCcw",
  "Settings",
  "Smartphone",
  "Trash2",
  "Zap",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const ICON_NAME_SET: ReadonlySet<string> = new Set(ICON_NAMES);

export function isIconName(value: unknown): value is IconName {
  return typeof value === "string" && ICON_NAME_SET.has(value);
}
