import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

interface SkillIndexEntry {
  name: string;
  type: string;
  description: string;
  url: string;
  digest: string;
}

interface SkillIndex {
  $schema: string;
  skills: SkillIndexEntry[];
}

const SKILLS_ROOT = join(import.meta.dir, "../../public/.well-known/agent-skills");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function sha256(path: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

describe("agent skill discovery", () => {
  test("indexes every served skill with a current digest", () => {
    const index = readJson<SkillIndex>(join(SKILLS_ROOT, "index.json"));
    const skillDirs = readdirSync(SKILLS_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => existsSync(join(SKILLS_ROOT, name, "SKILL.md")))
      .sort();

    expect(index.$schema).toBe("https://schemas.agentskills.io/discovery/0.2.0/schema.json");
    expect(index.skills.map((skill) => skill.name).sort()).toEqual(skillDirs);
    expect(new Set(index.skills.map((skill) => skill.name)).size).toBe(index.skills.length);

    for (const skill of index.skills) {
      const skillPath = join(SKILLS_ROOT, skill.name, "SKILL.md");
      expect(skill.type).toBe("skill-md");
      expect(skill.description).toBeTruthy();
      expect(skill.url).toBe(`/.well-known/agent-skills/${skill.name}/SKILL.md`);
      expect(skill.digest).toBe(sha256(skillPath));
    }
  });

  test("publishes the MCP-focused editing skill and its generated references", () => {
    const index = readJson<SkillIndex>(join(SKILLS_ROOT, "index.json"));
    const editing = index.skills.find((skill) => skill.name === "mcut-editing");

    expect(editing?.description).toContain("via the MCP server");
    expect(readFileSync(join(SKILLS_ROOT, "mcut-editing/SKILL.md"), "utf8")).toContain(
      "**MCP server**",
    );
    expect(existsSync(join(SKILLS_ROOT, "mcut-editing/references/commands.md"))).toBe(true);
    expect(existsSync(join(SKILLS_ROOT, "mcut-editing/references/recipes.md"))).toBe(true);
    expect(existsSync(join(SKILLS_ROOT, "mcut-editing/assets/templates/talking-head.json"))).toBe(
      true,
    );
  });
});
