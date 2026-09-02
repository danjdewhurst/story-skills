import { describe, expect, test } from "bun:test";
import path from "node:path";
import { listWorkflowSkills, loadWorkflowSkill, WORKFLOW_SKILLS } from "./skills";

const repoRoot = path.resolve(import.meta.dir, "../../../..");
const skillsRoot = path.join(repoRoot, "skills");

describe("skill loader", () => {
  test("loads every workflow skill", () => {
    const skills = listWorkflowSkills(skillsRoot);
    expect(skills.map((skill) => skill.name)).toEqual([...WORKFLOW_SKILLS]);
    expect(skills.every((skill) => skill.description.length > 0)).toBe(true);
  });

  test("loads references for chapter writing", () => {
    const skill = loadWorkflowSkill("chapter-writing", { skillsRoot });
    expect(skill.content).toContain("# Chapter Writing");
    expect(Object.keys(skill.references)).toContain("chapter-template.md");
  });
});
