import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSkillCatalog } from "../../../src/services/skills/skill-catalog.js";
import { withTestHarness } from "../../helpers/test-app.js";

let workDir = "";

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "bb-skill-catalog-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeSkill(rootPath: string, name: string): Promise<void> {
  const dir = join(rootPath, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Use ${name} in catalog tests.\n---\n\n# ${name}\n`,
  );
}

async function writeSkillPlugin(
  skillNames: readonly string[],
): Promise<string> {
  const rootDir = join(workDir, "bb-plugin-fork-skills");
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: "bb-plugin-fork-skills",
      version: "0.1.0",
      bb: {
        name: "Fork skills fixture",
        description: "Plugin that bundles skills.",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(
    join(rootDir, "server.ts"),
    "export default function plugin() {}",
  );
  for (const name of skillNames)
    await writeSkill(join(rootDir, "skills"), name);
  return rootDir;
}

describe("fork plugin skill exclusions", () => {
  it("drops excluded plugin skills from the catalog but keeps user skills with the same name", async () => {
    await withTestHarness(async (harness) => {
      await harness.pluginService.installPath(
        await writeSkillPlugin([
          "provider-retry",
          "codex-provider",
          "workflows",
        ]),
      );
      await writeSkill(
        join(harness.deps.config.dataDir, "skills"),
        "concurrency-limit",
      );

      const entries = resolveSkillCatalog(harness.deps);
      const pluginSkills = entries
        .filter((entry) => entry.provenance.kind === "plugin")
        .map((entry) => entry.runtimeSource.name);
      expect(pluginSkills).toEqual(["workflows"]);
      expect(
        entries.find(
          (entry) => entry.runtimeSource.name === "concurrency-limit",
        )?.provenance,
      ).toEqual({ kind: "user" });
    });
  });
});
