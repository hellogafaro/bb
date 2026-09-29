import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const artifacts = await mkdtemp(join(tmpdir(), "bb-webauthn-smoke-"));

try {
  console.log(`Webauthn smoke artifacts: ${artifacts}`);
  const pagePreloadPath = join(artifacts, "browser-page-preload.cjs");
  const webauthnPromptPreloadPath = join(
    artifacts,
    "webauthn-prompt-preload.cjs",
  );
  const commonPreloadOptions = {
    bundle: true,
    platform: "node",
    format: "cjs",
    conditions: ["source"],
    external: ["electron"],
    legalComments: "none",
  };
  await Promise.all([
    build({
      ...commonPreloadOptions,
      entryPoints: [join(packageRoot, "src/browser-page-preload.ts")],
      outfile: pagePreloadPath,
    }),
    build({
      ...commonPreloadOptions,
      entryPoints: [join(packageRoot, "src/webauthn-prompt-preload.ts")],
      outfile: webauthnPromptPreloadPath,
    }),
  ]);
  const fixture = join(artifacts, "fixture.cjs");
  await build({
    entryPoints: [join(packageRoot, "test/fixtures/webauthn-smoke.ts")],
    outfile: fixture,
    bundle: true,
    platform: "node",
    format: "cjs",
    conditions: ["source"],
    external: ["electron"],
    legalComments: "none",
  });
  const configPath = join(artifacts, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({ artifacts, pagePreloadPath, webauthnPromptPreloadPath }),
    { mode: 0o600 },
  );
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.DISPLAY;
  const electron = require("electron");
  if (process.platform !== "linux") {
    throw new Error(
      "This smoke pins xvfb-run for an isolated, private X display and currently only runs on Linux",
    );
  }
  const child = spawn(
    "xvfb-run",
    ["-a", electron, "--no-sandbox", fixture, configPath],
    {
      cwd: artifacts,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  const output = [];
  let outputTail = "";
  let gracefulExitTimer;
  let forcedExit = false;
  let checksFailed = false;
  function terminateGroup() {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  function capture(chunk) {
    output.push(chunk);
    process.stdout.write(chunk);
    outputTail = (outputTail + chunk.toString()).slice(-1024);
    if (outputTail.includes("BB_WEBAUTHN_SMOKE_FAILED\n")) checksFailed = true;
    if (
      (outputTail.includes("BB_WEBAUTHN_SMOKE_COMPLETE\n") ||
        outputTail.includes("BB_WEBAUTHN_SMOKE_FAILED\n")) &&
      gracefulExitTimer === undefined
    ) {
      gracefulExitTimer = setTimeout(() => {
        forcedExit = true;
        terminateGroup();
      }, 5000);
    }
  }
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  const timeout = setTimeout(() => terminateGroup(), 60_000);
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  }).finally(() => {
    clearTimeout(timeout);
    clearTimeout(gracefulExitTimer);
  });
  await writeFile(join(artifacts, "electron.log"), Buffer.concat(output));
  if (checksFailed)
    throw new Error("Webauthn smoke checks failed; see electron.log");
  if (exitCode !== 0 && !forcedExit)
    throw new Error(`Electron smoke failed with exit ${exitCode}`);
  const summary = JSON.parse(
    await readFile(join(artifacts, "result.json"), "utf8"),
  );
  if (summary.cleanupCompleted !== true)
    throw new Error("Fixture did not finish cleanup");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Screenshot: ${join(artifacts, "webauthn-prompt.png")}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`Artifacts retained at ${artifacts}`);
  process.exitCode = 1;
}
