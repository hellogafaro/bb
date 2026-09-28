const DEFAULT_FILE_PREVIEW_MIME_TYPE = "application/octet-stream";
const textDecoder = new TextDecoder();
const strictUtf8TextDecoder = new TextDecoder("utf-8", { fatal: true });

const UTF8_TEXT_MIME_TYPES = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/json",
  "application/ld+json",
  "application/sql",
  "application/toml",
  "application/typescript",
  "application/x-httpd-php",
  "application/x-sh",
  "application/x-typescript",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
]);

const MARKDOWN_FILE_EXTENSIONS = [".md", ".markdown"];
const MARKDOWN_MIME_TYPES = new Set(["text/markdown", "text/x-markdown"]);
const CSV_FILE_EXTENSIONS = [".csv"];
const CSV_MIME_TYPES = new Set(["application/csv", "text/csv"]);
const HTML_FILE_EXTENSIONS = [".html", ".htm"];
const NULL_CHARACTER = "\u0000";
const PDF_MIME_TYPE = "application/pdf";

export const TEXT_FILE_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

export type OfficeDocumentFormat = "docx" | "pptx" | "xlsx";

export type StreamedFilePreviewType =
  | { kind: "audio" | "image" | "pdf" | "video"; mimeType: string }
  | { kind: "office"; format: OfficeDocumentFormat; mimeType: string };

const OFFICE_MIME_TYPES = new Map<string, OfficeDocumentFormat>([
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "docx",
  ],
  [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "pptx",
  ],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
]);

function officeType(format: OfficeDocumentFormat): StreamedFilePreviewType {
  const mimeType = [...OFFICE_MIME_TYPES].find(
    ([, candidate]) => candidate === format,
  )?.[0];
  return {
    kind: "office",
    format,
    mimeType: mimeType ?? DEFAULT_FILE_PREVIEW_MIME_TYPE,
  };
}

const STREAMED_FILE_PREVIEW_TYPES = new Map<string, StreamedFilePreviewType>([
  ["apng", { kind: "image", mimeType: "image/apng" }],
  ["avif", { kind: "image", mimeType: "image/avif" }],
  ["bmp", { kind: "image", mimeType: "image/bmp" }],
  ["gif", { kind: "image", mimeType: "image/gif" }],
  ["heic", { kind: "image", mimeType: "image/heic" }],
  ["heif", { kind: "image", mimeType: "image/heif" }],
  ["ico", { kind: "image", mimeType: "image/vnd.microsoft.icon" }],
  ["jpeg", { kind: "image", mimeType: "image/jpeg" }],
  ["jpg", { kind: "image", mimeType: "image/jpeg" }],
  ["png", { kind: "image", mimeType: "image/png" }],
  ["svg", { kind: "image", mimeType: "image/svg+xml" }],
  ["svgz", { kind: "image", mimeType: "image/svg+xml" }],
  ["tif", { kind: "image", mimeType: "image/tiff" }],
  ["tiff", { kind: "image", mimeType: "image/tiff" }],
  ["webp", { kind: "image", mimeType: "image/webp" }],
  ["3g2", { kind: "video", mimeType: "video/3gpp2" }],
  ["3gp", { kind: "video", mimeType: "video/3gpp" }],
  ["avi", { kind: "video", mimeType: "video/x-msvideo" }],
  ["m4v", { kind: "video", mimeType: "video/x-m4v" }],
  ["mkv", { kind: "video", mimeType: "video/x-matroska" }],
  ["mov", { kind: "video", mimeType: "video/quicktime" }],
  ["mp4", { kind: "video", mimeType: "video/mp4" }],
  ["mpeg", { kind: "video", mimeType: "video/mpeg" }],
  ["mpg", { kind: "video", mimeType: "video/mpeg" }],
  ["ogv", { kind: "video", mimeType: "video/ogg" }],
  ["webm", { kind: "video", mimeType: "video/webm" }],
  ["wmv", { kind: "video", mimeType: "video/x-ms-wmv" }],
  ["aac", { kind: "audio", mimeType: "audio/aac" }],
  ["aif", { kind: "audio", mimeType: "audio/aiff" }],
  ["aiff", { kind: "audio", mimeType: "audio/aiff" }],
  ["flac", { kind: "audio", mimeType: "audio/flac" }],
  ["m4a", { kind: "audio", mimeType: "audio/mp4" }],
  ["mp3", { kind: "audio", mimeType: "audio/mpeg" }],
  ["oga", { kind: "audio", mimeType: "audio/ogg" }],
  ["ogg", { kind: "audio", mimeType: "audio/ogg" }],
  ["opus", { kind: "audio", mimeType: "audio/opus" }],
  ["wav", { kind: "audio", mimeType: "audio/wav" }],
  ["weba", { kind: "audio", mimeType: "audio/webm" }],
  ["pdf", { kind: "pdf", mimeType: PDF_MIME_TYPE }],
  ["docx", officeType("docx")],
  ["pptx", officeType("pptx")],
  ["xlsx", officeType("xlsx")],
]);

export interface FilePreviewTarget {
  name?: string;
  path: string;
  url: string;
}

interface FilePreviewBase extends FilePreviewTarget {
  kind: "audio" | "image" | "office" | "pdf" | "text" | "unsupported" | "video";
  mimeType: string;
}

interface ImageFilePreview extends FilePreviewBase {
  kind: "image";
}

interface VideoFilePreview extends FilePreviewBase {
  kind: "video";
}

interface AudioFilePreview extends FilePreviewBase {
  kind: "audio";
}

interface PdfFilePreview extends FilePreviewBase {
  kind: "pdf";
}

export interface OfficeFilePreview extends FilePreviewBase {
  kind: "office";
  format: OfficeDocumentFormat;
}

export interface TextFilePreview extends FilePreviewBase {
  kind: "text";
  content: string;
}

export interface UnsupportedFilePreview extends FilePreviewBase {
  kind: "unsupported";
  reason: "too-large" | "type";
  sizeBytes: number | null;
}

export type FilePreview =
  | AudioFilePreview
  | ImageFilePreview
  | OfficeFilePreview
  | PdfFilePreview
  | TextFilePreview
  | UnsupportedFilePreview
  | VideoFilePreview;

export type EnvironmentFilePreviewSource =
  | { kind: "working-tree" }
  | { kind: "head" }
  | { kind: "merge-base"; ref: string };

export type WorkspaceFilePreviewStatusLabel = "deleted";

export interface FilePreviewLineRange {
  endLineNumber: number;
  startLineNumber: number;
}

interface CreateFilePreviewLineRangeArgs {
  endLineNumber: number;
  startLineNumber: number;
}

interface AreFilePreviewLineRangesEqualArgs {
  a: FilePreviewLineRange | null;
  b: FilePreviewLineRange | null;
}

interface GetFilePreviewLineRangeStartArgs {
  lineRange: FilePreviewLineRange | null;
}

export interface WorkspaceFileTabState {
  lineRange: FilePreviewLineRange | null;
  path: string;
  source: EnvironmentFilePreviewSource;
  statusLabel: WorkspaceFilePreviewStatusLabel | null;
}

export interface HostFileTabState {
  lineRange: FilePreviewLineRange | null;
  path: string;
}

export interface ThreadStorageFileTabState {
  lineRange: FilePreviewLineRange | null;
  path: string;
}

export function createFilePreviewLineRange({
  endLineNumber,
  startLineNumber,
}: CreateFilePreviewLineRangeArgs): FilePreviewLineRange | null {
  if (
    !Number.isSafeInteger(startLineNumber) ||
    !Number.isSafeInteger(endLineNumber) ||
    startLineNumber <= 0 ||
    endLineNumber <= 0 ||
    startLineNumber > endLineNumber
  ) {
    return null;
  }

  return {
    endLineNumber,
    startLineNumber,
  };
}

export function areFilePreviewLineRangesEqual({
  a,
  b,
}: AreFilePreviewLineRangesEqualArgs): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return (
    a.startLineNumber === b.startLineNumber &&
    a.endLineNumber === b.endLineNumber
  );
}

export function getFilePreviewLineRangeStart({
  lineRange,
}: GetFilePreviewLineRangeStartArgs): number | null {
  return lineRange?.startLineNumber ?? null;
}

export function areEnvironmentFilePreviewSourcesEqual(
  a: EnvironmentFilePreviewSource,
  b: EnvironmentFilePreviewSource,
): boolean {
  if (a.kind !== b.kind) {
    return false;
  }

  switch (a.kind) {
    case "working-tree":
    case "head":
      return true;
    case "merge-base":
      return b.kind === "merge-base" && a.ref === b.ref;
    default: {
      const exhaustive: never = a;
      return exhaustive;
    }
  }
}

interface BuildFilePreviewArgs extends FilePreviewTarget {
  contentBytes: Uint8Array;
  mimeType: string;
}

interface BuildUnsupportedFilePreviewArgs extends FilePreviewTarget {
  mimeType: string;
  reason: UnsupportedFilePreview["reason"];
  sizeBytes: number | null;
}

function filePreviewExtension(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1);
}

function getStreamedFilePreviewTypeForMimeType(
  mimeType: string,
): StreamedFilePreviewType | null {
  if (mimeType === PDF_MIME_TYPE) {
    return { kind: "pdf", mimeType };
  }
  if (mimeType.startsWith("audio/")) {
    return { kind: "audio", mimeType };
  }
  if (mimeType.startsWith("video/")) {
    return { kind: "video", mimeType };
  }
  const format = OFFICE_MIME_TYPES.get(mimeType);
  return format === undefined ? null : { kind: "office", format, mimeType };
}

export function getStreamedFilePreviewType(
  path: string,
  mimeType: string | null = null,
): StreamedFilePreviewType | null {
  const byExtension = STREAMED_FILE_PREVIEW_TYPES.get(
    filePreviewExtension(path),
  );
  if (byExtension !== undefined) {
    return byExtension;
  }
  if (mimeType === null) {
    return null;
  }
  const normalizedMimeType = normalizeFilePreviewMimeType(mimeType);
  if (normalizedMimeType.startsWith("image/")) {
    return { kind: "image", mimeType: normalizedMimeType };
  }
  return getStreamedFilePreviewTypeForMimeType(normalizedMimeType);
}

export function hasStreamedFilePreviewRenderer(
  type: StreamedFilePreviewType,
): boolean {
  return type.kind !== "office" || type.format !== "pptx";
}

export function buildStreamedFilePreview(
  target: FilePreviewTarget,
  type: StreamedFilePreviewType,
): FilePreview {
  return { ...type, ...target };
}

export function buildUnsupportedFilePreview({
  mimeType,
  name,
  path,
  reason,
  sizeBytes,
  url,
}: BuildUnsupportedFilePreviewArgs): UnsupportedFilePreview {
  return {
    kind: "unsupported",
    mimeType,
    name,
    path,
    reason,
    sizeBytes,
    url,
  };
}

function isKnownTextMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType.endsWith("+json") ||
    mimeType.endsWith("+xml") ||
    UTF8_TEXT_MIME_TYPES.has(mimeType)
  );
}

function decodeUtf8Text(contentBytes: Uint8Array): string | null {
  try {
    const content = strictUtf8TextDecoder.decode(contentBytes);
    return content.includes(NULL_CHARACTER) ? null : content;
  } catch {
    return null;
  }
}

function decodeDeclaredTextContent(contentBytes: Uint8Array): string | null {
  const content = textDecoder.decode(contentBytes);
  return content.includes(NULL_CHARACTER) ? null : content;
}

function hasMarkdownExtension(path: string): boolean {
  const normalizedPath = path.toLowerCase();
  return MARKDOWN_FILE_EXTENSIONS.some((extension) =>
    normalizedPath.endsWith(extension),
  );
}

function hasCsvExtension(path: string): boolean {
  const normalizedPath = path.toLowerCase();
  return CSV_FILE_EXTENSIONS.some((extension) =>
    normalizedPath.endsWith(extension),
  );
}

export function isHtmlFilePreviewPath(path: string): boolean {
  const normalizedPath = path.toLowerCase();
  return HTML_FILE_EXTENSIONS.some((extension) =>
    normalizedPath.endsWith(extension),
  );
}

export function normalizeFilePreviewMimeType(value: string | null): string {
  const normalizedValue = value?.split(";")[0]?.trim().toLowerCase();
  return normalizedValue && normalizedValue.length > 0
    ? normalizedValue
    : DEFAULT_FILE_PREVIEW_MIME_TYPE;
}

export function isMarkdownFilePreview(preview: FilePreview): boolean {
  return (
    preview.kind === "text" &&
    (MARKDOWN_MIME_TYPES.has(preview.mimeType) ||
      hasMarkdownExtension(preview.path) ||
      (preview.name ? hasMarkdownExtension(preview.name) : false))
  );
}

export function isCsvFilePreview(preview: FilePreview): boolean {
  return (
    preview.kind === "text" &&
    (CSV_MIME_TYPES.has(preview.mimeType) ||
      hasCsvExtension(preview.path) ||
      (preview.name ? hasCsvExtension(preview.name) : false))
  );
}

interface BuildOversizedFilePreviewArgs extends FilePreviewTarget {
  mimeType: string;
  prefixBytes: Uint8Array;
  sizeBytes: number;
}

function isUtf8TextPrefix(prefixBytes: Uint8Array): boolean {
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(
      prefixBytes,
      { stream: true },
    );
    return !content.includes(NULL_CHARACTER);
  } catch {
    return false;
  }
}

export function buildOversizedFilePreview({
  mimeType,
  prefixBytes,
  sizeBytes,
  ...target
}: BuildOversizedFilePreviewArgs): FilePreview {
  if (isKnownTextMimeType(mimeType) || isUtf8TextPrefix(prefixBytes)) {
    return buildUnsupportedFilePreview({
      ...target,
      mimeType,
      reason: "too-large",
      sizeBytes,
    });
  }
  const streamedType = mimeType.startsWith("image/")
    ? { kind: "image" as const, mimeType }
    : getStreamedFilePreviewTypeForMimeType(mimeType);
  return streamedType === null || !hasStreamedFilePreviewRenderer(streamedType)
    ? buildUnsupportedFilePreview({
        ...target,
        mimeType,
        reason: "type",
        sizeBytes,
      })
    : buildStreamedFilePreview(target, streamedType);
}

export function buildFilePreview(args: BuildFilePreviewArgs): FilePreview {
  const base = {
    mimeType: args.mimeType,
    name: args.name,
    path: args.path,
    url: args.url,
  };

  if (args.mimeType.startsWith("image/")) {
    return {
      kind: "image",
      ...base,
    };
  }

  const unsupported = buildUnsupportedFilePreview({
    ...base,
    reason: "type",
    sizeBytes: args.contentBytes.byteLength,
  });

  if (isKnownTextMimeType(args.mimeType)) {
    const textContent = decodeDeclaredTextContent(args.contentBytes);
    if (textContent === null) {
      return unsupported;
    }
    return {
      kind: "text",
      ...base,
      content: textContent,
    };
  }

  const fallbackTextContent = decodeUtf8Text(args.contentBytes);
  if (fallbackTextContent !== null) {
    return {
      kind: "text",
      ...base,
      content: fallbackTextContent,
    };
  }

  const streamedType = getStreamedFilePreviewTypeForMimeType(args.mimeType);
  return streamedType === null || !hasStreamedFilePreviewRenderer(streamedType)
    ? unsupported
    : buildStreamedFilePreview(base, streamedType);
}
