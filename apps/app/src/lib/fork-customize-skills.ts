import type { SkillSummary } from "@bb/server-contract";
import { FORK_CUSTOMIZE_PAGE } from "./fork-flags";

const CUSTOMIZE_SKILL_SCOPES: ReadonlySet<SkillSummary["scope"]> = new Set([
  "bb-user",
  "bb-project",
  "plugin",
]);

export function isCustomizeSkill(skill: SkillSummary): boolean {
  return (
    CUSTOMIZE_SKILL_SCOPES.has(skill.scope) &&
    (skill.scope !== "plugin" || skill.provider === null)
  );
}

export function customizeSkills(
  skills: readonly SkillSummary[],
): readonly SkillSummary[] {
  return FORK_CUSTOMIZE_PAGE ? skills.filter(isCustomizeSkill) : skills;
}
