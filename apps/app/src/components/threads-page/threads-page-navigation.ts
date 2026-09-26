import { matchPath } from "react-router-dom";
import {
  THREADS_ROUTE_PATH,
  THREADS_STATUS_SEARCH_PARAM,
  type ThreadsListTab,
} from "@/lib/route-paths";

export interface ThreadsListRoute {
  tab: ThreadsListTab;
}

export function resolveThreadsListRoute(
  pathname: string,
  search = "",
): ThreadsListRoute | null {
  if (matchPath(THREADS_ROUTE_PATH, pathname) === null) return null;
  const status = new URLSearchParams(search).get(THREADS_STATUS_SEARCH_PARAM);
  return { tab: status === "archived" ? "archived" : "all" };
}

export function isThreadsListRoutePath(pathname: string): boolean {
  return resolveThreadsListRoute(pathname) !== null;
}

export function resolveThreadsListHeaderMeta(
  pathname: string,
): { kind: "breadcrumbs"; breadcrumbs: { label: string }[] } | null {
  return resolveThreadsListRoute(pathname) === null
    ? null
    : { kind: "breadcrumbs", breadcrumbs: [{ label: "Threads" }] };
}
