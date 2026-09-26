import type {
  CreateFilePreviewResponse,
  HostFileListResponse,
  HostFileReadNotModifiedResponse,
  HostFileReadResponse,
  HostFileWriteResponse,
  HostMkdirResponse,
  HostMovePathResponse,
  HostPathListResponse,
  HostRemovePathResponse,
} from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export interface FileReadArgs {
  hostId?: string;
  path: string;
  rootPath?: string;
  signal?: AbortSignal;
}

export interface FileReadIfChangedArgs extends FileReadArgs {
  sha256: string;
}

export interface FileWriteArgs {
  hostId?: string;
  path: string;
  rootPath?: string;
  content: string;
  contentEncoding?: "utf8" | "base64";
  createParents?: boolean;
  expectedSha256?: string | null;
  mode?: number;
}

export interface FileListArgs {
  hostId?: string;
  path: string;
  query?: string;
  limit?: number;
  includeHidden?: boolean;
  excludeNames?: string[];
  signal?: AbortSignal;
}

export interface PathListArgs extends FileListArgs {
  includeFiles: boolean;
  includeDirectories: boolean;
}

export interface FileMkdirArgs {
  hostId?: string;
  path: string;
  rootPath?: string;
  recursive?: boolean;
}

export interface FileMoveArgs {
  hostId?: string;
  sourcePath: string;
  destinationPath: string;
  rootPath?: string;
}

export interface FileRemoveArgs {
  hostId?: string;
  path: string;
  rootPath?: string;
  recursive?: boolean;
}

export interface FilePreviewArgs {
  hostId?: string;
  rootPath: string;
  signal?: AbortSignal;
  ttlMs?: number;
}

export type RawFileSource =
  | { kind: "worktree"; threadId: string; path: string }
  | { kind: "threadStorage"; threadId: string; path: string }
  | { kind: "hostFile"; threadId: string; path: string }
  | {
      kind: "project";
      projectId: string;
      path: string;
      hostId?: string;
      environmentId?: string;
    };

export interface RawFileUrlArgs {
  source: RawFileSource;
  download?: boolean;
}

export type FileReadResult = HostFileReadResponse;
export type FileReadNotModifiedResult = HostFileReadNotModifiedResponse;
export type FileWriteResult = HostFileWriteResponse;
export type FileListResult = HostFileListResponse;
export type PathListResult = HostPathListResponse;
export type FileMkdirResult = HostMkdirResponse;
export type FileMoveResult = HostMovePathResponse;
export type FileRemoveResult = HostRemovePathResponse;
export type FilePreviewResult = CreateFilePreviewResponse;

export interface FilesArea {
  read(args: FileReadArgs): Promise<FileReadResult>;
  /** Reads the file only when its content hash differs from `sha256`;
   * otherwise returns its metadata with `notModified: true`. */
  experimental_readIfChanged(
    args: FileReadIfChangedArgs,
  ): Promise<FileReadResult | FileReadNotModifiedResult>;
  write(args: FileWriteArgs): Promise<FileWriteResult>;
  list(args: FileListArgs): Promise<FileListResult>;
  listPaths(args: PathListArgs): Promise<PathListResult>;
  mkdir(args: FileMkdirArgs): Promise<FileMkdirResult>;
  move(args: FileMoveArgs): Promise<FileMoveResult>;
  remove(args: FileRemoveArgs): Promise<FileRemoveResult>;
  createPreview(args: FilePreviewArgs): Promise<FilePreviewResult>;
  /** Builds the raw byte URL for a file. The route streams any size, answers
   * single HTTP byte ranges, and sends an attachment disposition when
   * `download` is true. */
  experimental_rawFileUrl(args: RawFileUrlArgs): string;
}

function encodePathSegments(filePath: string): string {
  return filePath
    .split("/")
    .filter((segment) => segment !== "")
    .map(encodeURIComponent)
    .join("/");
}

function rawFilePathAndQuery(source: RawFileSource): {
  pathname: string;
  query: Record<string, string>;
} {
  switch (source.kind) {
    case "worktree":
      return {
        pathname: `threads/${encodeURIComponent(source.threadId)}/worktree/files/${encodePathSegments(source.path)}`,
        query: {},
      };
    case "threadStorage":
      return {
        pathname: `threads/${encodeURIComponent(source.threadId)}/thread-storage/files/${encodePathSegments(source.path)}`,
        query: {},
      };
    case "hostFile":
      return {
        pathname: `threads/${encodeURIComponent(source.threadId)}/host-files/content`,
        query: { path: source.path },
      };
    case "project":
      return {
        pathname: `projects/${encodeURIComponent(source.projectId)}/files/content`,
        query: {
          path: source.path,
          ...(source.hostId !== undefined ? { hostId: source.hostId } : {}),
          ...(source.environmentId !== undefined
            ? { environmentId: source.environmentId }
            : {}),
        },
      };
  }
}

function buildRawFileUrl(baseUrl: string, args: RawFileUrlArgs): string {
  const { pathname, query } = rawFilePathAndQuery(args.source);
  const search = new URLSearchParams({
    ...query,
    ...(args.download ? { download: "1" } : {}),
  }).toString();
  return `${baseUrl.replace(/\/$/u, "")}/api/v1/${pathname}${search === "" ? "" : `?${search}`}`;
}

export function createFilesArea(args: CreateSdkAreaArgs): FilesArea {
  const { transport } = args;
  return {
    async read(input) {
      const result = await transport.readJson(
        transport.api.v1.files.read.$post(
          {
            json: {
              hostId: input.hostId,
              path: input.path,
              rootPath: input.rootPath,
            },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
      if ("notModified" in result) {
        throw new Error("An unconditional file read returned not modified");
      }
      return result;
    },
    async experimental_readIfChanged(input) {
      return transport.readJson(
        transport.api.v1.files.read.$post(
          {
            json: {
              hostId: input.hostId,
              path: input.path,
              rootPath: input.rootPath,
              ifNoneMatchSha256: input.sha256,
            },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async write(input) {
      return transport.readJson(
        transport.api.v1.files.write.$post({ json: input }),
      );
    },
    async list(input) {
      return transport.readJson(
        transport.api.v1.files.list.$post(
          {
            json: {
              excludeNames: input.excludeNames,
              hostId: input.hostId,
              includeHidden: input.includeHidden,
              limit: input.limit,
              path: input.path,
              query: input.query,
            },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async listPaths(input) {
      return transport.readJson(
        transport.api.v1.files.paths.$post(
          {
            json: {
              excludeNames: input.excludeNames,
              hostId: input.hostId,
              includeDirectories: input.includeDirectories,
              includeFiles: input.includeFiles,
              includeHidden: input.includeHidden,
              limit: input.limit,
              path: input.path,
              query: input.query,
            },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async mkdir(input) {
      return transport.readJson(
        transport.api.v1.files.mkdir.$post({ json: input }),
      );
    },
    async move(input) {
      return transport.readJson(
        transport.api.v1.files.move.$post({ json: input }),
      );
    },
    async remove(input) {
      return transport.readJson(
        transport.api.v1.files.remove.$post({ json: input }),
      );
    },
    experimental_rawFileUrl(input) {
      return buildRawFileUrl(transport.baseUrl, input);
    },
    async createPreview(input) {
      return transport.readJson(
        transport.api.v1.files.previews.$post(
          {
            json: {
              hostId: input.hostId,
              rootPath: input.rootPath,
              ttlMs: input.ttlMs,
            },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
  };
}
