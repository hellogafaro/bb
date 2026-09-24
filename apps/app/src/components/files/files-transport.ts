import { createContext, useContext } from "react";
import type {
  FileReadNotModifiedResult,
  FileReadResult,
  FileWriteResult,
} from "@bb/sdk/browser";
import { BbHttpError, sdk } from "@/lib/sdk";
import {
  isInsideRoot,
  joinRoot,
  toRelative,
  type FileEntry,
} from "./file-paths";

export interface FileLocation {
  hostId: string;
  absolutePath: string;
  rootPath: string;
}

export interface DirectoryLocation {
  hostId: string;
  rootPath: string;
}

export interface FilesTransport {
  read(location: FileLocation, signal?: AbortSignal): Promise<FileReadResult>;
  readIfChanged(
    location: FileLocation,
    sha256: string,
    signal?: AbortSignal,
  ): Promise<FileReadResult | FileReadNotModifiedResult>;
  write(
    location: FileLocation,
    content: string,
    expectedSha256: string | null,
  ): Promise<FileWriteResult>;
  remove(location: FileLocation): Promise<void>;
  listDirectory(
    directory: DirectoryLocation,
    relativePath: string,
    signal?: AbortSignal,
  ): Promise<FileEntry[]>;
  search(
    directory: DirectoryLocation,
    query: string,
    signal?: AbortSignal,
  ): Promise<FileEntry[]>;
  isMissing(error: unknown): boolean;
}

const SEARCH_LIMIT = 80;

function childPath(parent: string, name: string): string {
  return parent === "" ? name : `${parent}/${name}`;
}

export const sdkFilesTransport: FilesTransport = {
  read(location, signal) {
    return sdk.files.read({
      hostId: location.hostId,
      path: location.absolutePath,
      rootPath: location.rootPath,
      signal,
    });
  },
  readIfChanged(location, sha256, signal) {
    return sdk.files.experimental_readIfChanged({
      hostId: location.hostId,
      path: location.absolutePath,
      rootPath: location.rootPath,
      sha256,
      signal,
    });
  },
  write(location, content, expectedSha256) {
    return sdk.files.write({
      hostId: location.hostId,
      path: location.absolutePath,
      rootPath: location.rootPath,
      content,
      expectedSha256,
    });
  },
  async remove(location) {
    await sdk.files.remove({
      hostId: location.hostId,
      path: location.absolutePath,
      rootPath: location.rootPath,
    });
  },
  async listDirectory(directory, relativePath, signal) {
    const listing = await sdk.hosts.directory({
      hostId: directory.hostId,
      path: joinRoot(directory.rootPath, relativePath),
      includeHidden: true,
      signal,
    });
    return listing.entries.map((entry) => ({
      name: entry.name,
      kind: entry.kind,
      relativePath: childPath(relativePath, entry.name),
    }));
  },
  async search(directory, query, signal) {
    const listing = await sdk.files.list({
      hostId: directory.hostId,
      path: directory.rootPath,
      query,
      limit: SEARCH_LIMIT,
      signal,
    });
    return listing.files.flatMap((file) =>
      isInsideRoot(directory.rootPath, file.path)
        ? [
            {
              name: file.name,
              kind: "file" as const,
              relativePath: toRelative(directory.rootPath, file.path),
            },
          ]
        : [],
    );
  },
  isMissing(error) {
    return error instanceof BbHttpError && error.status === 404;
  },
};

export const FilesTransportContext =
  createContext<FilesTransport>(sdkFilesTransport);

export function useFilesTransport(): FilesTransport {
  return useContext(FilesTransportContext);
}
