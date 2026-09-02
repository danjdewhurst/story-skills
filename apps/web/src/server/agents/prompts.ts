import fs from "node:fs";
import path from "node:path";
import { loadWorkflowSkill } from "../skills";
import type { AgentRunRequest } from "./types";

export function buildAgentPrompt(request: AgentRunRequest) {
  const skill = loadWorkflowSkill(request.workflow, { includeReferences: true });
  const context = request.contextFiles.map((file) => formatContextFile(request.projectRoot, file)).join("\n\n");
  const references = Object.entries(skill.references)
    .map(([file, content]) => `## Reference: ${file}\n\n${content}`)
    .join("\n\n");

  return [
    `You are editing a Story Skills markdown project at ${request.projectRoot}.`,
    `Use the loaded workflow skill: ${request.workflow}.`,
    "",
    "# User goal",
    request.userGoal,
    "",
    "# Allowed paths",
    ...request.allowedPaths.map((entry) => `- ${entry}`),
    "",
    "# Context files",
    context || "No context files were selected.",
    "",
    "# Skill instructions",
    skill.content,
    references ? `\n# Skill references\n${references}` : "",
    "",
    "# Operating rules",
    "- Keep the project markdown-first.",
    "- Do not create generator scripts that emit story content.",
    "- Write only under the allowed paths.",
    "- Surface outline and approval checkpoints before long prose drafts.",
    "- After content changes, run the Story Skills maintenance commands requested by the loaded skill.",
    "- Return a concise final summary with changed files and maintenance results."
  ].join("\n");
}

function formatContextFile(projectRoot: string, relativeFile: string) {
  const safeRoot = fs.realpathSync(projectRoot);
  const fullPath = fs.realpathSync(path.resolve(safeRoot, relativeFile));
  const relative = path.relative(safeRoot, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${relativeFile} is outside project root`);
  }
  return `## ${relative}\n\n${fs.readFileSync(fullPath, "utf8")}`;
}
