import { useMemo } from "react";
import { matchPath, useLocation } from "react-router-dom";
import { useHostDaemon, useLocalHostDaemonAccess } from "@/hooks/useHostDaemon";
import { usePluginSlots, type PluginFileOpenerSlot } from "@/lib/plugin-slots";
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
import { isForkHiddenSettingsSection } from "@/lib/fork-settings";
import {
  AGENT_DETAIL_ROUTE_PATH,
  MCP_DETAIL_ROUTE_PATH,
  SETTINGS_MACHINE_ROUTE_PATH,
  SETTINGS_PLUGIN_ROUTE_PATH,
  SETTINGS_PROJECT_ROUTE_PATH,
  SETTINGS_SECTION_ROUTE_PATH,
  SETTINGS_SKILL_DETAIL_ROUTE_PATH,
} from "@/lib/route-paths";
import {
  CUSTOMIZE_NAV_SECTIONS,
  isSettingsSectionId,
  SETTINGS_NAV_SECTIONS,
  type CustomizeSectionId,
  type SettingsNavSection,
  type SettingsSectionId,
} from "./settings-sections";
import {
  buildPluginSettingsEntries,
  type PluginSettingsEntry,
} from "./plugin-settings-entries";

export interface SettingsNavState {
  activeSection: SettingsSectionId | null;
  hasUnknownSection: boolean;
  activePluginId: string | null;
  pluginEntries: readonly PluginSettingsEntry[];
  sections: readonly SettingsNavSection[];
  customizeSections: readonly SettingsNavSection[];
}

const CUSTOMIZE_DETAIL_ROUTES: readonly [string, CustomizeSectionId][] = [
  [SETTINGS_SKILL_DETAIL_ROUTE_PATH, "skills"],
  [MCP_DETAIL_ROUTE_PATH, "mcps"],
  [AGENT_DETAIL_ROUTE_PATH, "agents"],
];

function resolveCustomizeDetailSection(
  pathname: string,
): CustomizeSectionId | null {
  for (const [pattern, section] of CUSTOMIZE_DETAIL_ROUTES) {
    if (matchPath(pattern, pathname) !== null) return section;
  }
  return null;
}

export function useSettingsNavSections(
  fileOpeners: readonly PluginFileOpenerSlot[],
): readonly SettingsNavSection[] {
  const { hasDaemon } = useHostDaemon();
  const { accessState } = useLocalHostDaemonAccess();

  return useMemo(
    () =>
      SETTINGS_NAV_SECTIONS.filter(
        (section) =>
          !isForkHiddenSettingsSection(section.id) &&
          (section.id !== "files" ||
            hasDaemon ||
            accessState !== "unavailable" ||
            fileOpeners.length > 0),
      ),
    [accessState, fileOpeners.length, hasDaemon],
  );
}

export function useSettingsNavState(): SettingsNavState {
  const location = useLocation();
  const { fileOpeners, settingsSections } = usePluginSlots();
  const sections = useSettingsNavSections(fileOpeners);
  const pluginListQuery = usePluginList({ enabled: true });

  const sectionMatch = matchPath(
    SETTINGS_SECTION_ROUTE_PATH,
    location.pathname,
  );
  const pluginMatch = matchPath(SETTINGS_PLUGIN_ROUTE_PATH, location.pathname);
  const isInstalledDetail =
    new URLSearchParams(location.search).get("view") === "installed";
  const activePluginId = isInstalledDetail
    ? null
    : (pluginMatch?.params.pluginId ?? null);
  const machineMatch = matchPath(
    SETTINGS_MACHINE_ROUTE_PATH,
    location.pathname,
  );
  const activeMachineId = machineMatch?.params.hostId ?? null;
  const projectMatch = matchPath(
    SETTINGS_PROJECT_ROUTE_PATH,
    location.pathname,
  );
  const activeProjectId = projectMatch?.params.projectId ?? null;
  const sectionParam = sectionMatch?.params.section;
  const customizeDetailSection = resolveCustomizeDetailSection(
    location.pathname,
  );
  const hasUnknownSection =
    sectionParam !== undefined && !isSettingsSectionId(sectionParam);
  const activeSection: SettingsSectionId | null =
    isInstalledDetail && pluginMatch !== null
      ? "plugins"
      : activeMachineId !== null
        ? "machines"
        : activeProjectId !== null
          ? "projects"
          : customizeDetailSection !== null
            ? customizeDetailSection
            : activePluginId !== null
              ? null
              : sectionParam !== undefined && isSettingsSectionId(sectionParam)
                ? sectionParam
                : "general";

  const installedPlugins = pluginListQuery.data?.plugins ?? [];
  const pluginEntries = buildPluginSettingsEntries({
    installedPlugins,
    settingsSections,
  });

  return {
    activePluginId,
    activeSection,
    hasUnknownSection,
    pluginEntries,
    sections,
    customizeSections: CUSTOMIZE_NAV_SECTIONS,
  };
}
