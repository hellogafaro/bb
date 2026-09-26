import { Buffer } from "node:buffer";
import {
  HOST_READ_FILE_RANGE_MAX_BYTES,
  type HostDaemonOnlineRpcResultByType,
  type HostReadFileIfNoneMatch,
} from "@bb/host-daemon-contract";
import { ApiError } from "../../errors.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "./online-rpc.js";

const OCTET_STREAM_MIME_TYPE = "application/octet-stream";
const REVALIDATE_CACHE_CONTROL = "private, no-cache";
const STREAMED_CACHE_CONTROL = "private, no-cache, no-transform";
const DOWNLOAD_FALLBACK_FILENAME = "download";

type HostReadFileResult = HostDaemonOnlineRpcResultByType["host.read_file"];
type HostReadFileRangeResult =
  HostDaemonOnlineRpcResultByType["host.read_file_range"];
export type DaemonFileReadResult =
  | HostReadFileResult
  | HostDaemonOnlineRpcResultByType["host.read_file_relative"];

interface CreateDaemonFileContentResponseOptions {
  headers?: HeadersInit;
  ifNoneMatch?: string | undefined;
}

export async function serveDaemonFileContent(
  deps: LoggedWorkSessionDeps,
  target: {
    hostId: string;
    ifNoneMatch?: string | undefined;
    path: string;
    rootPath?: string;
  },
  createResponse: (result: DaemonFileReadResult) => Response,
): Promise<Response> {
  const { hostId, ifNoneMatch, ...file } = target;
  const daemonIfNoneMatch = parseDaemonIfNoneMatch(ifNoneMatch);
  try {
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.read_file",
        ...file,
        ...(daemonIfNoneMatch !== undefined
          ? { ifNoneMatch: daemonIfNoneMatch }
          : {}),
      },
    });
    return createResponse(result);
  } catch (error) {
    return remapDaemonFileRouteError(error);
  }
}

function parseDaemonIfNoneMatch(
  ifNoneMatch: string | undefined,
): HostReadFileIfNoneMatch | undefined {
  if (ifNoneMatch === undefined) {
    return undefined;
  }
  if (ifNoneMatch.trim() === "*") {
    return { kind: "any" };
  }
  const values = ifNoneMatch
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//u, ""))
    .map((tag) => /^"([a-f0-9]{64})"$/u.exec(tag)?.[1])
    .filter((value): value is string => value !== undefined);
  return values.length > 0 ? { kind: "sha256", values } : undefined;
}

function daemonFileEntityTag(result: DaemonFileReadResult): string {
  return `"${result.sha256}"`;
}

export function requestMatchesEntityTag(
  ifNoneMatch: string | undefined,
  entityTag: string,
): boolean {
  if (ifNoneMatch === undefined) {
    return false;
  }
  const trimmed = ifNoneMatch.trim();
  if (trimmed === "*") {
    return true;
  }
  const opaque = (tag: string): string => tag.trim().replace(/^W\//u, "");
  return trimmed.split(",").map(opaque).includes(opaque(entityTag));
}

export function requireDaemonFileContentResult(
  result: HostReadFileResult,
): Exclude<HostReadFileResult, { notModified: true }> {
  if ("notModified" in result) {
    throw new Error("Unconditional daemon file read returned not modified");
  }
  return result;
}

function buildFileContentHeaders(
  result: DaemonFileReadResult,
  options: CreateDaemonFileContentResponseOptions,
): Headers {
  const headers = new Headers(options.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", result.mimeType ?? OCTET_STREAM_MIME_TYPE);
  }
  if (!headers.has("cache-control")) {
    headers.set("cache-control", REVALIDATE_CACHE_CONTROL);
  }
  headers.set("etag", daemonFileEntityTag(result));
  if (result.modifiedAtMs !== undefined) {
    headers.set("last-modified", new Date(result.modifiedAtMs).toUTCString());
  }
  return headers;
}

function decodeDaemonFileContent(result: DaemonFileReadResult): ArrayBuffer {
  if ("notModified" in result) {
    throw new Error("Cannot decode a not-modified daemon file result");
  }
  const bytes =
    result.contentEncoding === "utf8"
      ? Buffer.from(result.content, "utf8")
      : Buffer.from(result.content, "base64");
  const view = Uint8Array.from(bytes);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

export function createDaemonFileContentResponse(
  result: DaemonFileReadResult,
  options: CreateDaemonFileContentResponseOptions = {},
): Response {
  const headers = buildFileContentHeaders(result, options);
  if (
    "notModified" in result ||
    requestMatchesEntityTag(options.ifNoneMatch, daemonFileEntityTag(result))
  ) {
    return new Response(null, { status: 304, headers });
  }
  const content = decodeDaemonFileContent(result);
  headers.set("content-length", String(content.byteLength));
  return new Response(content, {
    status: 200,
    headers,
  });
}

export function remapDaemonFileRouteError(error: unknown): never {
  if (!(error instanceof ApiError)) {
    throw error;
  }

  if (error.body.code === "ENOENT") {
    throw new ApiError(
      404,
      error.body.code,
      error.body.message,
      error.body.retryable,
    );
  }
  if (error.body.code === "invalid_path") {
    throw new ApiError(
      400,
      error.body.code,
      error.body.message,
      error.body.retryable,
    );
  }
  if (error.body.code === "file_too_large") {
    throw new ApiError(
      413,
      error.body.code,
      error.body.message,
      error.body.retryable,
    );
  }
  throw error;
}

export interface RawFileRequest {
  download: boolean;
  ifNoneMatch: string | undefined;
  ifRange: string | undefined;
  range: string | undefined;
}

export type ByteRangeRequest =
  | { kind: "from"; start: number; end: number | undefined }
  | { kind: "suffix"; length: number };

export interface ByteRange {
  start: number;
  end: number;
}

interface RawFileTarget {
  hostId: string;
  path: string;
  rootPath?: string;
}

interface ServeDaemonRawFileOptions {
  assertInlineSize?: (sizeBytes: number) => void;
  fileName: string;
  fullReadHeaders?: (result: DaemonFileReadResult) => HeadersInit;
  headers?: HeadersInit;
  request: RawFileRequest;
  revalidate: boolean;
}

interface FileRangeMetadata {
  mimeType: string | undefined;
  modifiedAtMs: number;
  sizeBytes: number;
}

type ReadFileRange = (
  offset: number,
  length: number,
) => Promise<HostReadFileRangeResult>;

const BYTE_RANGE_PATTERN = /^bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/iu;

function parseRangeInteger(value: string): number | undefined {
  if (value === "") return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function parseByteRangeHeader(
  header: string | undefined,
): ByteRangeRequest | null {
  if (header === undefined) return null;
  const match = BYTE_RANGE_PATTERN.exec(header.trim());
  if (!match) return null;
  const [, rawStart = "", rawEnd = ""] = match;
  if (rawStart === "") {
    const length = parseRangeInteger(rawEnd);
    return length === undefined ? null : { kind: "suffix", length };
  }
  const start = parseRangeInteger(rawStart);
  if (start === undefined) return null;
  if (rawEnd === "") return { kind: "from", start, end: undefined };
  const end = parseRangeInteger(rawEnd);
  if (end === undefined || end < start) return null;
  return { kind: "from", start, end };
}

export function resolveByteRange(
  request: ByteRangeRequest,
  sizeBytes: number,
): ByteRange | null {
  if (request.kind === "suffix") {
    if (request.length === 0 || sizeBytes === 0) return null;
    return {
      start: Math.max(0, sizeBytes - request.length),
      end: sizeBytes - 1,
    };
  }
  if (request.start >= sizeBytes) return null;
  return {
    start: request.start,
    end: Math.min(request.end ?? sizeBytes - 1, sizeBytes - 1),
  };
}

function encodeRfc5987Value(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/gu,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

export function attachmentContentDisposition(filePath: string): string {
  const baseName =
    filePath
      .split(/[\\/]/u)
      .filter((segment) => segment !== "")
      .at(-1)
      ?.replace(/[\u0000-\u001f\u007f]/gu, "")
      .trim() ?? "";
  const fileName =
    baseName === "" || baseName === "." || baseName === ".."
      ? DOWNLOAD_FALLBACK_FILENAME
      : baseName;
  const asciiFallback = fileName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^\x20-\x7e]|["\\%;]/gu, "_");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeRfc5987Value(fileName)}`;
}

function ifRangeAllowsPartial(
  ifRange: string | undefined,
  modifiedAtMs: number,
): boolean {
  if (ifRange === undefined) return true;
  const trimmed = ifRange.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith("W/")) return false;
  return trimmed === new Date(modifiedAtMs).toUTCString();
}

function decodeRangeContent(result: HostReadFileRangeResult): Uint8Array {
  return Uint8Array.from(Buffer.from(result.content, "base64"));
}

export function createDaemonFileRangeStream(
  readRange: ReadFileRange,
  metadata: FileRangeMetadata,
  range: ByteRange,
): ReadableStream<Uint8Array> {
  let position = range.start;
  let cancelled = false;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        if (position > range.end) {
          controller.close();
          return;
        }
        const length = Math.min(
          HOST_READ_FILE_RANGE_MAX_BYTES,
          range.end - position + 1,
        );
        const result = await readRange(position, length);
        if (cancelled) return;
        const bytes = decodeRangeContent(result);
        if (
          result.sizeBytes !== metadata.sizeBytes ||
          result.modifiedAtMs !== metadata.modifiedAtMs ||
          result.offset !== position ||
          bytes.byteLength !== length
        ) {
          throw new Error("File changed while streaming");
        }
        position += bytes.byteLength;
        controller.enqueue(bytes);
        if (position > range.end) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 1 },
  );
}

function setDownloadHeaders(
  headers: Headers,
  options: ServeDaemonRawFileOptions,
): void {
  headers.set("accept-ranges", "bytes");
  if (options.request.download) {
    headers.set(
      "content-disposition",
      attachmentContentDisposition(options.fileName),
    );
  }
}

export function createStreamedDaemonFileResponse(
  readRange: ReadFileRange,
  metadata: FileRangeMetadata,
  options: ServeDaemonRawFileOptions,
): Response {
  if (!options.request.download) {
    options.assertInlineSize?.(metadata.sizeBytes);
  }
  const requestedRange = parseByteRangeHeader(options.request.range);
  const partial =
    requestedRange !== null &&
    ifRangeAllowsPartial(options.request.ifRange, metadata.modifiedAtMs);
  const range = partial
    ? resolveByteRange(requestedRange, metadata.sizeBytes)
    : { start: 0, end: metadata.sizeBytes - 1 };

  const headers = new Headers(options.headers);
  const cacheControl = headers.get("cache-control");
  headers.set(
    "cache-control",
    cacheControl === null
      ? STREAMED_CACHE_CONTROL
      : `${cacheControl}, no-transform`,
  );
  headers.set("last-modified", new Date(metadata.modifiedAtMs).toUTCString());
  setDownloadHeaders(headers, options);
  if (range === null) {
    headers.delete("content-type");
    headers.set("content-range", `bytes */${metadata.sizeBytes}`);
    headers.set("content-length", "0");
    return new Response(null, { status: 416, headers });
  }

  if (!headers.has("content-type")) {
    headers.set("content-type", metadata.mimeType ?? OCTET_STREAM_MIME_TYPE);
  }
  const contentLength = range.end - range.start + 1;
  headers.set("content-length", String(contentLength));
  if (partial) {
    headers.set(
      "content-range",
      `bytes ${range.start}-${range.end}/${metadata.sizeBytes}`,
    );
  }
  return new Response(
    contentLength === 0
      ? null
      : createDaemonFileRangeStream(readRange, metadata, range),
    { status: partial ? 206 : 200, headers },
  );
}

function isFileTooLargeError(error: unknown): boolean {
  return error instanceof ApiError && error.body.code === "file_too_large";
}

async function serveStreamedDaemonFile(
  deps: LoggedWorkSessionDeps,
  target: RawFileTarget,
  options: ServeDaemonRawFileOptions,
): Promise<Response> {
  const { hostId, ...file } = target;
  const readRange: ReadFileRange = (offset, length) =>
    callHostRetryableOnlineRpc(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: { type: "host.read_file_range", ...file, offset, length },
    });
  const stat = await readRange(0, 0);
  return createStreamedDaemonFileResponse(
    readRange,
    {
      mimeType: stat.mimeType,
      modifiedAtMs: stat.modifiedAtMs,
      sizeBytes: stat.sizeBytes,
    },
    options,
  );
}

async function serveBufferedDaemonFile(
  deps: LoggedWorkSessionDeps,
  target: RawFileTarget,
  options: ServeDaemonRawFileOptions,
): Promise<Response | null> {
  const { hostId, ...file } = target;
  const ifNoneMatch = options.revalidate
    ? options.request.ifNoneMatch
    : undefined;
  const daemonIfNoneMatch = parseDaemonIfNoneMatch(ifNoneMatch);
  let result: HostReadFileResult;
  try {
    result = await callHostRetryableOnlineRpc(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.read_file",
        ...file,
        ...(daemonIfNoneMatch !== undefined
          ? { ifNoneMatch: daemonIfNoneMatch }
          : {}),
      },
    });
  } catch (error) {
    if (isFileTooLargeError(error)) return null;
    throw error;
  }
  options.assertInlineSize?.(result.sizeBytes);
  const headers = new Headers(options.headers);
  for (const [name, value] of new Headers(options.fullReadHeaders?.(result))) {
    headers.set(name, value);
  }
  headers.set("accept-ranges", "bytes");
  return createDaemonFileContentResponse(result, { headers, ifNoneMatch });
}

export async function serveDaemonRawFile(
  deps: LoggedWorkSessionDeps,
  target: RawFileTarget,
  options: ServeDaemonRawFileOptions,
): Promise<Response> {
  try {
    const streamed =
      options.request.download ||
      parseByteRangeHeader(options.request.range) !== null;
    if (!streamed) {
      const buffered = await serveBufferedDaemonFile(deps, target, options);
      if (buffered !== null) return buffered;
    }
    return await serveStreamedDaemonFile(deps, target, options);
  } catch (error) {
    return remapDaemonFileRouteError(error);
  }
}

export function rawFileRequestFromHeaders(
  header: (name: string) => string | undefined,
  download: "1" | undefined,
): RawFileRequest {
  return {
    download: download === "1",
    ifNoneMatch: header("if-none-match"),
    ifRange: header("if-range"),
    range: header("range"),
  };
}
