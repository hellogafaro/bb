import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { agentHandle, type Agent } from "@bb/domain";
import type { ServerLogger } from "../../types.js";

const exec = promisify(execFile);

const AGENT_HOMES_DIR_NAME = "agents";
const DELETED_DIR_NAME = ".deleted";
const AGENT_SKILLS_DIR_NAME = "skills";
const GITIGNORE_CONTENT = `${DELETED_DIR_NAME}/\n`;
const DEFAULT_GIT_NAME = "BB";
const DEFAULT_GIT_EMAIL = "bb@localhost";

export const AGENT_HOME_ENV_NAME = "BB_AGENT_HOME";
export const AGENT_HOME_INSTRUCTION = `Your home folder is $${AGENT_HOME_ENV_NAME}. Keep your notes, inventories, scripts, and reference files there; it persists across threads and projects.`;

export function agentHomesRootPath(dataDir: string): string {
  return path.join(dataDir, AGENT_HOMES_DIR_NAME);
}

export function agentHomeSlug(name: string): string {
  return agentHandle(name);
}

export function agentHomePath(
  dataDir: string,
  agent: Pick<Agent, "name">,
): string {
  return path.join(agentHomesRootPath(dataDir), agentHomeSlug(agent.name));
}

export function agentSkillsRootPath(
  dataDir: string,
  agent: Pick<Agent, "name">,
): string {
  return path.join(agentHomePath(dataDir, agent), AGENT_SKILLS_DIR_NAME);
}

export function ensureAgentHome(
  dataDir: string,
  agent: Pick<Agent, "name">,
): string {
  const homePath = agentHomePath(dataDir, agent);
  fs.mkdirSync(homePath, { recursive: true });
  return homePath;
}

export function renameAgentHome(
  dataDir: string,
  args: { from: Pick<Agent, "name">; to: Pick<Agent, "name"> },
): string {
  const fromPath = agentHomePath(dataDir, args.from);
  const toPath = agentHomePath(dataDir, args.to);
  if (
    fromPath !== toPath &&
    fs.existsSync(fromPath) &&
    !fs.existsSync(toPath)
  ) {
    fs.renameSync(fromPath, toPath);
  }
  return ensureAgentHome(dataDir, args.to);
}

export function retireAgentHome(
  dataDir: string,
  agent: Pick<Agent, "name">,
  now: Date = new Date(),
): string | null {
  const homePath = agentHomePath(dataDir, agent);
  if (!fs.existsSync(homePath)) return null;
  const deletedRoot = path.join(agentHomesRootPath(dataDir), DELETED_DIR_NAME);
  fs.mkdirSync(deletedRoot, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/gu, "-");
  const target = path.join(
    deletedRoot,
    `${agentHomeSlug(agent.name)}-${stamp}`,
  );
  fs.renameSync(homePath, target);
  return target;
}

const gitQueues = new Map<string, Promise<void>>();

function enqueueGit<T>(root: string, work: () => Promise<T>): Promise<T> {
  const previous = gitQueues.get(root) ?? Promise.resolve();
  const next = previous.then(work, work);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  gitQueues.set(root, settled);
  void settled.then(() => {
    if (gitQueues.get(root) === settled) gitQueues.delete(root);
  });
  return next;
}

async function git(root: string, args: readonly string[]): Promise<string> {
  const { stdout } = await exec("git", [...args], {
    cwd: root,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

async function hasGitIdentity(root: string): Promise<boolean> {
  try {
    await git(root, ["config", "user.email"]);
    return true;
  } catch {
    return false;
  }
}

async function ensureRepo(root: string): Promise<void> {
  fs.mkdirSync(root, { recursive: true });
  const gitignorePath = path.join(root, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, GITIGNORE_CONTENT);
  }
  if (fs.existsSync(path.join(root, ".git"))) return;
  await git(root, ["init", "--quiet"]);
  if (!(await hasGitIdentity(root))) {
    await git(root, ["config", "user.name", DEFAULT_GIT_NAME]);
    await git(root, ["config", "user.email", DEFAULT_GIT_EMAIL]);
  }
  await git(root, ["add", "--", ".gitignore"]);
  await git(root, ["commit", "--quiet", "-m", "Initialize agent homes"]);
}

export function ensureAgentHomesRepo(dataDir: string): Promise<void> {
  const root = agentHomesRootPath(dataDir);
  return enqueueGit(root, () => ensureRepo(root));
}

async function isKnownPath(root: string, pathspec: string): Promise<boolean> {
  if (fs.existsSync(path.join(root, pathspec))) return true;
  const tracked = await git(root, ["ls-files", "--", pathspec]);
  return tracked.trim().length > 0;
}

async function commitPaths(
  root: string,
  candidates: readonly string[],
  message: string,
): Promise<boolean> {
  await ensureRepo(root);
  const pathspecs: string[] = [];
  for (const candidate of candidates) {
    if (await isKnownPath(root, candidate)) pathspecs.push(candidate);
  }
  if (pathspecs.length === 0) return false;
  const status = await git(root, ["status", "--porcelain", "--", ...pathspecs]);
  if (status.trim().length === 0) return false;
  await git(root, ["add", "-A", "--", ...pathspecs]);
  const staged = await git(root, [
    "diff",
    "--cached",
    "--name-only",
    "--",
    ...pathspecs,
  ]);
  if (staged.trim().length === 0) return false;
  await git(root, ["commit", "--quiet", "-m", message, "--", ...pathspecs]);
  return true;
}

export function commitAgentHome(
  dataDir: string,
  args: { slugs: readonly string[]; message: string },
): Promise<boolean> {
  const root = agentHomesRootPath(dataDir);
  return enqueueGit(root, () => commitPaths(root, args.slugs, args.message));
}

export function commitAgentHomeAfterTurn(
  dataDir: string,
  args: {
    agent: Pick<Agent, "name">;
    threadId: string;
    threadTitle: string | null;
  },
): Promise<boolean> {
  if (!fs.existsSync(agentHomePath(dataDir, args.agent))) {
    return Promise.resolve(false);
  }
  const title = args.threadTitle?.trim() || "Untitled thread";
  return commitAgentHome(dataDir, {
    slugs: [agentHomeSlug(args.agent.name)],
    message: `${args.agent.name}: ${title} (${args.threadId})`,
  });
}

export function commitAgentHomeBestEffort(
  deps: { dataDir: string; logger: Pick<ServerLogger, "warn"> },
  args: { slugs: readonly string[]; message: string },
): void {
  void commitAgentHome(deps.dataDir, args).catch((error: unknown) => {
    deps.logger.warn(
      { err: error, slugs: args.slugs },
      "Agent home commit failed",
    );
  });
}
