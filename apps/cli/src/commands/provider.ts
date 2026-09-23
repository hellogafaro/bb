import { Command } from "commander";
import type { AvailableModel } from "@bb/domain";
import type {
  SystemExecutionOptionsModelLoadError,
  SystemProviderInfo,
} from "@bb/server-contract";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { columnWidths, printBorderlessTable } from "../table.js";
import { outputJson } from "./helpers.js";
import {
  resolveMachineEnvironmentRouting,
  resolveMachineHostId,
} from "./machine.js";

interface ProviderListCommandOptions {
  environment?: string;
  host?: string;
  json?: boolean;
  machine?: string;
}

interface ProviderModelsCommandOptions {
  environment?: string;
  host?: string;
  json?: boolean;
  machine?: string;
  selectedModel?: string;
}

export interface ProviderGuardCommandOptions {
  fix?: boolean;
  json?: boolean;
  machine?: string;
  path?: string;
}

interface IncludeSelectedOnlyModelArgs {
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
  selectedModel?: string;
}

function addProviderRoutingOptions(command: Command): Command {
  return command
    .option("--machine <id-or-name>", "Machine whose providers should be used")
    .option("--host <id-or-name>", "Alias for --machine")
    .option(
      "--environment <id>",
      "Environment whose machine providers should be used",
    );
}

export function addProviderGuardCommand(
  command: Command,
  getUrl: () => string,
): Command {
  return command
    .option(
      "--fix",
      "Write the lockdown settings and delete plugin marketplace clones and caches",
    )
    .option(
      "--machine <id-or-name>",
      "Machine to check (default: the primary machine)",
    )
    .option(
      "--path <dir>",
      "Project directory whose .mcp.json to check (default: the current directory without --machine)",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ProviderGuardCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const hostId = opts.machine
          ? await resolveMachineHostId({ serverUrl: getUrl(), target: opts.machine })
          : null;
        const target = {
          ...(hostId ? { hostId } : {}),
          ...(opts.path || !opts.machine
            ? { projectPath: opts.path ?? process.cwd() }
            : {}),
        };
        const result = opts.fix
          ? await sdk.providers.guardFix(target)
          : await sdk.providers.guardStatus(target);
        if (outputJson(opts, result)) return;
        console.log(result.text);
      }),
    );
}

export function registerProviderCommands(
  program: Command,
  getUrl: () => string,
): void {
  const provider = program
    .command("provider")
    .description("Inspect available providers and models");

  addProviderRoutingOptions(provider.command("list"))
    .description("List available providers")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ProviderListCommandOptions) => {
        const serverUrl = getUrl();
        const sdk = createCliBbSdk(serverUrl);
        const providers = await sdk.providers.list(
          await resolveMachineEnvironmentRouting(opts, serverUrl),
        );
        if (outputJson(opts, providers)) return;
        if (providers.length === 0) {
          console.log("No providers available");
          return;
        }
        printProviderTable(providers);
      }),
    );

  addProviderRoutingOptions(provider.command("models [providerId]"))
    .description("List available models for a provider")
    .option("--json", "Print machine-readable JSON output")
    .option(
      "--selected-model <model>",
      "Include a selected-only model if it matches",
    )
    .action(
      action(
        async (
          providerId: string | undefined,
          opts: ProviderModelsCommandOptions,
        ) => {
          const serverUrl = getUrl();
          const sdk = createCliBbSdk(serverUrl);
          const executionOptions = await sdk.providers.models({
            ...(await resolveMachineEnvironmentRouting(opts, serverUrl)),
            ...(providerId ? { providerId } : {}),
          });
          const models = includeSelectedOnlyModel({
            models: executionOptions.models,
            selectedOnlyModels: executionOptions.selectedOnlyModels,
            selectedModel: opts.selectedModel,
          });
          printModelLoadError(executionOptions.modelLoadError);
          if (outputJson(opts, models)) return;
          if (models.length === 0) {
            console.log("No models available");
            return;
          }
          printModelTable(models, providerId);
        },
      ),
    );

  addProviderGuardCommand(provider.command("guard"), getUrl).description(
    "Check that Claude Code and Codex load only BB's MCPs, skills, and plugins",
  );
}

function includeSelectedOnlyModel(
  args: IncludeSelectedOnlyModelArgs,
): AvailableModel[] {
  if (!args.selectedModel) {
    return args.models;
  }
  if (args.models.some((model) => model.model === args.selectedModel)) {
    return args.models;
  }
  const selectedOnlyModel = args.selectedOnlyModels.find(
    (model) => model.model === args.selectedModel,
  );
  return selectedOnlyModel ? [selectedOnlyModel, ...args.models] : args.models;
}

function printProviderTable(providers: SystemProviderInfo[]): void {
  const rows = providers.map((provider) => [provider.id, provider.displayName]);
  printBorderlessTable(
    {
      head: ["ID", "Name"],
      colWidths: columnWidths(rows, [4, 4]),
    },
    rows,
  );
}

function printModelLoadError(
  modelLoadError: SystemExecutionOptionsModelLoadError | null,
): void {
  if (modelLoadError === null) {
    return;
  }
  console.error(
    `Could not load models for ${modelLoadError.providerId} (${modelLoadError.code})`,
  );
  if (modelLoadError.detail !== null) {
    console.error(`  ${modelLoadError.detail}`);
  }
}

function printModelTable(models: AvailableModel[], providerId?: string): void {
  if (providerId) {
    console.log(`Models for ${providerId}:`);
  }

  const rows = models.map((model) => [
    model.model,
    model.displayName ?? model.model,
    model.isDefault ? "*" : "",
  ]);
  printBorderlessTable(
    {
      head: ["Model", "Name", "Default"],
      colWidths: columnWidths(rows, [5, 4, 7]),
      trimTrailingWhitespace: true,
    },
    rows,
  );
}
