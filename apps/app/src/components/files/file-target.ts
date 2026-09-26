import { useMemo } from "react";
import { useEnvironment } from "@/hooks/queries/environment-queries";
import { useThreadStorageLocation } from "@/hooks/queries/thread-queries";
import type { RawFileSource } from "@/lib/raw-file-url";
import { joinRoot } from "./file-paths";
import { FILES_COPY } from "./files-copy";
import type { FileLocation } from "./files-transport";

export type FileTargetSource =
  | { kind: "workspace"; environmentId: string; path: string }
  | { kind: "thread-storage"; threadId: string; path: string }
  | { kind: "host"; hostId: string; path: string }
  | {
      kind: "environment-host";
      environmentId: string;
      path: string;
      threadId: string;
    };

type FileTargetResolution =
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | {
      status: "ready";
      location: FileLocation;
      rawSource: RawFileSource | null;
    };

interface ResolveRawSourceArgs {
  environmentId: string | null;
  hostId: string;
  kind: FileTargetSource["kind"];
  projectId: string | null;
  threadId: string | null;
}

function resolveRawSource({
  environmentId,
  hostId,
  kind,
  projectId,
  threadId,
}: ResolveRawSourceArgs): RawFileSource | null {
  switch (kind) {
    case "workspace":
      return projectId === null
        ? null
        : { kind: "workspace", environmentId, hostId, projectId, threadId };
    case "environment-host":
      return threadId === null ? null : { kind: "host", threadId };
    case "thread-storage":
      return threadId === null ? null : { kind: "thread-storage", threadId };
    case "host":
      return null;
  }
}

export function useFileTarget(source: FileTargetSource): FileTargetResolution {
  const environmentId =
    source.kind === "workspace" || source.kind === "environment-host"
      ? source.environmentId
      : null;
  const environment = useEnvironment(environmentId, {
    enabled: environmentId !== null,
  });
  const storage = useThreadStorageLocation(
    source.kind === "thread-storage" ? source.threadId : "",
    { enabled: source.kind === "thread-storage" },
  );
  let hostId: string | null = null;
  let rootPath: string | null = null;
  let message: string | null = null;
  let projectId: string | null = null;
  switch (source.kind) {
    case "host":
      hostId = source.hostId;
      break;
    case "environment-host":
    case "workspace":
      if (environment.data === undefined) {
        message = environment.error?.message ?? null;
      } else if (source.kind === "environment-host") {
        hostId = environment.data.hostId;
      } else if (environment.data.path === null) {
        message = FILES_COPY.noWorkspacePath;
      } else {
        hostId = environment.data.hostId;
        rootPath = environment.data.path;
        projectId = environment.data.projectId;
      }
      break;
    case "thread-storage":
      if (storage.data === undefined) {
        message = storage.error?.message ?? null;
      } else {
        hostId = storage.data.hostId;
        rootPath = storage.data.storageRootPath;
      }
      break;
  }
  const path = source.path;
  const threadId =
    source.kind === "environment-host" || source.kind === "thread-storage"
      ? source.threadId
      : null;
  return useMemo((): FileTargetResolution => {
    if (hostId === null) {
      return message === null
        ? { status: "loading" }
        : { status: "unavailable", message };
    }
    const rawSource = resolveRawSource({
      environmentId,
      hostId,
      kind: source.kind,
      projectId,
      threadId,
    });
    if (rootPath === null) {
      return {
        status: "ready",
        location: { hostId, absolutePath: path, rootPath: path },
        rawSource,
      };
    }
    try {
      return {
        status: "ready",
        location: { hostId, absolutePath: joinRoot(rootPath, path), rootPath },
        rawSource,
      };
    } catch (error) {
      return {
        status: "unavailable",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }, [
    environmentId,
    hostId,
    message,
    path,
    projectId,
    rootPath,
    source.kind,
    threadId,
  ]);
}
