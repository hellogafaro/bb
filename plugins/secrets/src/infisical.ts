import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

export const INFISICAL_BINARY = "infisical";
export const PROJECT_FILE = ".infisical.json";
const OUTPUT_LIMIT = 64 * 1024;

export interface InfisicalInvocation {
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal | undefined;
}

export interface InfisicalResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class InfisicalUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InfisicalUnavailableError";
  }
}

function tail(text: string): string {
  return text.length <= OUTPUT_LIMIT ? text : text.slice(-OUTPUT_LIMIT);
}

export function runInfisical(
  invocation: InfisicalInvocation,
): Promise<InfisicalResult> {
  if (!existsSync(invocation.cwd)) {
    return Promise.reject(
      new InfisicalUnavailableError(
        `Working directory ${invocation.cwd} does not exist on the server host; bb secret runs infisical on the server.`,
      ),
    );
  }
  return new Promise((resolve, reject) => {
    const child = spawn(INFISICAL_BINARY, [...invocation.args], {
      cwd: invocation.cwd,
      env: invocation.env,
      stdio: ["ignore", "pipe", "pipe"],
      ...(invocation.signal === undefined ? {} : { signal: invocation.signal }),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = tail(stdout + chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = tail(stderr + chunk);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(
          new InfisicalUnavailableError(
            "The infisical CLI is not installed on the server host or not on PATH.",
          ),
        );
        return;
      }
      if (error.name === "AbortError") {
        reject(new InfisicalUnavailableError("infisical was interrupted."));
        return;
      }
      reject(error);
    });
    child.on("close", (code, signal) => {
      resolve({
        exitCode: code ?? (signal === null ? 1 : 128),
        stdout,
        stderr,
      });
    });
  });
}

const projectFileSchema = z.object({
  workspaceId: z.string().min(1),
  defaultEnvironment: z.string().optional(),
});

export async function readLinkedProject(
  cwd: string,
): Promise<{ workspaceId: string; defaultEnvironment: string | null } | null> {
  let raw: string;
  try {
    raw = await readFile(path.join(cwd, PROJECT_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const parsed = projectFileSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`${PROJECT_FILE} in ${cwd} is not a valid Infisical link.`);
  }
  return {
    workspaceId: parsed.data.workspaceId,
    defaultEnvironment: parsed.data.defaultEnvironment || null,
  };
}

export async function writeLinkedProject(
  cwd: string,
  args: { workspaceId: string; defaultEnvironment: string },
): Promise<string> {
  const file = path.join(cwd, PROJECT_FILE);
  await writeFile(
    file,
    `${JSON.stringify(
      {
        workspaceId: args.workspaceId,
        defaultEnvironment: args.defaultEnvironment,
        gitBranchToEnvironmentMapping: null,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return file;
}

export async function withSecretFiles<T>(
  values: Readonly<Record<string, string>>,
  use: (filesByName: ReadonlyMap<string, string>) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bb-secret-"));
  try {
    const files = new Map<string, string>();
    for (const [name, value] of Object.entries(values)) {
      const file = path.join(dir, name);
      await writeFile(file, value, { encoding: "utf8", mode: 0o600 });
      files.set(name, file);
    }
    return await use(files);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function profileConfigPath(env: NodeJS.ProcessEnv): string {
  const home = env.HOME ?? os.homedir();
  return path.join(home, ".infisical", "infisical-config.json");
}

const profileSchema = z.object({
  loggedInUserEmail: z.string().optional(),
  LoggedInUserDomain: z.string().optional(),
});

export async function readAuthState(
  env: NodeJS.ProcessEnv,
): Promise<{ method: "token" | "profile" | null; domain: string | null }> {
  if (env.INFISICAL_TOKEN) {
    return { method: "token", domain: env.INFISICAL_DOMAIN ?? null };
  }
  try {
    const raw = await readFile(profileConfigPath(env), "utf8");
    const parsed = profileSchema.safeParse(JSON.parse(raw));
    if (parsed.success && parsed.data.loggedInUserEmail) {
      return {
        method: "profile",
        domain: parsed.data.LoggedInUserDomain || null,
      };
    }
  } catch {}
  return { method: null, domain: null };
}
