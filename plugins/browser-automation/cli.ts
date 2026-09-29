import {
  PluginCliError,
  cliCommand,
  defineCli,
  type PluginCliContext,
  type PluginCliRegistration,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import type { z } from "zod";
import type { rpcContract } from "./contracts.js";

export type BrowserCliMethod =
  | "open"
  | "list"
  | "run"
  | "do"
  | "pages"
  | "screenshot"
  | "preview"
  | "fillLogin"
  | "stop"
  | "close";

export interface BrowserCliInput {
  threadId: string;
  sessionId?: string;
  selection?: z.input<typeof rpcContract.open.input>["selection"];
  script?: string;
  timeoutMs?: number;
  page?: string;
  afterSequence?: number;
  goal?: string;
  maxSteps?: number;
  usernameSelector?: string;
  passwordSelector?: string;
  otpSelector?: string;
  submitSelector?: string;
  label?: string;
}

export interface BrowserCliRequest {
  method: BrowserCliMethod;
  input: BrowserCliInput;
  scriptFile?: string;
  scriptHost?: string;
}

const SESSION_POSITIONAL = {
  name: "session-id",
  description: "Session id returned by `bb browser-automation open`",
  required: true,
} as const;

const THREAD_OPTION = {
  type: "string",
  placeholder: "id",
  description:
    "Thread that owns the session; defaults to the invoking thread and cannot name another",
} as const;

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

const REOPEN_HINT =
  "Open a new session with `bb browser-automation open --backend <desktop|local> --machine <host-id>`.";

function resolveThreadId(
  option: string | undefined,
  ctx: PluginCliContext,
): string {
  const threadId = option ?? ctx.threadId;
  if (threadId === undefined || threadId === "") {
    throw new PluginCliError("Run from a BB thread or pass --thread <id>", {
      code: "thread_required",
    });
  }
  if (ctx.threadId !== undefined && threadId !== ctx.threadId) {
    throw new PluginCliError(
      "CLI calls from a thread cannot access another thread's browser session",
      { code: "cross_thread" },
    );
  }
  return threadId;
}

export function createBrowserAutomationCli(deps: {
  execute(
    request: BrowserCliRequest,
    ctx: PluginCliContext,
  ): Promise<PluginCliResult>;
}): PluginCliRegistration {
  return defineCli({
    name: "browser-automation",
    summary: "Persistent DevBrowser desktop and headless sessions",
    description:
      "Sessions belong to the thread that opened them and expire after 30 minutes idle.\nA stopped or expired session cannot be resumed; open a new one.",
    commands: {
      open: cliCommand({
        summary:
          "Open an isolated desktop or local headless session; --tab hands off an existing tab",
        options: {
          backend: {
            type: "enum",
            values: ["desktop", "local"],
            required: true,
            description:
              "desktop drives a connected browser instance; local runs headless on the host",
          },
          machine: {
            type: "string",
            required: true,
            placeholder: "name-or-id",
            description:
              "Host that runs the browser: exact ID or unambiguous name",
          },
          desktop: {
            type: "string",
            placeholder: "instance-id",
            description: "Desktop instance to drive (desktop backend only)",
          },
          tab: {
            type: "string",
            placeholder: "tab-id",
            description:
              "Existing desktop tab to control instead of opening one (desktop backend only)",
          },
          headless: {
            type: "boolean",
            description: "Required by the local backend, rejected by desktop",
          },
          thread: THREAD_OPTION,
          json: JSON_OPTION,
        },
        run(input, ctx) {
          const threadId = resolveThreadId(input.options.thread, ctx);
          const hostId = input.options.machine;
          if (input.options.backend === "local") {
            if (
              !input.options.headless ||
              input.options.desktop !== undefined ||
              input.options.tab !== undefined
            ) {
              throw new PluginCliError(
                "Local sessions require --headless and cannot select desktop tabs",
                { code: "invalid_selection" },
              );
            }
            return deps.execute(
              {
                method: "open",
                input: { threadId, selection: { backend: "local", hostId } },
              },
              ctx,
            );
          }
          const instanceId = input.options.desktop;
          if (instanceId === undefined || input.options.headless) {
            throw new PluginCliError(
              "Desktop sessions require --desktop <instance-id> and cannot use --headless",
              { code: "invalid_selection" },
            );
          }
          return deps.execute(
            {
              method: "open",
              input: {
                threadId,
                selection: {
                  backend: "desktop",
                  hostId,
                  instanceId,
                  ...(input.options.tab === undefined
                    ? {}
                    : { tabId: input.options.tab }),
                },
              },
            },
            ctx,
          );
        },
      }),
      list: cliCommand({
        summary: "List this thread's browser sessions",
        options: { thread: THREAD_OPTION, json: JSON_OPTION },
        run: (input, ctx) =>
          deps.execute(
            {
              method: "list",
              input: { threadId: resolveThreadId(input.options.thread, ctx) },
            },
            ctx,
          ),
      }),
      run: cliCommand({
        summary: "Run a trusted DevBrowser script; runs serialize per session",
        description:
          "Scripts may return at most 4 screenshots per run, JPEG only, 500 KB combined;\nanything larger or in another format fails the run.",
        positionals: [SESSION_POSITIONAL],
        constraints: [
          { kind: "exactly-one", options: ["script", "script-file"] },
          { kind: "requires", option: "script-file", needs: ["script-host"] },
          { kind: "requires", option: "script-host", needs: ["script-file"] },
          { kind: "at-most-one", options: ["timeout", "timeout-ms"] },
        ],
        options: {
          script: {
            type: "string",
            placeholder: "code",
            description: "DevBrowser script source",
          },
          "script-file": {
            type: "string",
            placeholder: "path",
            description: "File holding the script, read from --script-host",
          },
          "script-host": {
            type: "string",
            placeholder: "host-id",
            description: "Host that holds --script-file",
          },
          "timeout-ms": {
            type: "integer",
            min: 1000,
            max: 120_000,
            default: 30_000,
            description: "Run timeout in milliseconds",
          },
          timeout: {
            type: "duration",
            defaultUnit: "s",
            bareUnits: ["s", "ms"],
            min: 1000,
            max: 120_000,
            description:
              "Run timeout as a duration (90s, 2m, 1500ms); a bare number is seconds (1-120) or milliseconds (1000-120000)",
          },
          thread: THREAD_OPTION,
          json: JSON_OPTION,
        },
        run(input, ctx) {
          const threadId = resolveThreadId(input.options.thread, ctx);
          const scriptFile = input.options["script-file"];
          const scriptHost = input.options["script-host"];
          return deps.execute(
            {
              method: "run",
              input: {
                threadId,
                sessionId: input.positionals["session-id"],
                ...(input.options.script === undefined
                  ? {}
                  : { script: input.options.script }),
                timeoutMs: input.options.timeout ?? input.options["timeout-ms"],
              },
              ...(scriptFile === undefined ? {} : { scriptFile }),
              ...(scriptHost === undefined ? {} : { scriptHost }),
            },
            ctx,
          );
        },
      }),
      do: cliCommand({
        summary:
          "Run a natural-language, goal-driven task with a fast Jev decision loop; prefer `run` for a precise scripted check",
        description:
          'Drives the session\'s "main" page toward the goal in short ref-based steps (click/fill/select/press_key/scroll/goto),\ndeciding each step with an OpenRouter Jev model. Returns a final answer, the steps taken, and a screenshot.',
        positionals: [
          SESSION_POSITIONAL,
          {
            name: "goal",
            description:
              "Natural-language task to accomplish on this session's page",
            required: true,
          },
        ],
        constraints: [
          { kind: "at-most-one", options: ["timeout", "timeout-ms"] },
        ],
        options: {
          "max-steps": {
            type: "integer",
            min: 1,
            max: 40,
            default: 20,
            description: "Maximum number of Jev decision steps",
          },
          "timeout-ms": {
            type: "integer",
            min: 5_000,
            max: 300_000,
            default: 120_000,
            description: "Overall time budget in milliseconds",
          },
          timeout: {
            type: "duration",
            defaultUnit: "s",
            bareUnits: ["s", "ms"],
            min: 5_000,
            max: 300_000,
            description:
              "Overall time budget as a duration (90s, 2m); a bare number is seconds (5-300) or milliseconds (5000-300000)",
          },
          thread: THREAD_OPTION,
          json: JSON_OPTION,
        },
        run(input, ctx) {
          const threadId = resolveThreadId(input.options.thread, ctx);
          return deps.execute(
            {
              method: "do",
              input: {
                threadId,
                sessionId: input.positionals["session-id"],
                goal: input.positionals["goal"],
                maxSteps: input.options["max-steps"],
                timeoutMs: input.options.timeout ?? input.options["timeout-ms"],
              },
            },
            ctx,
          );
        },
      }),
      pages: cliCommand({
        summary: "Inspect persistent named pages",
        positionals: [SESSION_POSITIONAL],
        options: { thread: THREAD_OPTION, json: JSON_OPTION },
        run: (input, ctx) =>
          deps.execute(
            {
              method: "pages",
              input: {
                threadId: resolveThreadId(input.options.thread, ctx),
                sessionId: input.positionals["session-id"],
              },
            },
            ctx,
          ),
      }),
      screenshot: cliCommand({
        summary:
          "Save a bounded JPEG in session tmp; return its path and host ID",
        positionals: [SESSION_POSITIONAL],
        options: {
          page: {
            type: "string",
            placeholder: "name",
            default: "main",
            description: "Named page to capture",
          },
          thread: THREAD_OPTION,
          json: JSON_OPTION,
        },
        run: (input, ctx) =>
          deps.execute(
            {
              method: "screenshot",
              input: {
                threadId: resolveThreadId(input.options.thread, ctx),
                sessionId: input.positionals["session-id"],
                page: input.options.page,
              },
            },
            ctx,
          ),
      }),
      preview: cliCommand({
        summary:
          "Describe the live preview frame of a local headless session, without image bytes",
        positionals: [SESSION_POSITIONAL],
        options: {
          after: {
            type: "integer",
            min: 0,
            max: Number.MAX_SAFE_INTEGER,
            default: 0,
            description: "Only report a frame newer than this sequence number",
          },
          thread: THREAD_OPTION,
          json: JSON_OPTION,
        },
        run: (input, ctx) =>
          deps.execute(
            {
              method: "preview",
              input: {
                threadId: resolveThreadId(input.options.thread, ctx),
                sessionId: input.positionals["session-id"],
                afterSequence: input.options.after,
              },
            },
            ctx,
          ),
      }),
      "fill-login": cliCommand({
        summary:
          "Ask the user for a login in a masked form and fill it into the page over CDP; the agent never sees the values",
        positionals: [SESSION_POSITIONAL],
        options: {
          page: {
            type: "string",
            placeholder: "name",
            default: "main",
            description: "Named page to fill",
          },
          "username-selector": {
            type: "string",
            required: true,
            placeholder: "css-selector",
            description: "CSS selector for the username/email field",
          },
          "password-selector": {
            type: "string",
            required: true,
            placeholder: "css-selector",
            description: "CSS selector for the password field",
          },
          "otp-selector": {
            type: "string",
            placeholder: "css-selector",
            description: "CSS selector for an optional 2FA/OTP code field",
          },
          "submit-selector": {
            type: "string",
            placeholder: "css-selector",
            description:
              "CSS selector for the submit button, clicked after filling",
          },
          label: {
            type: "string",
            placeholder: "text",
            description:
              'Label shown on the credential form, e.g. "GitHub login"',
          },
          thread: THREAD_OPTION,
          json: JSON_OPTION,
        },
        run: (input, ctx) =>
          deps.execute(
            {
              method: "fillLogin",
              input: {
                threadId: resolveThreadId(input.options.thread, ctx),
                sessionId: input.positionals["session-id"],
                page: input.options.page,
                usernameSelector: input.options["username-selector"],
                passwordSelector: input.options["password-selector"],
                ...(input.options["otp-selector"] === undefined
                  ? {}
                  : { otpSelector: input.options["otp-selector"] }),
                ...(input.options["submit-selector"] === undefined
                  ? {}
                  : { submitSelector: input.options["submit-selector"] }),
                ...(input.options.label === undefined
                  ? {}
                  : { label: input.options.label }),
              },
            },
            ctx,
          ),
      }),
      stop: cliCommand({
        summary:
          "Cancel queued and running work and release control; open a new session to resume",
        positionals: [SESSION_POSITIONAL],
        options: { thread: THREAD_OPTION, json: JSON_OPTION },
        run: (input, ctx) =>
          deps.execute(
            {
              method: "stop",
              input: {
                threadId: resolveThreadId(input.options.thread, ctx),
                sessionId: input.positionals["session-id"],
              },
            },
            ctx,
          ),
      }),
      close: cliCommand({
        summary: "Dispose owned browsers and tabs, preserving handed-off tabs",
        positionals: [SESSION_POSITIONAL],
        options: { thread: THREAD_OPTION, json: JSON_OPTION },
        run: (input, ctx) =>
          deps.execute(
            {
              method: "close",
              input: {
                threadId: resolveThreadId(input.options.thread, ctx),
                sessionId: input.positionals["session-id"],
              },
            },
            ctx,
          ),
      }),
    },
  });
}

export function browserCliFailure(error: unknown): PluginCliError {
  if (error instanceof PluginCliError) return error;
  const message =
    error instanceof Error ? error.message : "Browser command failed";
  if (/stopped or expired|does not belong to this thread/u.test(message)) {
    return new PluginCliError(message, {
      code: "session_unavailable",
      hint: REOPEN_HINT,
    });
  }
  if (/screenshot|JPEG/iu.test(message)) {
    return new PluginCliError(message, {
      code: "screenshot_limit",
      hint: "Return at most 4 JPEG screenshots per run, 500 KB combined.",
    });
  }
  return new PluginCliError(message, { code: "command_failed" });
}
