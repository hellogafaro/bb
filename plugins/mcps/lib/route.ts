export type Route = {
  detailId: string | null;
};

const LABEL_EVENT = "bb:resource-route-label";

export function parseRoute(subPath: string): Route {
  const path = subPath.replace(/^\/+|\/+$/g, "");
  return { detailId: path.startsWith("installed/") ? decodeUriSegment(path.slice("installed/".length)) : null };
}

export function detailPath(id: string): string {
  return `installed/${encodeURIComponent(id)}`;
}

export function publishDetailLabel(label: string | null): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LABEL_EVENT, { detail: { label } }));
}

function decodeUriSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
