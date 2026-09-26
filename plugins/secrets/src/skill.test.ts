import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SECRETS_INSTRUCTIONS } from "./server.js";

const skillPath = path.join(
  import.meta.dirname,
  "..",
  "skills",
  "secrets",
  "SKILL.md",
);

describe("secrets skill", () => {
  it("declares the name and description the instruction routes to", () => {
    const text = readFileSync(skillPath, "utf8");
    const frontmatter = /^---\n([\s\S]*?)\n---\n/u.exec(text)?.[1] ?? "";
    expect(frontmatter).toContain("name: secrets");
    expect(frontmatter).toContain(
      'description: "When a task needs environment variables, tokens, API keys, certificates, private keys, SSH or PAM access, or Infisical projects, environments, folders, or secrets."',
    );
    expect(SECRETS_INSTRUCTIONS).toContain("`secrets` skill");
  });

  it("stays under 3 KB and never mentions dotenv", () => {
    expect(statSync(skillPath).size).toBeLessThan(3 * 1024);
    expect(readFileSync(skillPath, "utf8").toLowerCase()).not.toContain(
      "dotenv",
    );
  });
});
