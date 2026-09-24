export type Tab = "installed" | "browse";

export type Route = {
  tab: Tab;
  detailId: string | null;
};

export type Crumb = {
  label: string;
  subPath?: string;
};

const LABEL_EVENT = "bb:resource-route-label";

let detailLabel: string | null = null;
const labelListeners = new Set<(label: string | null) => void>();

export function parseRoute(subPath: string): Route {
  const path = subPath.replace(/^\/+|\/+$/g, "");
  if (path === "browse") return { tab: "browse", detailId: null };
  if (path === "" || path === "installed") return { tab: "installed", detailId: null };
  if (path.startsWith("installed/")) {
    return { tab: "installed", detailId: decodeUriSegment(path.slice("installed/".length)) };
  }
  return { tab: "installed", detailId: decodeUriSegment(path) };
}

export function detailPath(id: string): string {
  return `installed/${encodeURIComponent(id)}`;
}

export function crumbsForRoute(route: Route, name: string | null): Crumb[] {
  const root: Crumb = { label: "MCPs", subPath: "" };
  if (route.detailId) {
    return [root, { label: "Installed", subPath: "" }, { label: name?.trim() || route.detailId }];
  }
  if (route.tab === "browse") return [root, { label: "Browse" }];
  return [root, { label: "Installed" }];
}

export function publishDetailLabel(label: string | null): void {
  detailLabel = label;
  for (const listener of labelListeners) listener(label);
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LABEL_EVENT, { detail: { label } }));
}

export function subscribeDetailLabel(listener: (label: string | null) => void): () => void {
  labelListeners.add(listener);
  listener(detailLabel);
  return () => {
    labelListeners.delete(listener);
  };
}

function decodeUriSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
