import { matchPath } from "react-router-dom";
import {
  THREADS_ARCHIVED_ROUTE_PATH,
  THREADS_ROUTE_PATH,
  type ThreadsListTab,
} from "@/lib/route-paths";

export interface ThreadsListRoute {
  tab: ThreadsListTab;
}

export function resolveThreadsListRoute(
  pathname: string,
): ThreadsListRoute | null {
  if (matchPath(THREADS_ROUTE_PATH, pathname) !== null) return { tab: "all" };
  if (matchPath(THREADS_ARCHIVED_ROUTE_PATH, pathname) !== null) {
    return { tab: "archived" };
  }
  return null;
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
