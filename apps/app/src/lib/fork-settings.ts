import { FORK_HIDDEN_SETTINGS_SECTIONS } from "./fork-flags";

export function isForkHiddenSettingsSection(sectionId: string): boolean {
  return FORK_HIDDEN_SETTINGS_SECTIONS.includes(sectionId);
}

export function isForkHiddenSettingsPath(path: string): boolean {
  const sectionId = /^\/settings\/([^/?#]+)/u.exec(path)?.[1];
  return sectionId !== undefined && isForkHiddenSettingsSection(sectionId);
}
