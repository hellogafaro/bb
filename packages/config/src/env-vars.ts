import { z } from "zod";
import { delimiter } from "node:path";
import { defaultFeatureFlags } from "@bb/domain";
import { DEFAULTS } from "./defaults.js";
import {
  APP_UPDATE_MODE_ENV_NAME,
  appUpdateModeSchema,
  type AppUpdateMode,
} from "./app-update.js";
import { defineEnvVar, type EnvVarParseArgs } from "./env.js";
import {
  APP_SURFACE_ENV_NAME,
  APP_SURFACE_WEB,
  formatAppSurfaceValues,
  parseAppSurface,
  type AppSurface,
} from "./app-surface.js";
import {
  validateInferenceModel,
  validateTranscriptionModel,
} from "./openrouter-model.js";
import { validateLogLevel } from "./log-level.js";
import { validateOptionalUrl, validateRequiredUrl } from "./public-url.js";
import { BB_LOOPBACK_HOST, parsePortValue } from "./runtime.js";
import { toOptionalString } from "./strings.js";

export type ServerBindHost = "127.0.0.1" | "0.0.0.0";

function parseBooleanEnvValue(args: EnvVarParseArgs): boolean {
  const normalizedValue = args.value.trim().toLowerCase();
  if (
    normalizedValue === "true" ||
    normalizedValue === "1" ||
    normalizedValue === "yes" ||
    normalizedValue === "y"
  ) {
    return true;
  }
  if (
    normalizedValue === "false" ||
    normalizedValue === "0" ||
    normalizedValue === "no" ||
    normalizedValue === "n"
  ) {
    return false;
  }

  throw new Error(`${args.name} must be a boolean`);
}

function parseAppSurfaceEnvValue(args: EnvVarParseArgs): AppSurface {
  const parsed = parseAppSurface(args.value);
  if (parsed !== undefined) {
    return parsed;
  }
  throw new Error(`${args.name} must be one of ${formatAppSurfaceValues()}`);
}

function parseAppUpdateModeEnvValue(args: EnvVarParseArgs): AppUpdateMode {
  const parsed = appUpdateModeSchema.safeParse(args.value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new Error(
    `${args.name} must be one of ${appUpdateModeSchema.options.join(", ")}`,
  );
}

function parseOptionalPortEnvValue(args: EnvVarParseArgs): number | undefined {
  if (args.value === "0") {
    return undefined;
  }

  return parsePortValue({
    name: args.name,
    rawPort: args.value,
  });
}

function parseOptionalTrimmedStringEnvValue(
  args: EnvVarParseArgs,
): string | undefined {
  return toOptionalString(args.value);
}

function parseStringEnvValue(args: EnvVarParseArgs): string {
  return args.value;
}

function parsePathListEnvValue(args: EnvVarParseArgs): string[] {
  return args.value
    .split(delimiter)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function parseNonEmptyStringEnvValue(args: EnvVarParseArgs): string {
  if (args.value.length === 0) {
    throw new Error(`${args.name} must not be empty`);
  }

  return args.value;
}

function parsePortEnvValue(args: EnvVarParseArgs): number {
  return parsePortValue({
    name: args.name,
    rawPort: args.value,
  });
}

export function parseServerBindHost(value: string): ServerBindHost {
  const trimmedValue = value.trim();
  if (trimmedValue === "127.0.0.1" || trimmedValue === "0.0.0.0") {
    return trimmedValue;
  }

  throw new Error('BB_SERVER_BIND_HOST must be "127.0.0.1" or "0.0.0.0"');
}

function parseServerBindHostEnvValue(args: EnvVarParseArgs): ServerBindHost {
  return parseServerBindHost(args.value);
}

function parsePositiveIntegerEnvValue(args: EnvVarParseArgs): number {
  const parsed = Number(args.value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${args.name} must be a positive integer`);
  }
  return parsed;
}

function parseRequiredUrlEnvValue(args: EnvVarParseArgs): string {
  return validateRequiredUrl(args.name, args.value);
}

function parseOptionalUrlEnvValue(args: EnvVarParseArgs): string {
  return validateOptionalUrl(args.name, args.value);
}

function parseLogLevelValue(args: EnvVarParseArgs): string {
  return validateLogLevel(args.value);
}

function parseInferenceModelValue(args: EnvVarParseArgs): string {
  return validateInferenceModel(args.value);
}

function parseTranscriptionModelValue(args: EnvVarParseArgs): string {
  return validateTranscriptionModel(args.value);
}

export const BB_LOG_LEVEL_ENV = defineEnvVar<string>({
  description: "Log level: trace, debug, info, warn, error, fatal",
  name: "BB_LOG_LEVEL",
  parse: parseLogLevelValue,
});

export const BB_SERVER_PORT_ENV = defineEnvVar<number>({
  description: "HTTP port for the server",
  name: "BB_SERVER_PORT",
  parse: parsePortEnvValue,
});

export const BB_SERVER_BIND_HOST_ENV = defineEnvVar<ServerBindHost>({
  description: "HTTP bind host for the server",
  name: "BB_SERVER_BIND_HOST",
  parse: parseServerBindHostEnvValue,
});

export const BB_HOST_DAEMON_PORT_ENV = defineEnvVar<number>({
  description: "Port the host daemon listens on for local API requests",
  name: "BB_HOST_DAEMON_PORT",
  parse: parsePortEnvValue,
});

export const BB_SERVER_URL_ENV = defineEnvVar<string>({
  description: "URL of the bb server",
  name: "BB_SERVER_URL",
  parse: parseRequiredUrlEnvValue,
});

export const BB_APP_VERSION_ENV = defineEnvVar<string>({
  description:
    "Version of the running bb-app package. The bb-app launcher sets this from packages/bb-app/package.json; defaults to a sentinel for dev/source runs.",
  name: "BB_APP_VERSION",
  parse: parseNonEmptyStringEnvValue,
});

export const BB_SERVER_LAUNCH_ID_ENV = defineEnvVar<string>({
  description:
    "Internal per-spawn identity the bb-app launcher hands its server child. The server echoes it on /health so the launcher can tell its own child apart from another bb server that already owns the port.",
  name: "BB_SERVER_LAUNCH_ID",
  parse: parseNonEmptyStringEnvValue,
});

export const BB_APP_UPDATE_MODE_ENV = defineEnvVar<AppUpdateMode>({
  description:
    "Internal marker the bb-app launcher hands its server child when it runs under the in-app update shim: npm for package installs, source for pnpm start checkouts. The server offers in-app updates only when it is set.",
  name: APP_UPDATE_MODE_ENV_NAME,
  parse: parseAppUpdateModeEnvValue,
});

export const BB_APP_SURFACE_ENV = defineEnvVar<AppSurface>({
  description:
    "Internal launcher marker for telemetry attribution. Set by bb-app and desktop launchers.",
  name: APP_SURFACE_ENV_NAME,
  parse: parseAppSurfaceEnvValue,
});

export const BB_APP_URL_ENV = defineEnvVar<string>({
  description:
    "Human-facing app/server base URL used for generated links and allowed browser origins. Does not control which host or port the server binds to.",
  name: "BB_APP_URL",
  parse: parseOptionalUrlEnvValue,
});

export const BB_EXTERNAL_URL_ENV = defineEnvVar<string>({
  description:
    "Internet-facing HTTPS base URL used for generated public links. Does not control which host or port the server binds to.",
  name: "BB_EXTERNAL_URL",
  parse: parseOptionalUrlEnvValue,
});

export const BB_MARKETPLACE_URL_ENV = defineEnvVar<string>({
  description:
    "Manifest URL of the reserved bb-community plugin marketplace, which lists as BB Community. Point it at a local file server to test catalog refreshes.",
  name: "BB_MARKETPLACE_URL",
  parse: parseOptionalUrlEnvValue,
});

export const BB_INFERENCE_ENV = defineEnvVar<string>({
  description:
    "OpenRouter model id used for server-side helper inference such as thread titles and commit messages",
  name: "BB_INFERENCE",
  parse: parseInferenceModelValue,
});

export const BB_TRANSCRIPTION_ENV = defineEnvVar<string>({
  description:
    "OpenRouter speech-to-text model id used for voice transcription (no service prefix)",
  name: "BB_TRANSCRIPTION",
  parse: parseTranscriptionModelValue,
});

export const OPENROUTER_API_KEY_ENV = defineEnvVar<string>({
  description:
    "OpenRouter API key used for voice transcription and openrouter/* helper inference",
  name: "OPENROUTER_API_KEY",
  parse: parseStringEnvValue,
});

export const COMPUTER_TYPESAFE_API_KEY_ENV = defineEnvVar<string>({
  description:
    "TypeSafe System One API key used by Computer's jev-mode decision loop. Empty disables jev mode.",
  name: "COMPUTER_TYPESAFE_API_KEY",
  parse: parseStringEnvValue,
});

export const COMPUTER_TYPESAFE_ENDPOINT_ENV = defineEnvVar<string>({
  description: "TypeSafe System One endpoint used by Computer's jev-mode decision loop",
  name: "COMPUTER_TYPESAFE_ENDPOINT",
  parse: parseStringEnvValue,
});

export const COMPUTER_TYPESAFE_MODEL_ENV = defineEnvVar<string>({
  description: "TypeSafe System One model id used by Computer's jev-mode decision loop",
  name: "COMPUTER_TYPESAFE_MODEL",
  parse: parseStringEnvValue,
});

export const COMPUTER_OPENROUTER_API_KEY_ENV = defineEnvVar<string>({
  description:
    "OpenRouter API key used to generate typed text for Computer's jev-mode decision loop",
  name: "COMPUTER_OPENROUTER_API_KEY",
  parse: parseStringEnvValue,
});

export const COMPUTER_OPENROUTER_MODEL_ENV = defineEnvVar<string>({
  description:
    "OpenRouter model id used to generate typed text for Computer's jev-mode decision loop",
  name: "COMPUTER_OPENROUTER_MODEL",
  parse: parseStringEnvValue,
});

export const BB_POSTHOG_API_KEY_ENV = defineEnvVar<string>({
  description:
    "PostHog project API key for anonymous usage telemetry. Telemetry is disabled when empty.",
  name: "BB_POSTHOG_API_KEY",
  parse: parseStringEnvValue,
});

export const BB_TELEMETRY_ENV = defineEnvVar<boolean>({
  description:
    "Anonymous usage telemetry (app starts, thread creation counts, user message counts, and plugin installs). Set to false to opt out.",
  name: "BB_TELEMETRY",
  parse: parseBooleanEnvValue,
});

export const BB_FF_PLACEHOLDER_ENV = defineEnvVar<boolean>({
  description:
    "Permanent placeholder feature flag. Non-functional keep-alive so the flag system has at least one entry; do not gate behavior on it.",
  name: "BB_FF_PLACEHOLDER",
  parse: parseBooleanEnvValue,
});

export const BB_FF_TIMELINE_WINDOW_EVENT_BUDGET_ENV = defineEnvVar<number>({
  description:
    "Max events one thread-timeline window may span. Raise far above the default to restore unbounded windows.",
  name: "BB_FF_TIMELINE_WINDOW_EVENT_BUDGET",
  parse: parsePositiveIntegerEnvValue,
});

export const BB_DEV_APP_HOST_ENV = defineEnvVar<string>({
  description:
    "Development-only Vite bind host override for apps/app. Defaults to 127.0.0.1 when unset.",
  name: "BB_DEV_APP_HOST",
  parse: parseStringEnvValue,
});

export const BB_DEV_APP_PORT_ENV = defineEnvVar<number | undefined>({
  description: "Development-only Vite port for apps/app.",
  name: "BB_DEV_APP_PORT",
  parse: parseOptionalPortEnvValue,
});

export const BB_CLI_DIR_ENV = defineEnvVar<string | undefined>({
  description:
    "Directory containing the bb CLI executable to inject into runtime shells",
  name: "BB_CLI_DIR",
  parse: parseOptionalTrimmedStringEnvValue,
});

export const BB_INHERITED_SKILLS_ROOTS_ENV = defineEnvVar<string[]>({
  description:
    "Development-only path list of lower-priority inherited bb skill roots",
  name: "BB_INHERITED_SKILLS_ROOTS",
  parse: parsePathListEnvValue,
});

export const BB_BRIDGE_DIR_ENV = defineEnvVar<string | undefined>({
  description:
    "Directory containing provider bridge bundles for the host daemon runtime",
  name: "BB_BRIDGE_DIR",
  parse: parseOptionalTrimmedStringEnvValue,
});

export const BB_SERVER_HEADERS_ENV = defineEnvVar<Record<string, string>>({
  description: "Private JSON headers attached to machine server requests",
  name: "BB_SERVER_HEADERS",
  parse: ({ value }) => {
    try {
      return z.record(z.string(), z.string()).parse(JSON.parse(value));
    } catch {
      throw new Error(
        "BB_SERVER_HEADERS must be a JSON object with string values",
      );
    }
  },
});

export const BB_CONNECT_MACHINE_CREDENTIAL_ENV = defineEnvVar<
  string | undefined
>({
  description:
    "Daemon-managed bb connect credential for traversing the public machine gate",
  name: "BB_CONNECT_MACHINE_CREDENTIAL",
  parse: parseOptionalTrimmedStringEnvValue,
});

export const BB_HOST_ENROLL_KEY_ENV = defineEnvVar<string | undefined>({
  description:
    "One-time enrollment token used to bootstrap a host daemon with the bb server",
  name: "BB_HOST_ENROLL_KEY",
  parse: parseOptionalTrimmedStringEnvValue,
});

export const BB_HOST_DAEMON_AUTO_UPDATE_ENV = defineEnvVar<boolean>({
  description:
    "Allow a remote host daemon to install the exact bb-app package served by its server on a newer protocol mismatch",
  name: "BB_HOST_DAEMON_AUTO_UPDATE",
  parse: parseBooleanEnvValue,
});

export const BB_HOST_ID_ENV = defineEnvVar<string | undefined>({
  description:
    "Preferred host ID to persist for the daemon instead of generating one locally",
  name: "BB_HOST_ID",
  parse: parseOptionalTrimmedStringEnvValue,
});

export const BB_HOST_NAME_ENV = defineEnvVar<string | undefined>({
  description:
    "Preferred host name to report instead of detecting the local hostname",
  name: "BB_HOST_NAME",
  parse: parseOptionalTrimmedStringEnvValue,
});

export const DEFAULT_BB_APP_VERSION = DEFAULTS.appVersion;
export const DEFAULT_BB_APP_SURFACE = APP_SURFACE_WEB;
export const DEFAULT_BB_APP_URL = "";
export const DEFAULT_BB_SERVER_BIND_HOST: ServerBindHost = BB_LOOPBACK_HOST;
export const DEFAULT_BB_EXTERNAL_URL = "";
export const DEFAULT_OPENROUTER_API_KEY = "";
export const DEFAULT_COMPUTER_TYPESAFE_API_KEY = "";
export const DEFAULT_COMPUTER_TYPESAFE_ENDPOINT =
  "https://api.typesafe.ai/v1/systemone";
export const DEFAULT_COMPUTER_TYPESAFE_MODEL = "jev-1";
export const DEFAULT_COMPUTER_OPENROUTER_API_KEY = "";
export const DEFAULT_COMPUTER_OPENROUTER_MODEL = "openai/gpt-4o-mini";
export const DEFAULT_BB_POSTHOG_API_KEY =
  "phc_tejoYoNLV6vG8QAd5eYXXvcsENFYnP4brpZDGqG7zvpy";
export const DEFAULT_BB_TELEMETRY = true;
export const DEFAULT_BB_DEV_APP_HOST = "";
export const DEFAULT_BB_MARKETPLACE_URL =
  "https://getbb.app/marketplace/v2/marketplace.json";
export const DEFAULT_BB_INFERENCE = DEFAULTS.inferenceModel;
export const DEFAULT_BB_TRANSCRIPTION = DEFAULTS.transcriptionModel;
export const DEFAULT_BB_FF_PLACEHOLDER = defaultFeatureFlags.placeholder;
export const DEFAULT_BB_FF_TIMELINE_WINDOW_EVENT_BUDGET =
  defaultFeatureFlags.timelineWindowEventBudget;
