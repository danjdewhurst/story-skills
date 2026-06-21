import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "../../../../src/frontmatter.js";

export const WORKFLOW_SKILLS = [
  "story-init",
  "character-management",
  "worldbuilding",
  "plot-structure",
  "chapter-writing",
  "revision-continuity",
  "story-maintenance"
] as const;

export type WorkflowSkillName = typeof WORKFLOW_SKILLS[number];

export interface LoadedWorkflowSkill {
  name: WorkflowSkillName;
  description: string;
  path: string;
  content: string;
  references: Record<string, string>;
}

export function loadWorkflowSkill(name: WorkflowSkillName, options: { includeReferences?: boolean; skillsRoot?: string } = {}): LoadedWorkflowSkill {
  if (!WORKFLOW_SKILLS.includes(name)) throw new Error(`Unknown workflow skill: ${name}`);
  const root = options.skillsRoot ?? path.resolve(import.meta.dir, "../../../../skills");
  const skillPath = path.join(root, name, "SKILL.md");
  const content = fs.readFileSync(skillPath, "utf8");
  const frontmatter = parseFrontmatter(content, skillPath).data as Record<string, unknown>;
  return {
    name,
    description: String(frontmatter.description ?? ""),
    path: skillPath,
    content,
    references: options.includeReferences === false ? {} : loadReferences(path.join(root, name, "references"))
  };
}

export function listWorkflowSkills(skillsRoot = path.resolve(process.cwd(), "skills")) {
  return WORKFLOW_SKILLS.map((name) => loadWorkflowSkill(name, { includeReferences: false, skillsRoot }));
}

function loadReferences(referencesRoot: string) {
  const references: Record<string, string> = {};
  if (!fs.existsSync(referencesRoot)) return references;
  const stack = [referencesRoot];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        references[path.relative(referencesRoot, fullPath).split(path.sep).join("/")] = fs.readFileSync(fullPath, "utf8");
      }
    }
  }
  return Object.fromEntries(Object.entries(references).sort(([a], [b]) => a.localeCompare(b)));
}
