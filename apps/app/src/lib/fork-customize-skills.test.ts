import { describe, expect, it } from "vitest";
import type { SkillSummary } from "@bb/server-contract";
import { customizeSkills, isCustomizeSkill } from "./fork-customize-skills";

function skill(
  name: string,
  scope: SkillSummary["scope"],
  provider: string | null,
): SkillSummary {
  return {
    id: `skill_${"a".repeat(64)}`,
    name,
    description: null,
    provider,
    scope,
    pluginId: scope === "plugin" ? name : null,
    filePath: `/skills/${name}/SKILL.md`,
    manageable: false,
    registrySkillId: null,
  };
}

describe("Customize skill scope", () => {
  it("keeps BB user, BB project, and BB plugin skills only", () => {
    const skills = [
      skill("mine", "bb-user", null),
      skill("repo", "bb-project", null),
      skill("workflows", "plugin", null),
      skill("imagegen", "plugin", "codex"),
      skill("synced", "provider-user", "claude-code"),
      skill("local", "provider-project", "codex"),
      skill("bb-cli", "bb-builtin", null),
      skill("shared", "shared-user", null),
      skill("shared-repo", "shared-project", null),
    ];
    expect(customizeSkills(skills).map((entry) => entry.name)).toEqual([
      "mine",
      "repo",
      "workflows",
    ]);
    expect(isCustomizeSkill(skill("imagegen", "plugin", "codex"))).toBe(false);
  });
});
