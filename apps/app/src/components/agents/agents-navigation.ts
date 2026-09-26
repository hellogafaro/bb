import { matchPath } from "react-router-dom";
import { AGENTS_ROUTE_PATH, AGENT_DETAIL_ROUTE_PATH } from "@bb/client-core";

type AgentsRoute = { agentRef: string | null };

function decodeRouteSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
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
