import { useMemo } from "react";
import { useEnvironment } from "@/hooks/queries/environment-queries";
import { useThreadStorageLocation } from "@/hooks/queries/thread-queries";
import { joinRoot } from "./file-paths";
import { FILES_COPY } from "./files-copy";
import type { FileLocation } from "./files-transport";

export type FileTargetSource =
  | { kind: "workspace"; environmentId: string; path: string }
  | { kind: "thread-storage"; threadId: string; path: string }
  | { kind: "host"; hostId: string; path: string }
  | { kind: "environment-host"; environmentId: string; path: string };

type FileTargetResolution =
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | { status: "ready"; location: FileLocation };

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
  return useMemo((): FileTargetResolution => {
    if (hostId === null) {
      return message === null
        ? { status: "loading" }
        : { status: "unavailable", message };
    }
    if (rootPath === null) {
      return {
        status: "ready",
        location: { hostId, absolutePath: path, rootPath: path },
      };
    }
    try {
      return {
        status: "ready",
        location: { hostId, absolutePath: joinRoot(rootPath, path), rootPath },
      };
    } catch (error) {
      return {
        status: "unavailable",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }, [hostId, message, path, rootPath]);
}
