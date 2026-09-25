import { matchPath } from "react-router-dom";
import { FORK_CUSTOMIZE_PAGE } from "@/lib/fork-flags";
import {
  CUSTOMIZE_ROUTE_PATH,
  SKILL_DETAIL_ROUTE_PATH,
} from "@/lib/route-paths";

export type CustomizeTab = "skills" | "mcps";

type CustomizeRoute =
  | { tab: "skills" }
  | { tab: "mcps"; mcpRef: string | null };

interface CustomizeBreadcrumb {
  label: string;
  to?: string;
}

const CUSTOMIZE_MCPS_ROUTE_PATH = `${CUSTOMIZE_ROUTE_PATH}/mcps`;
const CUSTOMIZE_MCP_DETAIL_ROUTE_PATH = `${CUSTOMIZE_MCPS_ROUTE_PATH}/:mcpRef`;

export function getCustomizeRoutePath(tab: CustomizeTab): string {
  return tab === "skills" ? CUSTOMIZE_ROUTE_PATH : CUSTOMIZE_MCPS_ROUTE_PATH;
}

export function getMcpDetailRoutePath(ref: string): string {
  return `${CUSTOMIZE_MCPS_ROUTE_PATH}/${encodeURIComponent(ref)}`;
}

export function resolveCustomizeRoute(pathname: string): CustomizeRoute | null {
  if (matchPath(CUSTOMIZE_ROUTE_PATH, pathname) !== null) {
    return { tab: "skills" };
  }
  if (matchPath(CUSTOMIZE_MCPS_ROUTE_PATH, pathname) !== null) {
    return { tab: "mcps", mcpRef: null };
  }
  const detail = matchPath(CUSTOMIZE_MCP_DETAIL_ROUTE_PATH, pathname);
  const ref = detail?.params.mcpRef;
  return ref === undefined || ref === ""
    ? null
    : { tab: "mcps", mcpRef: decodeRouteSegment(ref) };
}

function decodeRouteSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function resolveCustomizeBreadcrumbs(
  pathname: string,
  resourceLabel?: string | null,
): CustomizeBreadcrumb[] | null {
  if (!FORK_CUSTOMIZE_PAGE) return null;
  const route = resolveCustomizeRoute(pathname);
  if (route?.tab === "skills") return [{ label: "Customize" }];
  if (route?.tab === "mcps") {
    return route.mcpRef === null
      ? [{ label: "Customize" }]
      : [
          { label: "Customize", to: getCustomizeRoutePath("mcps") },
          { label: resourceLabel ?? route.mcpRef },
        ];
  }
  const skill = matchPath(SKILL_DETAIL_ROUTE_PATH, pathname);
  if (skill === null) return null;
  return [
    { label: "Customize", to: getCustomizeRoutePath("skills") },
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
