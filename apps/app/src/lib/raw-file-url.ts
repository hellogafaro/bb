import {
  buildProjectFileContentUrl,
  buildThreadHostFileContentUrl,
  buildThreadStorageRawContentUrl,
  buildThreadWorktreeRawContentUrl,
} from "./file-content-urls";

export type RawFileSource =
  | {
      kind: "workspace";
      environmentId: string | null;
      hostId: string | null;
      projectId: string | null;
      threadId: string | null;
    }
  | { kind: "host"; threadId: string }
  | { kind: "thread-storage"; threadId: string };

interface BuildRawFileUrlOptions {
  download?: boolean;
}

function buildProjectRoutedUrl(
  projectId: string,
  path: string,
  environmentId: string | null,
  hostId: string | null,
): string {
  return buildProjectFileContentUrl(
    projectId,
    path,
    environmentId !== null
      ? { environmentId }
      : hostId !== null
        ? { hostId }
        : {},
  );
}

function resolveRawFileUrl(source: RawFileSource, path: string): string | null {
  switch (source.kind) {
    case "workspace":
      if (source.threadId !== null) {
        return buildThreadWorktreeRawContentUrl(source.threadId, path);
      }
      return source.projectId === null
        ? null
        : buildProjectRoutedUrl(
            source.projectId,
            path,
            source.environmentId,
            source.hostId,
          );
    case "host":
      return buildThreadHostFileContentUrl(source.threadId, path);
    case "thread-storage":
      return buildThreadStorageRawContentUrl(source.threadId, path);
  }
}

export function withRawFileDownload(url: string): string {
  if (url.startsWith("data:") || url.startsWith("blob:")) {
    return url;
  }
  return `${url}${url.includes("?") ? "&" : "?"}download=1`;
}

export function buildRawFileUrl(
  source: RawFileSource,
  path: string,
  { download = false }: BuildRawFileUrlOptions = {},
): string | null {
  const url = resolveRawFileUrl(source, path);
  if (url === null) {
    return null;
  }
  return download ? withRawFileDownload(url) : url;
}

export function downloadRawFile(url: string, filename: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
}
