import type { IconName } from "@bb/shared-ui/icon";
import { isForkHiddenSettingsSection } from "@/lib/fork-settings";
import { SETTINGS_ROUTE_PATH, getSettingsRoutePath } from "@/lib/route-paths";

export const SETTINGS_NAV_SECTIONS = [
  { icon: "Settings", id: "general", label: "General" },
  { icon: "Bot", id: "providers", label: "Providers" },
  { icon: "Palette", id: "appearance", label: "Appearance" },
  { icon: "SlidersHorizontal", id: "keyboard", label: "Keyboard" },
  { icon: "Browser", id: "browser", label: "Browser" },
  { icon: "File", id: "files", label: "Files" },
  { icon: "FolderGit", id: "projects", label: "Projects" },
  { icon: "Laptop", id: "machines", label: "Machines" },
  {
    icon: "Lock",
    id: "environment-variables",
    label: "Environment variables",
  },
  { icon: "PackageReceive", id: "updates", label: "Updates" },
  { icon: "ElectricPlugs", id: "plugins", label: "Installed plugins" },
  { icon: "Puzzle", id: "marketplaces", label: "Plugin marketplaces" },
  { icon: "Beaker", id: "experiments", label: "Experiments" },
  { icon: "MessageSquare", id: "community", label: "Community" },
] as const satisfies readonly {
  icon: IconName;
  id: string;
  label: string;
}[];

export const CUSTOMIZE_NAV_SECTIONS = [
  { icon: "Zap", id: "skills", label: "Skills" },
  { icon: "Connector", id: "mcps", label: "MCPs" },
  { icon: "Robot", id: "agents", label: "Agents" },
] as const satisfies readonly {
  icon: IconName;
  id: string;
  label: string;
}[];

export type SettingsNavSection =
  | (typeof SETTINGS_NAV_SECTIONS)[number]
  | (typeof CUSTOMIZE_NAV_SECTIONS)[number];

export type SettingsSectionId = SettingsNavSection["id"];

export type CustomizeSectionId = (typeof CUSTOMIZE_NAV_SECTIONS)[number]["id"];

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return (
    (SETTINGS_NAV_SECTIONS.some((section) => section.id === value) ||
      CUSTOMIZE_NAV_SECTIONS.some((section) => section.id === value)) &&
    !isForkHiddenSettingsSection(value)
  );
}

export function getSettingsSectionRoutePath(
  sectionId: SettingsSectionId,
): string {
  return sectionId === "general"
    ? SETTINGS_ROUTE_PATH
    : getSettingsRoutePath(sectionId);
}
