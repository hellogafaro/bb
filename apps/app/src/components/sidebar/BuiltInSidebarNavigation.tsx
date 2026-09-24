import type { ComponentProps } from "react";
import {
  type BuiltInSidebarNavEntry,
  ResourceNavSidebarItem,
  PluginNavSidebarItems,
} from "@/components/plugin/PluginNavSidebarItems";
import {
  ProjectListNewThreadAction,
  ProjectListSearchThreadsAction,
} from "./SidebarPrimaryActions";
import { DEFAULT_BUILT_IN_SIDEBAR_NAVIGATION_ORDER } from "@/components/plugin/pluginNavSidebarOrder";
import { getSkillsRoutePath } from "@/lib/route-paths";

export type BuiltInSidebarNavigationProps = ComponentProps<
  typeof ProjectListNewThreadAction
> &
  ComponentProps<typeof ProjectListSearchThreadsAction> &
  Pick<
    ComponentProps<typeof PluginNavSidebarItems>,
    "onNavigate" | "splitEnabled"
  >;

export function BuiltInSidebarNavigation({
  newThreadSplit,
  onNavigate,
  onNewChat,
  onSearchThreads,
  splitEnabled,
}: BuiltInSidebarNavigationProps) {
  const skillsRoutePath = getSkillsRoutePath();
  const builtInEntries: BuiltInSidebarNavEntry[] = [
    {
      kind: "built-in",
      pluginId: "__bb__",
      id: "new-thread",
      content: (
        <ProjectListNewThreadAction
          splitEnabled={splitEnabled}
          newThreadSplit={newThreadSplit}
          onNewChat={onNewChat}
        />
      ),
    },
    {
      kind: "built-in",
      pluginId: "__bb__",
      id: "search-threads",
      content: (
        <ProjectListSearchThreadsAction onSearchThreads={onSearchThreads} />
      ),
    },
    {
      kind: "built-in",
      pluginId: "__bb__",
      id: "skills",
      content: (
        <ResourceNavSidebarItem
          icon="SlidersHorizontal"
          title="Customize"
          routePath={skillsRoutePath}
          onNavigate={onNavigate}
        />
      ),
    },
  ];

  return (
    <div
      className="contents"
      data-testid="built-in-sidebar-navigation"
      data-sidebar-navigation-unified="true"
    >
      <div className="contents" data-testid="app-sidebar-primary-actions">
        <PluginNavSidebarItems
          builtInEntries={builtInEntries}
          leadingOrderKeys={DEFAULT_BUILT_IN_SIDEBAR_NAVIGATION_ORDER}
          onNavigate={onNavigate}
          splitEnabled={splitEnabled}
        />
      </div>
    </div>
  );
}
