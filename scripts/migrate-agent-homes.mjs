#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const AGENTS = ["dexter", "cody", "sidekick"];
const SKIPPED_TOP_LEVEL = new Set([
  "AGENT.md",
  ".bb",
  ".infisical.json",
  ".git",
]);
const COMMIT_MESSAGE = "Migrate agent homes from ~/agents";

function parseArgs(argv) {
  const options = {
    dryRun: false,
    sourceRoot: path.join(os.homedir(), "agents"),
    dataDir: process.env.BB_DATA_DIR || path.join(os.homedir(), ".bb"),
    bb: "bb",
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--source-root") options.sourceRoot = path.resolve(next());
    else if (arg === "--data-dir") options.dataDir = path.resolve(next());
    else if (arg === "--bb") options.bb = next();
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/migrate-agent-homes.mjs [--dry-run] [--source-root <dir>] [--data-dir <dir>] [--bb <bb binary>]",
      );
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function sameContent(left, right) {
  const leftStat = fs.statSync(left);
  const rightStat = fs.statSync(right);
  if (leftStat.size !== rightStat.size) return false;
  return fs.readFileSync(left).equals(fs.readFileSync(right));
}

function planTree(sourceDir, targetDir, relative, skipTopLevel, plan) {
  const currentSource = path.join(sourceDir, relative);
  for (const entry of fs.readdirSync(currentSource, { withFileTypes: true })) {
    if (relative === "" && skipTopLevel.has(entry.name)) continue;
    const childRelative = path.join(relative, entry.name);
    const source = path.join(sourceDir, childRelative);
    const target = path.join(targetDir, childRelative);
    if (entry.isDirectory()) {
      planTree(sourceDir, targetDir, childRelative, new Set(), plan);
      continue;
    }
    if (entry.isSymbolicLink()) {
      plan.skipped.push({ source, reason: "symlink" });
      continue;
    }
    if (!entry.isFile()) {
      plan.skipped.push({ source, reason: "not a regular file" });
      continue;
    }
    if (!fs.existsSync(target)) plan.copies.push({ source, target });
    else if (sameContent(source, target)) plan.unchanged.push(target);
    else plan.conflicts.push({ source, target });
  }
}

function bbAgent(options, name) {
  try {
    const stdout = execFileSync(options.bb, ["agent", "show", name, "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: "found", agent: JSON.parse(stdout) };
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    if (/not found|agent_not_found/iu.test(output)) {
      return { status: "missing" };
    }
    return {
      status: "unavailable",
      message: (output.trim() || error.message).split("\n")[0],
    };
  }
}

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function hasGitIdentity(root) {
  try {
    git(root, ["config", "user.email"]);
    return true;
  } catch {
    return false;
  }
}

function ensureRepo(root) {
  fs.mkdirSync(root, { recursive: true });
  const gitignore = path.join(root, ".gitignore");
  if (!fs.existsSync(gitignore)) fs.writeFileSync(gitignore, ".deleted/\n");
  if (fs.existsSync(path.join(root, ".git"))) return;
  git(root, ["init", "--quiet"]);
  if (!hasGitIdentity(root)) {
    git(root, ["config", "user.name", "BB"]);
    git(root, ["config", "user.email", "bb@localhost"]);
  }
  git(root, ["add", "--", ".gitignore"]);
  git(root, ["commit", "--quiet", "-m", "Initialize agent homes"]);
}

function planAgent(options, name) {
  const sourceDir = path.join(options.sourceRoot, name);
  const homeDir = path.join(options.dataDir, "agents", name);
  if (!fs.existsSync(sourceDir)) {
    return { name, skip: `source folder ${sourceDir} is missing` };
  }
  const lookup = bbAgent(options, name);
  if (lookup.status === "missing") {
    return { name, skip: `BB has no agent named "${name}"` };
  }
  const files = { copies: [], unchanged: [], conflicts: [], skipped: [] };
  planTree(sourceDir, homeDir, "", SKIPPED_TOP_LEVEL, files);
  const skills = { copies: [], unchanged: [], conflicts: [], skipped: [] };
  const skillsSource = path.join(sourceDir, ".bb", "skills");
  if (fs.existsSync(skillsSource)) {
    planTree(skillsSource, path.join(homeDir, "skills"), "", new Set(), skills);
  }
  const agentFile = path.join(sourceDir, "AGENT.md");
  let instructions;
  if (lookup.status === "unavailable") {
    instructions = { action: "unknown", reason: lookup.message };
  } else if (lookup.agent.instructions.trim().length > 0) {
    instructions = { action: "keep", reason: "BB instructions are not empty" };
  } else if (!fs.existsSync(agentFile)) {
    instructions = { action: "keep", reason: "no AGENT.md" };
  } else {
    instructions = { action: "set", file: agentFile };
  }
  const skillNames = fs.existsSync(skillsSource)
    ? fs
        .readdirSync(skillsSource, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : [];
  return { name, homeDir, files, skills, skillNames, instructions };
}

function printPlan(plan, dryRun) {
  console.log(`\n${plan.name}`);
  if (plan.skip) {
    console.log(`  skipped: ${plan.skip}`);
    return;
  }
  const verb = dryRun ? "would copy" : "copied";
  console.log(`  home: ${plan.homeDir}`);
  console.log(
    `  files: ${verb} ${plan.files.copies.length}, unchanged ${plan.files.unchanged.length}`,
  );
  console.log(
    `  skills: ${verb} ${plan.skills.copies.length} files for ${plan.skillNames.length} skills${plan.skillNames.length > 0 ? ` (${plan.skillNames.join(", ")})` : ""}`,
  );
  for (const conflict of [...plan.files.conflicts, ...plan.skills.conflicts]) {
    console.log(`  conflict (kept target): ${conflict.target}`);
  }
  for (const skipped of [...plan.files.skipped, ...plan.skills.skipped]) {
    console.log(`  skipped ${skipped.reason}: ${skipped.source}`);
  }
  const { instructions } = plan;
  if (instructions.action === "set") {
    console.log(
      `  instructions: ${dryRun ? "would set" : "set"} from ${instructions.file}`,
    );
  } else if (instructions.action === "unknown") {
    console.log(
      `  instructions: warning, could not read the BB agent (${instructions.reason}); left unchanged`,
    );
  } else {
    console.log(`  instructions: unchanged (${instructions.reason})`);
  }
}

function applyPlan(options, plan) {
  for (const { source, target } of [
    ...plan.files.copies,
    ...plan.skills.copies,
  ]) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(target, fs.statSync(source).mode & 0o777);
  }
  fs.mkdirSync(plan.homeDir, { recursive: true });
  if (plan.instructions.action === "set") {
    execFileSync(
      options.bb,
      [
        "agent",
        "set",
        plan.name,
        "instructions",
        "--instructions-file",
        plan.instructions.file,
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const agentsRoot = path.join(options.dataDir, "agents");
  console.log(
    `${options.dryRun ? "Dry run: " : ""}migrating ${options.sourceRoot}/{${AGENTS.join(",")}} into ${agentsRoot}`,
  );
  const plans = AGENTS.map((name) => planAgent(options, name));
  const migrated = plans.filter((plan) => !plan.skip);
  if (!options.dryRun) {
    for (const plan of migrated) applyPlan(options, plan);
  }
  for (const plan of plans) printPlan(plan, options.dryRun);

  const slugs = migrated.map((plan) => plan.name);
  if (slugs.length === 0) {
    console.log("\nNothing to commit.");
    return;
  }
  const copied = migrated.some(
    (plan) => plan.files.copies.length + plan.skills.copies.length > 0,
  );
  if (options.dryRun) {
    console.log(
      `\ncommit: ${copied ? `would commit "${COMMIT_MESSAGE}"` : "nothing new to commit"} in ${agentsRoot}${fs.existsSync(path.join(agentsRoot, ".git")) ? "" : " (would initialize the repo first)"}`,
    );
    return;
  }
  ensureRepo(agentsRoot);
  git(agentsRoot, ["add", "-A", "--", ...slugs]);
  const staged = git(agentsRoot, [
    "diff",
    "--cached",
    "--name-only",
    "--",
    ...slugs,
  ]).trim();
  if (staged.length === 0) {
    console.log("\ncommit: nothing new to commit");
    return;
  }
  git(agentsRoot, ["commit", "--quiet", "-m", COMMIT_MESSAGE, "--", ...slugs]);
  console.log(
    `\ncommit: "${COMMIT_MESSAGE}" (${staged.split("\n").length} files) in ${agentsRoot}`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
