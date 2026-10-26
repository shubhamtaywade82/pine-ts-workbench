import { describe, expect, test } from "bun:test";
import { detectSkillNames, loadSkillByName, injectSkillsIntoMessages } from "./skills-loader";

describe("skills-loader", () => {
  test("detectSkillNames recognizes SMC and Migration keywords", () => {
    expect(detectSkillNames("Create an FVG detector")).toContain("pine-smc-toolkit");
    expect(detectSkillNames("Convert this Pine v5 script")).toContain("pine-v5-migration");
    expect(detectSkillNames("Simple RSI script")).toHaveLength(0);
  });

  test("loadSkillByName loads and parses frontmatter from markdown", async () => {
    const smc = await loadSkillByName("pine-smc-toolkit");
    expect(smc).not.toBeNull();
    expect(smc?.name).toBe("pine-smc-toolkit");
    expect(smc?.body).toContain("Fair Value Gaps");
  });

  test("injectSkillsIntoMessages prepends skill instructions into messages", async () => {
    const initial = [{ role: "system" as const, content: "Base instructions" }];
    const result = await injectSkillsIntoMessages(initial, "Write an SMC strategy with liquidity sweeps");
    expect(result[0]!.content).toContain("[Skill: pine-smc-toolkit]");
    expect(result[0]!.content).toContain("Base instructions");
  });
});
