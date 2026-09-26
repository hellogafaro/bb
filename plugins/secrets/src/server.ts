import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliContext,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import {
  SECRET_REQUEST_RENDERER_ID,
  secretNameSchema,
  secretRequestResponseSchema,
} from "@bb/plugin-interaction-contracts";
import type { InfisicalSecretRequestPayload } from "./contract.js";
import {
  InfisicalUnavailableError,
  PROJECT_FILE,
  readAuthState,
  readLinkedProject,
  runInfisical,
  withSecretFiles,
  writeLinkedProject,
  type InfisicalResult,
} from "./infisical.js";
import { redactSecretValues } from "./redaction.js";

export const SECRETS_INSTRUCTIONS =
  "All secrets live in Infisical. Use the `secrets` skill before reading, injecting, or writing any credential, token, key, certificate, or SSH access. Never expose a secret value anywhere.";

export interface SecretsPluginOptions {
  env?: NodeJS.ProcessEnv;
}

interface Scope {
  env: string;
  path: string;
  projectId: string | null;
}

const DESCRIBE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const DESCRIBE_SPELLINGS = new Set([
  "--describe",
  "--description",
  "--describe-variable",
]);
const ROW_LABEL_MAX_LENGTH = 80;
const ROW_TITLE_MAX_LENGTH = 160;

function cliError(message: string, code: string, hint?: string): never {
  throw new PluginCliError(message, {
    code,
    ...(hint === undefined ? {} : { hint }),
  });
}

function parseSecretName(value: string, label: string): string {
  const parsed = secretNameSchema.safeParse(value);
  if (!parsed.success) {
    cliError(
      `${label} must start with a letter or underscore and contain only letters, digits, and underscores.`,
      "invalid_variable_name",
    );
  }
  return parsed.data;
}

function foldDescribePairs(argv: readonly string[]): string[] {
  const folded: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    const name = argv[index + 1];
    const description = argv[index + 2];
    if (
      !DESCRIBE_SPELLINGS.has(token) ||
      name === undefined ||
      description === undefined ||
      !DESCRIBE_NAME_PATTERN.test(name) ||
      description.startsWith("--")
    ) {
      folded.push(token);
      continue;
    }
    folded.push(`--describe=${name}=${description}`);
    index += 2;
  }
  return folded;
}

function parseDescriptions(
  entries: readonly string[],
  names: readonly string[],
): Map<string, string> {
  const descriptions = new Map<string, string>();
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator <= 0) {
      cliError(
        "--describe requires NAME and DESCRIPTION.",
        "invalid_describe",
        "Write --describe NAME 'text' or --describe NAME=text.",
      );
    }
    const name = parseSecretName(
      entry.slice(0, separator).trim(),
      "--describe NAME",
    );
    const description = entry.slice(separator + 1).trim();
    if (description.length === 0) {
      cliError(
        "--describe requires NAME and DESCRIPTION.",
        "invalid_describe",
        "Write --describe NAME 'text' or --describe NAME=text.",
      );
    }
    if (descriptions.has(name))
      cliError(`Duplicate --describe for ${name}.`, "duplicate_describe");
    if (!names.includes(name)) {
      cliError(
        `--describe references unrequested variable ${name}.`,
        "unrequested_describe",
      );
    }
    descriptions.set(name, description);
  }
  return descriptions;
}

function clampToLength(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function requireCwd(ctx: PluginCliContext, command: string): string {
  if (!ctx.cwd) {
    cliError(
      `bb secret ${command} requires the invoking working directory.`,
      "missing_cwd",
    );
  }
  return ctx.cwd;
}

function parseScope(options: {
  env: string;
  path: string | undefined;
  "project-id": string | undefined;
}): Scope {
  const env = options.env.trim();
  if (env.length === 0) cliError("--env requires a value.", "invalid_env");
  const path = (options.path ?? "/").trim();
  if (!path.startsWith("/")) {
    cliError(
      "--path must be an absolute folder path such as /.",
      "invalid_path",
    );
  }
  const projectId = options["project-id"]?.trim();
  if (projectId !== undefined && projectId.length === 0)
    cliError("--project-id requires a value.", "invalid_project_id");
  return { env, path, projectId: projectId ?? null };
}

function scopeArgs(scope: Scope): string[] {
  return [
    "--env",
    scope.env,
    "--path",
    scope.path,
    ...(scope.projectId === null ? [] : ["--projectId", scope.projectId]),
  ];
}

function scopeOptions() {
  return {
    env: {
      type: "string",
      required: true,
      placeholder: "ENV",
      description:
        "Infisical environment slug (dev, staging, prod); required, never defaulted",
    },
    path: {
      type: "string",
      placeholder: "PATH",
      description: "Infisical folder path; defaults to /",
    },
    "project-id": {
      type: "string",
      placeholder: "ID",
      description:
        "Infisical project id; needed when the working directory has no .infisical.json",
    },
  } as const;
}

function recursiveOption() {
  return {
    recursive: {
      type: "boolean",
      description: "Also inject secrets from every sub-folder of --path",
    },
  } as const;
}

function jsonOption() {
  return {
    json: {
      type: "boolean",
      description:
        "Report failures as a JSON envelope on stdout; the success line is always JSON",
    },
  } as const;
}

async function resolveProject(
  cwd: string,
  explicit: string | null,
): Promise<string | null> {
  if (explicit !== null) return explicit;
  const linked = await readLinkedProject(cwd);
  return linked?.workspaceId ?? null;
}

function failFromInfisical(
  command: string,
  result: InfisicalResult,
  names: readonly string[],
): never {
  const detail = redactSecretValues(
    (result.stderr.trim() || result.stdout.trim()).trim(),
    names,
  );
  cliError(
    `infisical ${command} failed with exit code ${result.exitCode}${detail ? `:\n${detail}` : "."}`,
    "infisical_failed",
  );
}

function rethrow(error: unknown): never {
  if (error instanceof PluginCliError) throw error;
  if (error instanceof InfisicalUnavailableError)
    cliError(error.message, "infisical_unavailable");
  throw new PluginCliError(
    error instanceof Error ? error.message : String(error),
  );
}

function classifyStatuses(
  stdout: string,
  names: readonly string[],
): { created: string[]; updated: string[]; unchanged: string[] } {
  const created: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];
  const lines = stdout.split("\n");
  for (const name of names) {
    const line = lines.find((candidate) =>
      new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`, "u").test(
        candidate,
      ),
    );
    const upper = (line ?? "").toUpperCase();
    if (upper.includes("CREATED")) created.push(name);
    else if (upper.includes("UNCHANGED")) unchanged.push(name);
    else updated.push(name);
  }
  return { created, updated, unchanged };
}

export function createSecretsPlugin(options: SecretsPluginOptions = {}) {
  const processEnv = options.env ?? process.env;

  return function plugin(bb: BbPluginApi) {
    bb.agents.contributeInstructions(() => SECRETS_INSTRUCTIONS);

    async function status(ctx: PluginCliContext): Promise<PluginCliResult> {
      const cwd = requireCwd(ctx, "status");
      let installed = false;
      let version: string | null = null;
      try {
        const result = await runInfisical({
          args: ["--version"],
          cwd,
          env: processEnv,
          signal: ctx.signal,
        });
        installed = result.exitCode === 0;
        version = installed ? result.stdout.trim() : null;
      } catch (error) {
        if (!(error instanceof InfisicalUnavailableError)) rethrow(error);
      }
      const auth = await readAuthState(processEnv);
      const linked = await readLinkedProject(cwd).catch(() => null);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          installed,
          version,
          authenticated: auth.method !== null,
          authMethod: auth.method,
          domain: auth.domain,
          linkedProjectId: linked?.workspaceId ?? null,
          projectFile: linked === null ? null : `${cwd}/${PROJECT_FILE}`,
          missing: [
            ...(installed ? [] : ["infisical CLI on the server host"]),
            ...(auth.method === null
              ? ["an authenticated infisical profile or INFISICAL_TOKEN"]
              : []),
          ],
        })}\n`,
      };
    }

    async function link(
      input: { projectId: string; env: string },
      ctx: PluginCliContext,
    ): Promise<PluginCliResult> {
      const cwd = requireCwd(ctx, "link");
      const projectId = input.projectId.trim();
      if (projectId.length === 0)
        cliError("--project-id requires a value.", "invalid_project_id");
      const env = input.env.trim();
      if (env.length === 0) cliError("--env requires a value.", "invalid_env");
      const existing = await readLinkedProject(cwd);
      if (existing !== null && existing.workspaceId !== projectId) {
        cliError(
          `${cwd} is already linked to project ${existing.workspaceId}; remove ${PROJECT_FILE} to relink.`,
          "already_linked",
        );
      }
      const verify = await runInfisical({
        args: [
          "secrets",
          "folders",
          "get",
          "--projectId",
          projectId,
          "--env",
          env,
          "--path",
          "/",
          "--output",
          "json",
          "--silent",
        ],
        cwd,
        env: processEnv,
        signal: ctx.signal,
      });
      if (verify.exitCode !== 0)
        failFromInfisical("secrets folders get", verify, []);
      const folders = parseFolderNames(verify.stdout);
      const file = await writeLinkedProject(cwd, {
        workspaceId: projectId,
        defaultEnvironment: env,
      });
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({ projectId, env, file, folders })}\n`,
      };
    }

    async function run(
      scope: Scope,
      recursive: boolean,
      command: readonly string[],
      ctx: PluginCliContext,
    ): Promise<PluginCliResult> {
      const cwd = requireCwd(ctx, "run");
      if (command.length === 0) {
        cliError(
          "bb secret run needs a command after --.",
          "missing_command",
          "Write bb secret run --env dev -- npm start.",
        );
      }
      const result = await runInfisical({
        args: [
          "run",
          ...scopeArgs(scope),
          ...(recursive ? ["--recursive"] : []),
          "--silent",
          "--",
          ...command,
        ],
        cwd,
        env: processEnv,
        signal: ctx.signal,
      });
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }

    async function set(
      input: {
        names: readonly string[];
        scope: Scope;
        purpose: string | undefined;
        describe: readonly string[];
      },
      ctx: PluginCliContext,
    ): Promise<PluginCliResult> {
      const names = input.names.map((name) =>
        parseSecretName(name, "Secret name"),
      );
      if (new Set(names).size !== names.length)
        cliError("Secret names must be unique.", "duplicate_variable_name");
      const purpose = input.purpose?.trim();
      if (purpose !== undefined && purpose.length === 0) {
        cliError(
          "--purpose requires a non-empty description.",
          "invalid_purpose",
          "Write --purpose 'why these credentials are needed'.",
        );
      }
      const descriptions = parseDescriptions(input.describe, names);
      if (!ctx.threadId)
        cliError("bb secret set must run from a bb thread.", "missing_thread");
      const cwd = requireCwd(ctx, "set");
      const projectId = await resolveProject(cwd, input.scope.projectId);
      if (projectId === null) {
        cliError(
          `No ${PROJECT_FILE} in ${cwd}; pass --project-id or run bb secret link.`,
          "missing_project",
        );
      }
      const scope: Scope = { ...input.scope, projectId };
      const payload: InfisicalSecretRequestPayload = {
        purpose: purpose ?? null,
        destination: {
          kind: "infisical",
          project: projectId,
          env: scope.env,
          path: scope.path,
        },
        fields: names.map((name) => ({
          name,
          description: descriptions.get(name) ?? null,
        })),
      };
      const scopeLabel = `${projectId} ${scope.env}${scope.path}`;
      const result = await bb.ui.requestInput(
        {
          threadId: ctx.threadId,
          rendererId: SECRET_REQUEST_RENDERER_ID,
          title: "Add secrets to Infisical",
          payload,
          presentation: {
            label: {
              pending: clampToLength(
                `Requesting ${names.join(", ")}`,
                ROW_LABEL_MAX_LENGTH,
              ),
              completed: clampToLength(
                `Requested ${names.join(", ")}`,
                ROW_LABEL_MAX_LENGTH,
              ),
            },
          },
          describeSubmission: (value) => {
            const response = secretRequestResponseSchema.safeParse(value);
            const provided = response.success
              ? Object.keys(response.data.values).sort()
              : [];
            return {
              title: clampToLength(
                `Provided ${provided.join(", ")}`,
                ROW_TITLE_MAX_LENGTH,
              ),
              detail: [scopeLabel, ...provided.map((name) => `- ${name}`)].join(
                "\n",
              ),
            };
          },
        },
        { signal: ctx.signal },
      );
      if (result.outcome === "cancelled") {
        cliError(
          `Secret request cancelled (${result.reason}).`,
          "secret_request_cancelled",
        );
      }
      const response = secretRequestResponseSchema.parse(result.value);
      const responseNames = Object.keys(response.values).sort();
      if (responseNames.join("\0") !== [...names].sort().join("\0")) {
        cliError(
          "Secret response did not contain exactly the requested variables.",
          "unexpected_secret_response",
        );
      }
      const written = await withSecretFiles(response.values, (files) =>
        runInfisical({
          args: [
            "secrets",
            "set",
            ...scopeArgs(scope),
            "--silent",
            ...names.map((name) => `${name}=@${files.get(name) ?? ""}`),
          ],
          cwd,
          env: processEnv,
          signal: ctx.signal,
        }),
      );
      if (written.exitCode !== 0)
        failFromInfisical("secrets set", written, names);
      const statuses = classifyStatuses(written.stdout, names);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          project: projectId,
          env: scope.env,
          path: scope.path,
          names,
          ...statuses,
        })}\n`,
      };
    }

    async function passthrough(
      args: readonly string[],
      ctx: PluginCliContext,
      command: string,
    ): Promise<PluginCliResult> {
      const cwd = requireCwd(ctx, command);
      const result = await runInfisical({
        args,
        cwd,
        env: processEnv,
        signal: ctx.signal,
      });
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }

    const cli = defineCli({
      name: "secret",
      summary:
        "Use Infisical for every secret: status, link, run, set, ssh, pam.",
      description:
        "Wraps the infisical CLI on the server host. Values are never accepted on argv, never printed, and never kept in the transcript; the set form is typed by the user.",
      commands: {
        status: cliCommand({
          summary:
            "Report whether infisical is installed and authenticated and which project the working directory links to.",
          options: jsonOption(),
          run: (_input, ctx) => status(ctx).catch(rethrow),
        }),
        link: cliCommand({
          summary:
            "Link the working directory to an Infisical project by writing .infisical.json after a names-only verification read.",
          options: {
            "project-id": {
              type: "string",
              required: true,
              placeholder: "ID",
              description: "Infisical project id to link",
            },
            env: {
              type: "string",
              required: true,
              placeholder: "ENV",
              description:
                "Environment slug used to verify access and stored as the link's default",
            },
            ...jsonOption(),
          },
          run: (input, ctx) =>
            link(
              {
                projectId: input.options["project-id"],
                env: input.options.env,
              },
              ctx,
            ).catch(rethrow),
        }),
        run: cliCommand({
          summary:
            "Run a command with secrets injected as environment variables via infisical run.",
          description:
            "Everything after -- is the command. Output is the command's own output; secrets are never printed by bb.",
          passthrough: true,
          options: { ...scopeOptions(), ...recursiveOption() },
          run: (input, ctx) =>
            run(
              parseScope(input.options),
              input.options.recursive,
              input.passthrough,
              ctx,
            ).catch(rethrow),
        }),
        set: cliCommand({
          summary:
            "Ask the user for secret values in a masked form and write them to Infisical.",
          description:
            "Batch every known name into one request. The form shows the project, environment, and folder path. Values travel from the form to infisical through 0600 temp files that are deleted immediately.",
          positionals: [
            {
              name: "name",
              description:
                "Secret name (letters, digits, underscores; must not start with a digit); repeat for each secret",
              required: true,
              variadic: true,
            },
          ],
          options: {
            ...scopeOptions(),
            purpose: {
              type: "string",
              placeholder: "TEXT",
              aliases: ["reason", "why"],
              description:
                "One line telling the user why these credentials are needed",
            },
            describe: {
              type: "string",
              repeatable: true,
              placeholder: "NAME=TEXT",
              aliases: ["description", "describe-variable"],
              description:
                "Short description of one requested secret, written as NAME=TEXT or as the two-token form NAME TEXT; repeat per secret",
            },
            ...jsonOption(),
          },
          run: (input, ctx) =>
            set(
              {
                names: input.positionals.name,
                scope: parseScope(input.options),
                purpose: input.options.purpose,
                describe: input.options.describe,
              },
              ctx,
            ).catch(rethrow),
        }),
        ssh: cliCommand({
          summary:
            "Issue SSH credentials for a host through infisical ssh connect.",
          description:
            "Interactive sessions need the host's TTY, which bb does not provide; use --out-file-path to issue credentials for your own ssh client. Extra infisical flags go after --.",
          passthrough: true,
          positionals: [
            {
              name: "host",
              description: "Hostname of the SSH host",
              required: true,
            },
          ],
          options: {
            "login-user": {
              type: "string",
              placeholder: "USER",
              description: "Login user for the SSH connection",
            },
            "out-file-path": {
              type: "string",
              placeholder: "PATH",
              description:
                "Write the issued credentials there instead of opening an interactive session",
            },
          },
          run: (input, ctx) =>
            passthrough(
              [
                "ssh",
                "connect",
                "--hostname",
                input.positionals.host,
                ...(input.options["login-user"] === undefined
                  ? []
                  : ["--login-user", input.options["login-user"]]),
                ...(input.options["out-file-path"] === undefined
                  ? []
                  : ["--out-file-path", input.options["out-file-path"]]),
                ...input.passthrough,
              ],
              ctx,
              "ssh",
            ).catch(rethrow),
        }),
        pam: cliCommand({
          summary:
            "Open a PAM session for folder/account through infisical pam access.",
          description:
            "Interactive shells need the host's TTY, which bb does not provide; pass a command after -- to run it and exit.",
          passthrough: true,
          positionals: [
            {
              name: "target",
              description: "PAM account path in the form folder/account-name",
              required: true,
            },
          ],
          options: {
            duration: {
              type: "string",
              placeholder: "DURATION",
              description: "Session duration such as 30m or 2h",
            },
            reason: {
              type: "string",
              placeholder: "TEXT",
              description: "Reason for access, stored for audit",
            },
          },
          run: (input, ctx) =>
            passthrough(
              [
                "pam",
                "access",
                input.positionals.target,
                ...(input.options.duration === undefined
                  ? []
                  : ["--duration", input.options.duration]),
                ...(input.options.reason === undefined
                  ? []
                  : ["--reason", input.options.reason]),
                ...(input.passthrough.length === 0
                  ? []
                  : ["--", ...input.passthrough]),
              ],
              ctx,
              "pam",
            ).catch(rethrow),
        }),
      },
    });
    bb.cli.register({
      ...cli,
      run: (argv, ctx) => cli.run(foldDescribePairs(argv), ctx),
    });
  };
}

function parseFolderNames(stdout: string): string[] {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) =>
      typeof entry === "object" &&
      entry !== null &&
      "folderName" in entry &&
      typeof entry.folderName === "string"
        ? [entry.folderName]
        : [],
    );
  } catch {
    return [];
  }
}

export default createSecretsPlugin();
