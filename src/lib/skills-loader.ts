import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { applySkill, parseFrontmatter, type Message, type Skill } from "@nemesis-oss/ollama-sdk";

const SKILLS_DIR = join(process.cwd(), "src", "skills");

export async function loadSkillByName(name: string): Promise<Skill | null> {
  try {
    const fullPath = join(SKILLS_DIR, name, "SKILL.md");
    const raw = await readFile(fullPath, "utf-8");
    const parsed = parseFrontmatter(raw, fullPath);
    return {
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      path: fullPath,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      allowedTools: parsed.frontmatter["allowed-tools"],
    };
  } catch {
    return null;
  }
}

export function detectSkillNames(prompt: string): readonly string[] {
  const lower = prompt.toLowerCase();
  const matched: string[] = [];
  if (/(smc|fvg|fair value gap|liquidity|sweep|order block|bos|choch)/i.test(lower)) {
    matched.push("pine-smc-toolkit");
  }
  if (/(pine.*v5|pinescript|convert|v4|v5|migrate)/i.test(lower)) {
    matched.push("pine-v5-migration");
  }
  return matched;
}

export async function injectSkillsIntoMessages(
  messages: readonly Message[],
  prompt: string,
): Promise<readonly Message[]> {
  const skillNames = detectSkillNames(prompt);
  let currentMessages = [...messages];
  for (const name of skillNames) {
    const skill = await loadSkillByName(name);
    if (skill) {
      const applied = applySkill(skill, { messages: currentMessages });
      currentMessages = [...applied.messages];
    }
  }
  return currentMessages;
}
