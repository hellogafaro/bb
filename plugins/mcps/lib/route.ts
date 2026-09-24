export type Route = {
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
  if (path === "" || path === "installed" || path === "browse") return { detailId: null };
  if (path.startsWith("installed/")) {
    return { detailId: decodeUriSegment(path.slice("installed/".length)) };
  }
  return { detailId: decodeUriSegment(path) };
}

export function detailPath(id: string): string {
  return `installed/${encodeURIComponent(id)}`;
}

export function crumbsForRoute(route: Route, name: string | null): Crumb[] {
  if (route.detailId) {
    return [{ label: "MCPs", subPath: "" }, { label: name?.trim() || route.detailId }];
  }
  return [{ label: "MCPs" }];
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
