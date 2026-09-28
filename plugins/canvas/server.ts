import path from "node:path";
import {
  defineRpcContract,
  type BbPluginApi,
  type MarkdownProps,
} from "@get-bb/plugin-sdk";
import { z } from "zod";

export const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;

type PreviewKind = "html" | "markdown";

const PREVIEW_KIND_BY_EXTENSION: ReadonlyMap<string, PreviewKind> = new Map([
  [".html", "html"],
  [".htm", "html"],
  [".md", "markdown"],
  [".markdown", "markdown"],
]);

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`"${field}" must be a non-empty string`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const HTML_TITLE_PATTERN = /<title[^>]*>([\s\S]*?)<\/title>/i;
const MARKDOWN_HEADING_PATTERN = /^#{1,6}[ \t]+(.+?)[ \t]*$/m;

function extractTitle(kind: PreviewKind, content: string): string | null {
  const match =
    kind === "html"
      ? HTML_TITLE_PATTERN.exec(content)
      : MARKDOWN_HEADING_PATTERN.exec(content);
  const title = match?.[1]?.trim();
  return title && title.length > 0 ? title : null;
}

function previewKind(file: string): PreviewKind {
  const extension = path.posix.extname(file).toLowerCase();
  const kind = PREVIEW_KIND_BY_EXTENSION.get(extension);
  if (kind === undefined) {
    throw new Error(
      `"file" must end with .html, .htm, .md, or .markdown.`,
    );
  }
  return kind;
}

export function requireRelativePreviewFile(value: unknown): string {
  const file = requireNonEmptyString(value, "file");
  if (path.isAbsolute(file)) {
    throw new Error(`"file" must be source-relative, not absolute.`);
  }
  if (/^[a-zA-Z]:[\\/]/.test(file) || file.startsWith("\\\\")) {
    throw new Error(`"file" must be source-relative, not absolute.`);
  }
  const slashNormalized = file.replace(/\\/g, "/");
  if (slashNormalized.split("/").includes("..")) {
    throw new Error(`"file" must not contain traversal segments.`);
  }
  const normalized = path.posix.normalize(slashNormalized);
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized === "." ||
    normalized.startsWith("/")
  ) {
    throw new Error(`"file" must not escape its source.`);
  }
  previewKind(normalized);
  return normalized;
}

export function resolveContainedPreviewPath(
  rootPath: string,
  relativeFile: string,
): string {
  const root = path.resolve(rootPath);
  const absolute = path.resolve(root, relativeFile);
  const relative = path.relative(root, absolute);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`"file" must not escape its source.`);
  }
  return absolute;
}

function httpStatus(error: unknown): number | null {
  if (!isRecord(error)) {
    return null;
  }
  const status = error.status;
  return typeof status === "number" ? status : null;
}

const previewTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("workspace"),
      environmentId: z.string(),
      path: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("thread-storage"),
      threadId: z.string(),
      path: z.string(),
    })
    .strict(),
]);

export const canvasRpcContract = defineRpcContract({
  preparePreview: {
    input: z
      .object({
        threadId: z.string().trim().min(1),
        file: z
          .string()
          .transform((value) => requireRelativePreviewFile(value)),
        source: z
          .string()
          .trim()
          .pipe(z.enum(["workspace", "thread-storage"]))
          .default("workspace"),
      })
      .strict(),
    output: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("html"),
          file: z.string(),
          source: z.enum(["workspace", "thread-storage"]),
          target: previewTargetSchema,
          title: z.string().nullable(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("markdown"),
          file: z.string(),
          source: z.enum(["workspace", "thread-storage"]),
          target: previewTargetSchema,
          rootPath: z.string(),
          content: z.string(),
          title: z.string().nullable(),
        })
        .strict(),
    ]),
  },
});

export default async function plugin(bb: BbPluginApi) {
  bb.rpc.register(canvasRpcContract, {
    async preparePreview({ threadId, file, source }) {
      let rootPath: string;
      let hostId: string;
      let target: NonNullable<MarkdownProps["experimental_document"]>["target"];

      if (source === "thread-storage") {
        const storage = await bb.sdk.threads.storageLocation({ threadId });
        rootPath = storage.storageRootPath;
        hostId = storage.hostId;
        target = { kind: source, threadId, path: file };
      } else {
        const thread = await bb.sdk.threads.get({
          threadId,
          include: "environment",
        });

        if (!("environment" in thread)) {
          throw new Error(
            "Thread environment was not returned — canvas needs a live environment.",
          );
        }

        const environment = thread.environment;
        const workspacePath =
          typeof environment?.path === "string" ? environment.path : null;
        if (!environment || !workspacePath) {
          throw new Error(
            "This thread has no workspace path — canvas needs a live environment.",
          );
        }
        const workspaceHostId =
          typeof environment?.hostId === "string" ? environment.hostId : null;
        if (!workspaceHostId) {
          throw new Error(
            "This thread's environment has no hostId — cannot read workspace files.",
          );
        }
        rootPath = workspacePath;
        hostId = workspaceHostId;
        target = { kind: source, environmentId: environment.id, path: file };
      }

      const absolutePath = resolveContainedPreviewPath(rootPath, file);

      let result;
      try {
        result = await bb.sdk.files.read({
          path: absolutePath,
          rootPath,
          hostId,
        });
      } catch (error) {
        if (httpStatus(error) === 404) {
          throw new Error(`File not found.`);
        }
        throw error;
      }

      if (result.contentEncoding !== "utf8") {
        throw new Error(
          `Preview file is not valid UTF-8 text (encoding=${result.contentEncoding}).`,
        );
      }
      const sizeBytes = result.sizeBytes;
      if (sizeBytes > MAX_PREVIEW_BYTES) {
        throw new Error(
          `Preview file is too large (${sizeBytes} bytes; max ${MAX_PREVIEW_BYTES}).`,
        );
      }

      const kind = previewKind(file);
      const title = extractTitle(kind, result.content);
      return kind === "markdown"
        ? { kind, file, source, target, rootPath, content: result.content, title }
        : { kind, file, source, target, title };
    },
  });
}
