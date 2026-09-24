import type { PluginCodeThemeData } from "@get-bb/plugin-sdk";

export function workbench(
  colors: Readonly<Record<string, string>>,
  key: string,
  fallback: string,
): string {
  return colors[key] ?? fallback;
}

export function editorSurface(theme: PluginCodeThemeData): string {
  return workbench(theme.colors, "editor.background", theme.bg);
}

export function editorSelectionPaint(theme: PluginCodeThemeData | null): {
  background: string;
  color: string;
} {
  if (theme === null) {
    return {
      background: "color-mix(in oklab, var(--primary) 40%, transparent)",
      color: "var(--primary)",
    };
  }
  const cursor = workbench(theme.colors, "editorCursor.foreground", theme.fg);
  return {
    background: `color-mix(in oklab, ${cursor} 40%, transparent)`,
    color: workbench(theme.colors, "editor.selectionForeground", cursor),
  };
}
