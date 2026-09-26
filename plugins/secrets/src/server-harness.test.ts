import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createSecretsPlugin, SECRETS_INSTRUCTIONS } from "./server.js";

const FAKE_INFISICAL = `#!/bin/sh
rec="$FAKE_INFISICAL_DIR"
stamp=$(date +%s%N)
printf '%s\\0' "$@" > "$rec/argv.$stamp"
cat > "$rec/stdin.$stamp"
for a in "$@"; do
  case "$a" in
    *=@*) name=\${a%%=*}; file=\${a#*=@}; cat "$file" > "$rec/value.$name" ;;
  esac
done
case "$*" in
  --version*) echo "infisical version 9.9.9"; exit 0 ;;
  "secrets folders get"*)
    case "$*" in
      *bad-project*) echo "Response Code: 404 Not Found" >&2; echo "Message: Project with bad-project not found" >&2; exit 1 ;;
    esac
    echo '[{"folderId":"f1","folderName":"api","folderPath":"/"},{"folderId":"f2","folderName":"web","folderPath":"/"}]'
    exit 0 ;;
  "secrets set"*)
    if [ -n "$FAKE_INFISICAL_FAIL" ]; then
      echo "Message: API_KEY=$(cat "$rec/value.API_KEY") was rejected by policy" >&2
      exit 1
    fi
    echo "| API_KEY | ****** | SECRET CREATED |"
    echo "| TOKEN | ****** | SECRET VALUE MODIFIED |"
    exit 0 ;;
  run*) echo "ran:$*"; echo "stderr-line" >&2; exit \${FAKE_INFISICAL_EXIT:-0} ;;
  *) echo "passthrough:$*"; exit 0 ;;
esac
`;

let binDir: string;
let home: string;
let recordDir: string;
let cwd: string;

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    HOME: home,
    FAKE_INFISICAL_DIR: recordDir,
    ...extra,
  };
}

function recordedCalls(): string[][] {
  return readdirSync(recordDir)
    .filter((name) => name.startsWith("argv."))
    .sort()
    .map((name) =>
      readFileSync(path.join(recordDir, name), "utf8").split("\0").slice(0, -1),
    );
}

function recordedStdin(): string {
  return readdirSync(recordDir)
    .filter((name) => name.startsWith("stdin."))
    .map((name) => readFileSync(path.join(recordDir, name), "utf8"))
    .join("");
}

function makeHost(overrides: Record<string, string> = {}) {
  const host = createFakePluginHost({ pluginId: "secrets" });
  createSecretsPlugin({ env: env(overrides) })(
    host.bb as unknown as Parameters<ReturnType<typeof createSecretsPlugin>>[0],
  );
  return host;
}

function linkCwd(workspaceId = "proj-123"): void {
  writeFileSync(
    path.join(cwd, ".infisical.json"),
    JSON.stringify({ workspaceId, defaultEnvironment: "dev" }),
  );
}

function loginProfile(): void {
  mkdirSync(path.join(home, ".infisical"), { recursive: true });
  writeFileSync(
    path.join(home, ".infisical", "infisical-config.json"),
    JSON.stringify({
      loggedInUserEmail: "user@example.com",
      LoggedInUserDomain: "https://app.infisical.com/api",
    }),
  );
}

beforeAll(async () => {
  binDir = await mkdtemp(path.join(os.tmpdir(), "fake-infisical-bin-"));
  writeFileSync(path.join(binDir, "infisical"), FAKE_INFISICAL, {
    mode: 0o755,
  });
});

afterAll(async () => {
  await rm(binDir, { recursive: true, force: true });
});

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "fake-home-"));
  recordDir = await mkdtemp(path.join(os.tmpdir(), "fake-record-"));
  cwd = await mkdtemp(path.join(os.tmpdir(), "fake-cwd-"));
  return async () => {
    await Promise.all(
      [home, recordDir, cwd].map((dir) =>
        rm(dir, { recursive: true, force: true }),
      ),
    );
  };
});

describe("secrets plugin instructions", () => {
  it("contributes the same two-line router every turn", () => {
    const host = makeHost();
    const provider = host.harness.registrations.instructionProvider;
    expect(provider?.({ threadId: "thr-1", projectId: "prj-1" })).toBe(
      SECRETS_INSTRUCTIONS,
    );
    expect(provider?.({ threadId: "thr-2", projectId: "prj-2" })).toBe(
      "All secrets live in Infisical. Use the `secrets` skill before reading, injecting, or writing any credential, token, key, certificate, or SSH access. Never expose a secret value anywhere.",
    );
  });
});

describe("bb secret status", () => {
  it("reports the binary, profile auth, and the linked project without values", async () => {
    loginProfile();
    linkCwd("proj-123");
    const host = makeHost();
    const result = await host.harness.runCli(["status"], { cwd });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      installed: true,
      version: "infisical version 9.9.9",
      authenticated: true,
      authMethod: "profile",
      domain: "https://app.infisical.com/api",
      linkedProjectId: "proj-123",
      projectFile: path.join(cwd, ".infisical.json"),
      missing: [],
    });
    expect(result.stdout).not.toContain("user@example.com");
  });

  it("names the missing prerequisite when nothing is authenticated or linked", async () => {
    const host = makeHost();
    const result = await host.harness.runCli(["status"], { cwd });
    expect(JSON.parse(result.stdout)).toMatchObject({
      installed: true,
      authenticated: false,
      authMethod: null,
      linkedProjectId: null,
      missing: ["an authenticated infisical profile or INFISICAL_TOKEN"],
    });
  });

  it("treats INFISICAL_TOKEN as token auth and reports a missing binary", async () => {
    const host = makeHost({ INFISICAL_TOKEN: "t", PATH: "/nonexistent-bin" });
    const result = await host.harness.runCli(["status"], { cwd });
    expect(JSON.parse(result.stdout)).toMatchObject({
      installed: false,
      version: null,
      authenticated: true,
      authMethod: "token",
      missing: ["infisical CLI on the server host"],
    });
    expect(result.stdout).not.toContain('"t"');
  });
});

describe("bb secret link", () => {
  it("verifies with a names-only folder read and writes .infisical.json", async () => {
    const host = makeHost();
    const result = await host.harness.runCli(
      ["link", "--project-id", "proj-123", "--env", "staging"],
      { cwd },
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      projectId: "proj-123",
      env: "staging",
      file: path.join(cwd, ".infisical.json"),
      folders: ["api", "web"],
    });
    expect(recordedCalls()).toEqual([
      [
        "secrets",
        "folders",
        "get",
        "--projectId",
        "proj-123",
        "--env",
        "staging",
        "--path",
        "/",
        "--output",
        "json",
        "--silent",
      ],
    ]);
    expect(
      JSON.parse(readFileSync(path.join(cwd, ".infisical.json"), "utf8")),
    ).toEqual({
      workspaceId: "proj-123",
      defaultEnvironment: "staging",
      gitBranchToEnvironmentMapping: null,
    });
  });

  it("forwards the infisical error and writes nothing when verification fails", async () => {
    const host = makeHost();
    const result = await host.harness.runCli(
      ["link", "--project-id", "bad-project", "--env", "dev", "--json"],
      { cwd },
    );
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "infisical_failed" },
    });
    expect(result.stderr).toContain("Project with bad-project not found");
    expect(existsSync(path.join(cwd, ".infisical.json"))).toBe(false);
  });

  it("refuses to relink a directory bound to another project", async () => {
    linkCwd("other");
    const host = makeHost();
    const result = await host.harness.runCli(
      ["link", "--project-id", "proj-123", "--env", "dev"],
      { cwd },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("already linked to project other");
    expect(recordedCalls()).toEqual([]);
  });
});

describe("bb secret run", () => {
  it("execs infisical run with an explicit env and path and forwards output", async () => {
    const host = makeHost({ FAKE_INFISICAL_EXIT: "3" });
    const result = await host.harness.runCli(
      [
        "run",
        "--env",
        "prod",
        "--path",
        "/api",
        "--project-id",
        "proj-9",
        "--recursive",
        "--",
        "npm",
        "start",
        "--flag",
      ],
      { cwd },
    );
    expect(result.exitCode).toBe(3);
    expect(recordedCalls()).toEqual([
      [
        "run",
        "--env",
        "prod",
        "--path",
        "/api",
        "--projectId",
        "proj-9",
        "--recursive",
        "--silent",
        "--",
        "npm",
        "start",
        "--flag",
      ],
    ]);
    expect(result.stdout).toContain("ran:run --env prod");
    expect(result.stderr).toContain("stderr-line");
  });

  it("requires --env and a command", async () => {
    const host = makeHost();
    const missingEnv = await host.harness.runCli(
      ["run", "--", "npm", "start"],
      {
        cwd,
      },
    );
    expect(missingEnv.exitCode).toBe(1);
    expect(missingEnv.stderr).toContain("missing required options: --env");
    const missingCommand = await host.harness.runCli(["run", "--env", "dev"], {
      cwd,
    });
    expect(missingCommand.exitCode).toBe(1);
    expect(missingCommand.stderr).toContain("needs a command after --");
    expect(recordedCalls()).toEqual([]);
  });
});

describe("bb secret set", () => {
  it("collects values in the form and writes them through 0600 temp files, never argv", async () => {
    linkCwd("proj-123");
    const host = makeHost();
    const command = host.harness.runCli(
      [
        "set",
        "API_KEY",
        "TOKEN",
        "--env",
        "dev",
        "--path",
        "/api",
        "--purpose",
        "Configure the API",
        "--describe",
        "API_KEY",
        "Primary API key",
      ],
      { threadId: "thr-test", cwd },
    );
    await vi.waitFor(() =>
      expect(host.harness.pendingInteractions).toHaveLength(1),
    );
    const pending = host.harness.pendingInteractions[0]!;
    expect(pending.title).toBe("Add secrets to Infisical");
    expect(pending.payload).toEqual({
      purpose: "Configure the API",
      destination: {
        kind: "infisical",
        project: "proj-123",
        env: "dev",
        path: "/api",
      },
      fields: [
        { name: "API_KEY", description: "Primary API key" },
        { name: "TOKEN", description: null },
      ],
    });
    expect(
      pending.describeSubmission?.({ values: { API_KEY: "s3cret" } }),
    ).toEqual({
      title: "Provided API_KEY",
      detail: "proj-123 dev/api\n- API_KEY",
    });
    host.harness.submitInteraction(pending.id, {
      values: { API_KEY: "secret-one", TOKEN: "secret-two" },
    });

    const result = await command;
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      project: "proj-123",
      env: "dev",
      path: "/api",
      names: ["API_KEY", "TOKEN"],
      created: ["API_KEY"],
      updated: ["TOKEN"],
      unchanged: [],
    });
    const calls = recordedCalls();
    expect(calls).toHaveLength(1);
    const argv = calls[0]!;
    expect(argv.slice(0, 9)).toEqual([
      "secrets",
      "set",
      "--env",
      "dev",
      "--path",
      "/api",
      "--projectId",
      "proj-123",
      "--silent",
    ]);
    expect(argv.join(" ")).not.toContain("secret-one");
    expect(argv.join(" ")).not.toContain("secret-two");
    expect(recordedStdin()).toBe("");
    const fileArgs = argv.slice(9);
    expect(fileArgs.map((arg) => arg.split("=@")[0])).toEqual([
      "API_KEY",
      "TOKEN",
    ]);
    for (const arg of fileArgs) {
      const file = arg.split("=@")[1]!;
      expect(path.basename(path.dirname(file))).toMatch(/^bb-secret-/u);
      expect(existsSync(file)).toBe(false);
      expect(existsSync(path.dirname(file))).toBe(false);
    }
    expect(readFileSync(path.join(recordDir, "value.API_KEY"), "utf8")).toBe(
      "secret-one",
    );
    expect(readFileSync(path.join(recordDir, "value.TOKEN"), "utf8")).toBe(
      "secret-two",
    );
    expect(result.stdout).not.toContain("secret-");
    expect(result.stderr).not.toContain("secret-");
  });

  it("strips value-looking content from forwarded infisical errors", async () => {
    const host = makeHost({ FAKE_INFISICAL_FAIL: "1" });
    const command = host.harness.runCli(
      ["set", "API_KEY", "--env", "dev", "--project-id", "proj-7"],
      { threadId: "thr-test", cwd },
    );
    await vi.waitFor(() =>
      expect(host.harness.pendingInteractions).toHaveLength(1),
    );
    host.harness.submitInteraction(host.harness.pendingInteractions[0]!.id, {
      values: { API_KEY: "hunter2-value" },
    });
    const result = await command;
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "infisical secrets set failed with exit code 1",
    );
    expect(result.stderr).toContain("Message: API_KEY=[redacted]");
    expect(result.stderr).not.toContain("hunter2-value");
    expect(result.stdout).not.toContain("hunter2-value");
  });

  it("fails before opening the form when no project is known", async () => {
    const host = makeHost();
    const result = await host.harness.runCli(
      ["set", "API_KEY", "--env", "dev", "--json"],
      { threadId: "thr-test", cwd },
    );
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "missing_project" },
    });
    expect(host.harness.pendingInteractions).toEqual([]);
    expect(recordedCalls()).toEqual([]);
  });

  it("reports a cancelled form without calling infisical", async () => {
    const host = makeHost();
    const command = host.harness.runCli(
      ["set", "API_KEY", "--env", "dev", "--project-id", "proj-7"],
      { threadId: "thr-test", cwd },
    );
    await vi.waitFor(() =>
      expect(host.harness.pendingInteractions).toHaveLength(1),
    );
    host.harness.cancelInteraction(host.harness.pendingInteractions[0]!.id);
    const result = await command;
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Secret request cancelled");
    expect(recordedCalls()).toEqual([]);
  });

  it("keeps the row label within its cap for many long secret names", async () => {
    const names = Array.from(
      { length: 12 },
      (_unused, index) => `A_VERY_LONG_SECRET_NAME_NUMBER_${index}`,
    );
    const host = makeHost();
    const command = host.harness.runCli(
      ["set", ...names, "--env", "dev", "--project-id", "proj-7"],
      { threadId: "thr-test", cwd },
    );
    await vi.waitFor(() =>
      expect(host.harness.pendingInteractions).toHaveLength(1),
    );
    const pending = host.harness.pendingInteractions[0]!;
    expect(pending.presentation?.label?.pending.length).toBeLessThanOrEqual(80);
    expect(pending.presentation?.label?.completed.length).toBeLessThanOrEqual(
      80,
    );
    host.harness.cancelInteraction(pending.id);
    await command;
  });

  it.each([
    {
      argv: ["set", "API_KEY", "--purpose", "--env", "dev"],
      message: "--purpose requires a value",
    },
    {
      argv: ["set", "API_KEY", "--describe", "API_KEY"],
      message: "missing required options: --env",
    },
    {
      argv: ["set", "--env", "dev"],
      message: "missing required arguments: <name>",
    },
    {
      argv: ["set", "API_KEY", "--env", "dev", "--describe", "OTHER=text"],
      message: "--describe references unrequested variable OTHER.",
    },
    {
      argv: ["set", "API_KEY", "API_KEY", "--env", "dev"],
      message: "Secret names must be unique.",
    },
    {
      argv: ["set", "1BAD", "--env", "dev"],
      message:
        "Secret name must start with a letter or underscore and contain only letters, digits, and underscores.",
    },
    {
      argv: ["set", "API_KEY", "--env", "dev", "--path", "api"],
      message: "--path must be an absolute folder path",
    },
    {
      argv: ["set", "API_KEY", "--env", "dev", "--write-env", ".env"],
      message: "unknown option '--write-env'",
    },
  ])(
    "reports a usage error for malformed invocation $argv",
    async ({ argv, message }) => {
      const host = makeHost();
      const result = await host.harness.runCli(argv, {
        threadId: "thr-test",
        cwd,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr.split("\n")[0]).toContain(message);
      expect(host.harness.pendingInteractions).toEqual([]);
    },
  );

  it("requires a bb thread", async () => {
    const host = makeHost();
    const result = await host.harness.runCli(
      ["set", "API_KEY", "--env", "dev", "--project-id", "p", "--json"],
      { cwd },
    );
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      error: {
        code: "missing_thread",
        message: "bb secret set must run from a bb thread.",
      },
    });
  });
});

describe("bb secret ssh and pam", () => {
  it("maps ssh onto infisical ssh connect", async () => {
    const host = makeHost();
    const result = await host.harness.runCli(
      [
        "ssh",
        "bastion.example.com",
        "--login-user",
        "deploy",
        "--out-file-path",
        "/tmp/keys",
        "--",
        "--write-host-ca-to-file=false",
      ],
      { cwd },
    );
    expect(result.exitCode).toBe(0);
    expect(recordedCalls()).toEqual([
      [
        "ssh",
        "connect",
        "--hostname",
        "bastion.example.com",
        "--login-user",
        "deploy",
        "--out-file-path",
        "/tmp/keys",
        "--write-host-ca-to-file=false",
      ],
    ]);
  });

  it("maps pam onto infisical pam access with an optional command", async () => {
    const host = makeHost();
    const result = await host.harness.runCli(
      [
        "pam",
        "servers/bastion",
        "--duration",
        "30m",
        "--reason",
        "deploy",
        "--",
        "systemctl",
        "status",
        "nginx",
      ],
      { cwd },
    );
    expect(result.exitCode).toBe(0);
    expect(recordedCalls()).toEqual([
      [
        "pam",
        "access",
        "servers/bastion",
        "--duration",
        "30m",
        "--reason",
        "deploy",
        "--",
        "systemctl",
        "status",
        "nginx",
      ],
    ]);
  });
});

describe("bb secret help", () => {
  it.each([["--help"], ["set", "--help"], ["help"]])(
    "documents %s without running anything",
    async (...argv) => {
      const host = makeHost();
      const result = await host.harness.runCli(argv, { cwd });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("bb secret");
      expect(result.stdout).not.toContain("dotenv");
      expect(recordedCalls()).toEqual([]);
    },
  );
});
