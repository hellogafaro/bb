import { matchPath } from "react-router-dom";
import { FORK_CUSTOMIZE_PAGE } from "@/lib/fork-flags";
import {
  CUSTOMIZE_ROUTE_PATH,
  getPluginPanelRoutePath,
  SKILL_DETAIL_ROUTE_PATH,
} from "@/lib/route-paths";

export type CustomizeTab = "skills" | "mcps";

type PluginPanelRoutePathArgs = Parameters<typeof getPluginPanelRoutePath>[0];

interface CustomizeRoute {
  tab: CustomizeTab;
  subPath: string;
}

interface CustomizeBreadcrumb {
  label: string;
  to?: string;
}

export const CUSTOMIZE_MCPS_PANEL = { pluginId: "mcps", path: "mcps" } as const;
export const CUSTOMIZE_MCPS_PANEL_ROUTE_PATH =
  getPluginPanelRoutePath(CUSTOMIZE_MCPS_PANEL);
const CUSTOMIZE_MCPS_ROUTE_PATH = `${CUSTOMIZE_ROUTE_PATH}/mcps`;
const CUSTOMIZE_CRUMB = { label: "Customize", to: CUSTOMIZE_ROUTE_PATH };

export function getCustomizeRoutePath(tab: CustomizeTab, subPath = ""): string {
  if (tab === "skills") return CUSTOMIZE_ROUTE_PATH;
  const panelRoute = getPluginPanelRoutePath({
    ...CUSTOMIZE_MCPS_PANEL,
    subPath,
  });
  return `${CUSTOMIZE_MCPS_ROUTE_PATH}${panelRoute.slice(CUSTOMIZE_MCPS_PANEL_ROUTE_PATH.length)}`;
}

export function resolveCustomizeRoute(pathname: string): CustomizeRoute | null {
  if (matchPath(CUSTOMIZE_ROUTE_PATH, pathname) !== null) {
    return { tab: "skills", subPath: "" };
  }
  const mcps = matchPath(`${CUSTOMIZE_MCPS_ROUTE_PATH}/*`, pathname);
  return mcps === null
    ? null
    : { tab: "mcps", subPath: mcps.params["*"] ?? "" };
}

export function resolvePluginPanelRoutePath(
  args: PluginPanelRoutePathArgs,
): string {
  return FORK_CUSTOMIZE_PAGE &&
    args.pluginId === CUSTOMIZE_MCPS_PANEL.pluginId &&
    args.path === CUSTOMIZE_MCPS_PANEL.path
    ? getCustomizeRoutePath("mcps", args.subPath)
    : getPluginPanelRoutePath(args);
}

function decodeRouteSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function nestedDetailSegment(subPath: string): string | null {
  const segments = subPath.split("/").filter(Boolean);
  const leaf = segments.at(-1);
  return segments.length > 1 && leaf !== undefined
    ? decodeRouteSegment(leaf)
    : null;
}

export function resolveCustomizeBreadcrumbs(
  pathname: string,
  resourceLabel?: string | null,
): CustomizeBreadcrumb[] | null {
  if (!FORK_CUSTOMIZE_PAGE) return null;
  const route = resolveCustomizeRoute(pathname);
  if (route?.tab === "skills") return [CUSTOMIZE_CRUMB, { label: "Skills" }];
  if (route?.tab === "mcps") {
    const detailLabel = resourceLabel ?? nestedDetailSegment(route.subPath);
    return detailLabel === null
      ? [CUSTOMIZE_CRUMB, { label: "MCPs" }]
      : [
          CUSTOMIZE_CRUMB,
          { label: "MCPs", to: getCustomizeRoutePath("mcps") },
          { label: detailLabel },
        ];
  }
  const skill = matchPath(SKILL_DETAIL_ROUTE_PATH, pathname);
  if (skill === null) return null;
  return [
    CUSTOMIZE_CRUMB,
    { label: "Skills", to: CUSTOMIZE_ROUTE_PATH },
    {
      label:
        resourceLabel ?? decodeRouteSegment(skill.params.skillId ?? "Skill"),
    },
  ];
}

export function resolveCustomizeHeaderMeta(
  pathname: string,
  resourceLabel?: string | null,
): { kind: "breadcrumbs"; breadcrumbs: CustomizeBreadcrumb[] } | null {
  const breadcrumbs = resolveCustomizeBreadcrumbs(pathname, resourceLabel);
  return breadcrumbs === null ? null : { kind: "breadcrumbs", breadcrumbs };
}
