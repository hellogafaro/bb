import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { PluginCliCommandInfo } from "./plugin-api.js";

export interface PluginCliContribution {
  pluginId: string;
  name: string;
  summary: string;
  commands: PluginCliCommandInfo[];
  rendersHelp: boolean;
}

export async function removePluginCommandsSkill(
  dataDir: string,
): Promise<void> {
  await rm(join(dataDir, "skills-generated"), { recursive: true, force: true });
}
