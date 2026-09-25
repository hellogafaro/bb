import { matchPath } from "react-router-dom";
import {
  AGENTS_ROUTE_PATH,
  AGENT_DETAIL_ROUTE_PATH,
  getAgentsRoutePath,
} from "@bb/client-core";

type AgentsRoute = { agentRef: string | null };

interface AgentsBreadcrumb {
  label: string;
  to?: string;
}

function decodeRouteSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function isAgentsRoutePath(pathname: string): boolean {
  return resolveAgentsRoute(pathname) !== null;
}

export function resolveAgentsRoute(pathname: string): AgentsRoute | null {
  if (matchPath(AGENTS_ROUTE_PATH, pathname) !== null) {
    return { agentRef: null };
  }
  const ref = matchPath(AGENT_DETAIL_ROUTE_PATH, pathname)?.params.agentRef;
  return ref === undefined || ref === ""
    ? null
    : { agentRef: decodeRouteSegment(ref) };
}

export function resolveAgentsHeaderMeta(
  pathname: string,
  resourceLabel?: string | null,
): { kind: "breadcrumbs"; breadcrumbs: AgentsBreadcrumb[] } | null {
  const route = resolveAgentsRoute(pathname);
  if (route === null) return null;
  return {
    kind: "breadcrumbs",
    breadcrumbs:
      route.agentRef === null
        ? [{ label: "Agents" }]
        : [
            { label: "Agents", to: getAgentsRoutePath() },
            { label: resourceLabel ?? route.agentRef },
          ],
  };
}
