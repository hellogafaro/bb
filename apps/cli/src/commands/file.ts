import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, link, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import type { RawFileSource } from "@bb/sdk/node";
import { Command } from "commander";
import { action } from "../action.js";
import { cliFetch, createCliBbSdk } from "../client.js";
import { confirmDestructiveAction, outputJson } from "./helpers.js";

interface FileTargetOptions {
  host?: string;
  json?: boolean;
  root?: string;
}

interface FileReadOptions extends FileTargetOptions {
  ifNoneMatch?: string;
}

interface FileListOptions extends FileTargetOptions {
  directories?: boolean;
  exclude?: string[];
  files?: boolean;
  hidden?: boolean;
  limit?: string;
  query?: string;
}

function listFilterArgs(opts: FileListOptions): {
  includeHidden?: boolean;
  excludeNames?: string[];
} {
  return {
    ...(opts.hidden === false ? { includeHidden: false } : {}),
    ...(opts.exclude !== undefined ? { excludeNames: opts.exclude } : {}),
  };
}

interface FileWriteOptions extends FileTargetOptions {
  content?: string;
  createParents?: boolean;
  expectedSha256?: string;
  stdin?: boolean;
}

interface FileRemoveOptions extends FileTargetOptions {
  recursive?: boolean;
  yes?: boolean;
}

interface FileDownloadOptions {
  environment?: string;
  force?: boolean;
  host?: string;
  json?: boolean;
  out?: string;
  project?: string;
  source?: string;
  thread?: string;
}

const THREAD_FILE_SOURCES = {
  worktree: "worktree",
  storage: "threadStorage",
  host: "hostFile",
} as const;

function isThreadFileSource(
  value: string,
): value is keyof typeof THREAD_FILE_SOURCES {
  return Object.hasOwn(THREAD_FILE_SOURCES, value);
}

function downloadSource(
  path: string,
  opts: FileDownloadOptions,
): RawFileSource {
  if (opts.project !== undefined) {
    if (opts.thread !== undefined) {
      throw new Error("Provide exactly one of --thread or --project.");
    }
    if (opts.source !== undefined) {
      throw new Error("--source applies only to --thread downloads.");
    }
    return {
      kind: "project",
      projectId: opts.project,
      path,
      ...(opts.host ? { hostId: opts.host } : {}),
      ...(opts.environment ? { environmentId: opts.environment } : {}),
    };
  }
  if (opts.thread === undefined) {
    throw new Error("Provide exactly one of --thread or --project.");
  }
  if (opts.host !== undefined || opts.environment !== undefined) {
    throw new Error("--host and --environment apply only to --project.");
  }
  const source = opts.source ?? "worktree";
  if (!isThreadFileSource(source)) {
    throw new Error("--source must be worktree, storage, or host.");
  }
  return {
    kind: THREAD_FILE_SOURCES[source],
    threadId: opts.thread,
    path,
  };
}

async function readDownloadError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body: unknown = JSON.parse(text);
    if (
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string"
    ) {
      return body.message;
    }
  } catch {}
  return text || response.statusText;
}

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function downloadToFile(
  url: string,
  outPath: string,
  force: boolean,
): Promise<number> {
  if (!force && (await pathExists(outPath))) {
    throw new Error(`${outPath} already exists; pass --force to replace it.`);
  }
  const response = await cliFetch(url);
  if (!response.ok || response.body === null) {
    throw new Error(
      `Download failed (HTTP ${response.status}): ${await readDownloadError(response)}`,
    );
  }
  const partPath = join(
    dirname(outPath),
    `.${basename(outPath)}.${randomUUID()}.part`,
  );
  let bytes = 0;
  try {
    await pipeline(response.body, createWriteStream(partPath, { flags: "wx" }));
    bytes = (await stat(partPath)).size;
    const expected = response.headers.get("content-length");
    if (expected !== null && Number(expected) !== bytes) {
      throw new Error(
        `Download ended after ${bytes} of ${expected} bytes; the file may have changed.`,
      );
    }
    if (force) {
      await rename(partPath, outPath);
    } else {
      await link(partPath, outPath);
      await rm(partPath);
    }
  } catch (error) {
    await rm(partPath, { force: true });
    if (isErrnoCode(error, "EEXIST")) {
      throw new Error(`${outPath} already exists; pass --force to replace it.`);
    }
    throw error;
  }
  return bytes;
}

function isErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("--limit must be a positive integer.");
  }
  return parsed;
}

function commonTarget(opts: FileTargetOptions) {
  return {
    ...(opts.host ? { hostId: opts.host } : {}),
    ...(opts.root ? { rootPath: opts.root } : {}),
  };
}

export function registerFileCommands(
  program: Command,
  getUrl: () => string,
): void {
  const file = program
    .command("file")
    .description("Read and manage files on BB machines");

  file
    .command("read <path>")
    .description("Read a file")
    .option("--host <id>", "Machine ID")
    .option("--root <path>", "Confining root path")
    .option(
      "--if-none-match <sha256>",
      "Print nothing when the file's content hash still matches",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (path: string, opts: FileReadOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const result =
          opts.ifNoneMatch === undefined
            ? await sdk.files.read({ path, ...commonTarget(opts) })
            : await sdk.files.experimental_readIfChanged({
                path,
                sha256: opts.ifNoneMatch,
                ...commonTarget(opts),
              });
        if (outputJson(opts, result)) return;
        if ("notModified" in result) return;
        if (result.contentEncoding === "utf8")
          process.stdout.write(result.content);
        else process.stdout.write(`${result.content}\n`);
      }),
    );

  file
    .command("download <path>")
    .description(
      "Download a thread, thread storage, host, or project file at any size",
    )
    .option("--thread <id>", "Thread whose file to download")
    .option(
      "--source <source>",
      "Thread file source: worktree (default), storage, or host (absolute path)",
    )
    .option("--project <id>", "Project whose workspace file to download")
    .option("--host <id>", "Project machine ID")
    .option("--environment <id>", "Project environment ID")
    .option("--out <file>", "Destination file (defaults to the file name)")
    .option("--force", "Replace an existing destination file")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (path: string, opts: FileDownloadOptions) => {
        const source = downloadSource(path, opts);
        const url = createCliBbSdk(getUrl()).files.experimental_rawFileUrl({
          source,
          download: true,
        });
        const outPath = resolve(opts.out ?? basename(path));
        const bytes = await downloadToFile(url, outPath, opts.force === true);
        if (outputJson(opts, { path: outPath, sizeBytes: bytes })) return;
        console.log(`Downloaded ${bytes} bytes to ${outPath}`);
      }),
    );

  file
    .command("write <path>")
    .description("Write a UTF-8 file")
    .option("--content <text>", "File content")
    .option("--stdin", "Read file content from stdin")
    .option("--host <id>", "Machine ID")
    .option("--root <path>", "Confining root path")
    .option("--create-parents", "Create missing parent directories")
    .option(
      "--expected-sha256 <hash>",
      "Only write when the current hash matches",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (path: string, opts: FileWriteOptions) => {
        if ((opts.content === undefined) === (opts.stdin !== true)) {
          throw new Error("Provide exactly one of --content or --stdin.");
        }
        const content = opts.stdin ? await readStdin() : (opts.content ?? "");
        const result = await createCliBbSdk(getUrl()).files.write({
          path,
          content,
          ...commonTarget(opts),
          ...(opts.createParents ? { createParents: true } : {}),
          ...(opts.expectedSha256
            ? { expectedSha256: opts.expectedSha256 }
            : {}),
        });
        if (outputJson(opts, result)) return;
        console.log(
          result.outcome === "written"
            ? `Wrote ${path}`
            : `Write conflict for ${path}`,
        );
      }),
    );

  file
    .command("list <path>")
    .description("Recursively list files")
    .option("--query <query>", "Fuzzy path query")
    .option("--limit <count>", "Maximum entries")
    .option("--no-hidden", "Skip dot-prefixed files and directories")
    .option(
      "--exclude <names...>",
      "Entry names or root-relative paths (using /) to skip instead of the default set",
    )
    .option("--host <id>", "Machine ID")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (path: string, opts: FileListOptions) => {
        const result = await createCliBbSdk(getUrl()).files.list({
          path,
          ...listFilterArgs(opts),
          ...(opts.host ? { hostId: opts.host } : {}),
          ...(opts.query ? { query: opts.query } : {}),
          ...(parseLimit(opts.limit) ? { limit: parseLimit(opts.limit) } : {}),
        });
        if (outputJson(opts, result)) return;
        for (const entry of result.files) console.log(entry.path);
      }),
    );

  file
    .command("paths <path>")
    .description("List matching files and directories")
    .option("--query <query>", "Fuzzy path query")
    .option("--limit <count>", "Maximum entries")
    .option("--files", "Include files")
    .option("--directories", "Include directories")
    .option("--no-hidden", "Skip dot-prefixed files and directories")
    .option(
      "--exclude <names...>",
      "Entry names or root-relative paths (using /) to skip instead of the default set",
    )
    .option("--host <id>", "Machine ID")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (path: string, opts: FileListOptions) => {
        const includeFiles = opts.files || !opts.directories;
        const includeDirectories = opts.directories || !opts.files;
        const limit = parseLimit(opts.limit);
        const result = await createCliBbSdk(getUrl()).files.listPaths({
          path,
          includeFiles,
          includeDirectories,
          ...listFilterArgs(opts),
          ...(opts.host ? { hostId: opts.host } : {}),
          ...(opts.query ? { query: opts.query } : {}),
          ...(limit ? { limit } : {}),
        });
        if (outputJson(opts, result)) return;
        for (const entry of result.paths)
          console.log(`${entry.kind}\t${entry.path}`);
      }),
    );

  file
    .command("mkdir <path>")
    .description("Create a directory")
    .option("--recursive", "Create missing parent directories")
    .option("--host <id>", "Machine ID")
    .option("--root <path>", "Confining root path")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          path: string,
          opts: FileTargetOptions & { recursive?: boolean },
        ) => {
          const result = await createCliBbSdk(getUrl()).files.mkdir({
            path,
            ...commonTarget(opts),
            recursive: opts.recursive,
          });
          if (outputJson(opts, result)) return;
          console.log(`Created directory ${path}`);
        },
      ),
    );

  file
    .command("move <source> <destination>")
    .description("Move a file or directory")
    .option("--host <id>", "Machine ID")
    .option("--root <path>", "Confining root path")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          source: string,
          destination: string,
          opts: FileTargetOptions,
        ) => {
          const result = await createCliBbSdk(getUrl()).files.move({
            sourcePath: source,
            destinationPath: destination,
            ...commonTarget(opts),
          });
          if (outputJson(opts, result)) return;
          console.log(`Moved ${source} to ${destination}`);
        },
      ),
    );

  file
    .command("remove <path>")
    .description("Remove a file or directory")
    .option("--recursive", "Remove a directory recursively")
    .option("--yes", "Skip the confirmation prompt")
    .option("--host <id>", "Machine ID")
    .option("--root <path>", "Confining root path")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (path: string, opts: FileRemoveOptions) => {
        if (!opts.yes && !(await confirmDestructiveAction(`Remove ${path}?`)))
          return;
        const result = await createCliBbSdk(getUrl()).files.remove({
          path,
          ...commonTarget(opts),
          recursive: opts.recursive,
        });
        if (outputJson(opts, result)) return;
        console.log(`Removed ${path}`);
      }),
    );
}
