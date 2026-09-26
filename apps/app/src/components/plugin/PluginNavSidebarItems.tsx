import {
  useCallback,
  useMemo,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import {
  AUTOMATIONS_PLUGIN_ID,
  getPluginPanelRoutePath,
} from "@/lib/route-paths";
import {
  usePluginNavPanelChrome,
  type PluginNavPanelChrome,
} from "@/lib/plugin-nav-panel-chrome";
import { cn } from "@bb/shared-ui/lib/utils";
import type { PluginNavPanelSlot } from "@/lib/plugin-slots";
import { usePaneContentSplitDrag } from "@/components/sidebar/usePaneContentSplitDrag";
import { usePaneContentSplitIndicator } from "@/components/sidebar/paneContentSplitIndicator";
import { SplitPaneMiniMap } from "@/components/sidebar/SplitPaneMiniMap";
import { PROJECT_LIST_ACTION_BUTTON_CLASS } from "@/components/sidebar/sidebarRowClasses";
import { useSidebarSortable } from "@/components/sidebar/sortableMotion";
import { useSidebarReorderDnd } from "@/components/sidebar/useSidebarReorderDnd";
import type { SidebarSortableDragBindings } from "@/components/sidebar/sortableMotion";
import {
  pluginNavPanelOrderAtom,
  pluginNavVisiblePanelKeysAtom,
} from "./pluginNavSidebarAtoms";
import {
  arrangePluginNavPanelPreferences,
  DEFAULT_HIDDEN_SIDEBAR_NAVIGATION_KEYS,
  getPluginNavPanelKey,
  placeBuiltInNavigationKeys,
  seedSkillsNavigationPreference,
} from "./pluginNavSidebarOrder";
import { haveSameOrder, reorderStoredOrder } from "@/lib/stored-order";

type PluginSidebarNavRow = {
  kind: "plugin";
  pluginId: string;
  id: string;
  chrome: PluginNavPanelChrome;
  panel: PluginNavPanelSlot | null;
};

export interface BuiltInSidebarNavEntry {
  kind: "built-in";
  pluginId: "__bb__";
  id: string;
  content: ReactNode;
}

type SidebarNavRow = PluginSidebarNavRow | BuiltInSidebarNavEntry;

function isPluginSidebarNavRow(row: SidebarNavRow): row is PluginSidebarNavRow {
  return row.kind === "plugin";
}

export function PluginNavSidebarItems(props: {
  builtInEntries?: readonly BuiltInSidebarNavEntry[];
  leadingOrderKeys?: readonly string[];
  onNavigate?: () => void;
  splitEnabled?: boolean;
}) {
  const entries = usePluginNavPanelChrome();
  const rows = useMemo<SidebarNavRow[]>(
    () => [
      ...(props.builtInEntries ?? []),
      ...entries.map(({ chrome, panel }) => ({
        kind: "plugin" as const,
        pluginId:
          chrome.pluginId === AUTOMATIONS_PLUGIN_ID
            ? "__bb__"
            : chrome.pluginId,
        id:
          chrome.pluginId === AUTOMATIONS_PLUGIN_ID ? "automations" : chrome.id,
        chrome,
        panel,
      })),
    ],
    [entries, props.builtInEntries],
  );
  const leadingOrderKeys = useMemo(
    () =>
      props.leadingOrderKeys ??
      (props.builtInEntries ?? []).map(getPluginNavPanelKey),
    [props.builtInEntries, props.leadingOrderKeys],
  );
  if (rows.length === 0) return null;
  return (
    <PluginNavSidebarItemList
      rows={rows}
      leadingOrderKeys={leadingOrderKeys}
      splitEnabled={props.splitEnabled ?? false}
      {...(props.onNavigate ? { onNavigate: props.onNavigate } : {})}
    />
  );
}

function PluginNavSidebarItemList({
  leadingOrderKeys,
  onNavigate,
  rows,
  splitEnabled = false,
}: {
  leadingOrderKeys: readonly string[];
  onNavigate?: () => void;
  rows: readonly SidebarNavRow[];
  splitEnabled?: boolean;
}) {
  const location = useLocation();
  const [storedOrder, setStoredOrder] = useAtom(pluginNavPanelOrderAtom);
  const [storedVisibleKeys, setStoredVisibleKeys] = useAtom(
    pluginNavVisiblePanelKeysAtom,
  );
  const seededPreferences = useMemo(
    () => seedSkillsNavigationPreference(storedOrder, storedVisibleKeys),
    [storedOrder, storedVisibleKeys],
  );
  const newLeadingKeys = useMemo(
    () =>
      leadingOrderKeys.filter((key) => !seededPreferences.order.includes(key)),
    [leadingOrderKeys, seededPreferences.order],
  );
  const newVisibleKeys = useMemo(
    () =>
      rows
        .map(getPluginNavPanelKey)
        .filter(
          (key) =>
            !seededPreferences.order.includes(key) &&
            !DEFAULT_HIDDEN_SIDEBAR_NAVIGATION_KEYS.some(
              (hiddenKey) => hiddenKey === key,
            ),
        ),
    [rows, seededPreferences.order],
  );
  const { normalizedOrder, normalizedVisibleKeys, visible, visibleKeys } =
    useMemo(
      () =>
        arrangePluginNavPanelPreferences({
          panels: rows,
          storedOrder: placeBuiltInNavigationKeys(
            newLeadingKeys.length === 0
              ? seededPreferences.order
              : [...newLeadingKeys, ...seededPreferences.order],
          ),
          storedVisibleKeys:
            seededPreferences.visibleKeys === null ||
            newVisibleKeys.length === 0
              ? seededPreferences.visibleKeys
              : placeBuiltInNavigationKeys([
                  ...newVisibleKeys,
                  ...seededPreferences.visibleKeys,
                ]),
          defaultHiddenKeys: DEFAULT_HIDDEN_SIDEBAR_NAVIGATION_KEYS,
        }),
      [newLeadingKeys, newVisibleKeys, rows, seededPreferences],
    );

  const persistPreferences = useCallback(
    (order: string[], nextVisibleKeys: string[] | null) => {
      if (!haveSameOrder(storedOrder, order)) setStoredOrder(order);
      if (
        storedVisibleKeys === nextVisibleKeys ||
        (storedVisibleKeys !== null &&
          nextVisibleKeys !== null &&
          haveSameOrder(storedVisibleKeys, nextVisibleKeys))
      ) {
        return;
      }
      setStoredVisibleKeys(nextVisibleKeys);
    },
    [setStoredOrder, setStoredVisibleKeys, storedOrder, storedVisibleKeys],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (
        !event.over ||
        typeof event.active.id !== "string" ||
        typeof event.over.id !== "string"
      ) {
        return;
      }
      const nextOrder = reorderStoredOrder({
        activeId: event.active.id,
        overId: event.over.id,
        order: normalizedOrder,
        visibleIds: visibleKeys,
      });
      if (nextOrder) persistPreferences(nextOrder, normalizedVisibleKeys);
    },
    [normalizedOrder, normalizedVisibleKeys, persistPreferences, visibleKeys],
  );
  const { dndContextProps, onClickCapture } = useSidebarReorderDnd({
    onDragEnd: handleDragEnd,
  });

  const reorderDisabled = visible.length < 2;

  return (
    <div
      className="relative shrink-0 space-y-0.5 px-2 py-2"
      data-testid="plugin-nav-sidebar-items"
      onClickCapture={onClickCapture}
    >
      <DndContext {...dndContextProps}>
        <SortableContext
          items={visibleKeys}
          strategy={verticalListSortingStrategy}
        >
          {visible.map((row) =>
            isPluginSidebarNavRow(row) ? (
              <SortableSidebarNavRow
                key={getPluginNavPanelKey(row)}
                row={row}
                reorderDisabled={reorderDisabled}
                pathname={location.pathname}
                splitEnabled={splitEnabled}
                {...(onNavigate ? { onNavigate } : {})}
              />
            ) : (
              <div
                key={getPluginNavPanelKey(row)}
                data-sidebar-navigation-item={getPluginNavPanelKey(row)}
              >
                {row.content}
              </div>
            ),
          )}
        </SortableContext>
      </DndContext>
    </div>
  );
}

const SortableSidebarNavRow = function SortableSidebarNavRow({
  row,
  reorderDisabled,
  ...props
}: SidebarNavRowItemProps & { reorderDisabled: boolean }) {
  const { dragBindings, setNodeRef, style } = useSidebarSortable({
    id: getPluginNavPanelKey(row),
    disabled: reorderDisabled,
  });
  return (
    <PluginNavSidebarItem
      {...props}
      row={row}
      dragBindings={dragBindings}
      rowRef={setNodeRef}
      rowStyle={style}
    />
  );
};

interface SidebarNavRowItemProps {
  row: PluginSidebarNavRow;
  pathname: string;
  onNavigate?: () => void;
  splitEnabled: boolean;
  dragBindings?: SidebarSortableDragBindings;
  rowRef?: (element: HTMLElement | null) => void;
  rowStyle?: CSSProperties;
}

export function ResourceNavSidebarItem({
  icon,
  title,
  routePath,
  onNavigate,
}: {
  icon: IconName;
  title: string;
  routePath: string;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const path = routePath.split("?")[0] ?? routePath;
  const isActive = pathname === path || pathname.startsWith(`${path}/`);
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className={cn(
        PROJECT_LIST_ACTION_BUTTON_CLASS,
        "w-full",
        isActive && "bg-sidebar-accent text-sidebar-foreground",
      )}
      aria-current={isActive ? "page" : undefined}
      onClick={() => {
        onNavigate?.();
        void navigate(routePath);
      }}
    >
      <Icon name={icon} aria-hidden="true" />
      <span className="min-w-0 truncate text-left">{title}</span>
    </Button>
  );
}

function PluginNavSidebarItem({
  row,
  pathname,
  onNavigate,
  splitEnabled,
  dragBindings,
  rowRef,
  rowStyle,
}: SidebarNavRowItemProps) {
  const { chrome, panel } = row;
  const navigate = useNavigate();
  const isCompactViewport = useIsCompactViewport();
  const path = getPluginPanelRoutePath({
    pluginId: chrome.pluginId,
    path: chrome.path,
  });
  const content = {
    kind: "plugin-panel",
    pluginId: chrome.pluginId,
    panelPath: chrome.path,
    subPath: "",
  } as const;
  const { onPointerDown, openInSplit } = usePaneContentSplitDrag({
    content,
    enabled: splitEnabled,
    label: chrome.title,
  });
  const splitIndicator = usePaneContentSplitIndicator(content, splitEnabled);
  const SidebarAccessory = panel?.experimental_sidebarAccessory;
  const accessory =
    panel !== null && !isCompactViewport && SidebarAccessory !== undefined ? (
      <PluginSlotMount
        key={`${panel.pluginId}/${panel.id}/${panel.generation}`}
        pluginId={panel.pluginId}
        slotKind="navPanelSidebarAccessory"
        slotId={panel.id}
        crashFallback={<></>}
      >
        <SidebarAccessory />
      </PluginSlotMount>
    ) : null;
  const loading = panel === null;
  const isActive = pathname === path || pathname.startsWith(`${path}/`);
  const { onKeyDown: _keyboardDragActivator, ...pointerDragListeners } =
    dragBindings?.listeners ?? {};

  return (
    <div
      ref={rowRef}
      style={rowStyle}
      className={cn(
        "relative",
        !loading &&
          "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200",
      )}
      data-sidebar-navigation-item={getPluginNavPanelKey(row)}
    >
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={cn(
          PROJECT_LIST_ACTION_BUTTON_CLASS,
          "w-full",
          accessory && "pr-18",
          isActive && "bg-sidebar-accent text-sidebar-foreground",
          loading &&
            "text-sidebar-foreground/55 dark:text-sidebar-foreground/55 [&_[data-icon-root]]:opacity-60",
        )}
        aria-busy={loading || undefined}
        aria-current={isActive ? "page" : undefined}
        ref={dragBindings?.setActivatorNodeRef}
        {...dragBindings?.attributes}
        {...pointerDragListeners}
        onPointerDown={onPointerDown}
        onClick={(event) => {
          onNavigate?.();
          if (event.metaKey || event.ctrlKey) {
            openInSplit();
            return;
          }
          void navigate(path);
        }}
      >
        <PluginIcon pluginId={chrome.pluginId} icon={chrome.icon} />
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <span className="min-w-0 truncate">{chrome.title}</span>
          {splitIndicator.miniMap ? (
            <SplitPaneMiniMap
              slots={splitIndicator.miniMap}
              label={`${chrome.title} — open in split`}
            />
          ) : null}
        </span>
      </Button>
      {accessory ? (
        <span
          data-plugin-nav-sidebar-accessory=""
          className="pointer-events-none absolute right-1 top-1/2 block min-w-5 max-h-5 max-w-16 -translate-y-1/2 overflow-hidden text-xs text-ellipsis whitespace-nowrap text-center leading-5"
        >
          {accessory}
        </span>
      ) : null}
    </div>
  );
}
