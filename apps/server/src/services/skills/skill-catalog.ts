import { FORK_EXCLUDED_PLUGIN_SKILLS } from "../../fork-config.js";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { getPluginSkillRootContributions } from "../plugins/plugin-agent-contributions.js";
import {
  resolveSkillCatalogEntries,
  type ProjectInjectedSkillSource,
  type ResolvedSkillCatalogEntry,
  type SharedInjectedSkillSource,
} from "./injected-skills.js";

interface ResolveSkillCatalogSourcesArgs {
  pluginSkillSelections?: ReadonlyMap<string, ReadonlySet<string>>;
  projectSkillSources?: readonly ProjectInjectedSkillSource[];
  sharedSkillSources?: readonly SharedInjectedSkillSource[];
  skillNames?: readonly string[];
}

export function resolveSkillCatalog(
  deps: Pick<LoggedWorkSessionDeps, "config" | "logger" | "skillTreeRegistry">,
  args: ResolveSkillCatalogSourcesArgs = {},
): ResolvedSkillCatalogEntry[] {
  const entries = resolveSkillCatalogEntries(deps.logger, {
    additionalSkillsRootPaths: [...deps.config.inheritedSkillsRootPaths],
    dataDir: deps.config.dataDir,
    pluginSkillRoots: getPluginSkillRootContributions(),
    ...(args.pluginSkillSelections !== undefined
      ? { pluginSkillSelections: args.pluginSkillSelections }
      : {}),
    ...(args.projectSkillSources !== undefined
      ? { projectSkillSources: args.projectSkillSources }
      : {}),
    ...(args.sharedSkillSources !== undefined
      ? { sharedSkillSources: args.sharedSkillSources }
      : {}),
    skillTreeRegistry: deps.skillTreeRegistry,
  });
  const selected =
    args.skillNames === undefined || args.skillNames.length === 0
      ? null
      : new Set(args.skillNames);
  return entries.filter(
    ({ provenance, runtimeSource }) =>
      (provenance.kind !== "plugin" ||
        !FORK_EXCLUDED_PLUGIN_SKILLS.includes(runtimeSource.name)) &&
      (selected === null || selected.has(runtimeSource.name)),
  );
}
