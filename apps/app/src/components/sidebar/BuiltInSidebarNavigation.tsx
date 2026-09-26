import type { ComponentProps } from "react";
import {
  type BuiltInSidebarNavEntry,
  ResourceNavSidebarItem,
  PluginNavSidebarItems,
} from "@/components/plugin/PluginNavSidebarItems";
import {
  ProjectListNewThreadAction,
  ProjectListSearchAction,
} from "./SidebarPrimaryActions";
import { DEFAULT_BUILT_IN_SIDEBAR_NAVIGATION_ORDER } from "@/components/plugin/pluginNavSidebarOrder";
import { getThreadsRoutePath } from "@/lib/route-paths";

export type BuiltInSidebarNavigationProps = ComponentProps<
  typeof ProjectListNewThreadAction
> &
  ComponentProps<typeof ProjectListSearchAction> &
  Pick<
    ComponentProps<typeof PluginNavSidebarItems>,
    "onNavigate" | "splitEnabled"
  >;

export function BuiltInSidebarNavigation({
  newThreadSplit,
  onNavigate,
  onNewChat,
  onSearch,
  splitEnabled,
}: BuiltInSidebarNavigationProps) {
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
      content: <ProjectListSearchAction onSearch={onSearch} />,
    },
    {
      kind: "built-in",
      pluginId: "__bb__",
      id: "threads",
      content: (
        <ResourceNavSidebarItem
          icon="ListUnordered"
          title="Threads"
          routePath={getThreadsRoutePath()}
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
