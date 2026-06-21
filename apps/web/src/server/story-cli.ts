import path from "node:path";
import {
  checkProjectContinuity,
  computeWordCounts,
  formatActionReport,
  formatDoctorReport,
  formatProjectReport,
  projectActions,
  projectReport,
  reindexProject,
  validateLinks,
  validateProject
} from "../../../../src/story.js";

export type StoryCommandName = "validate" | "links" | "continuity" | "report" | "next" | "doctor" | "reindex" | "wordcount";

export interface StoryOperationResult<T = unknown> {
  command: StoryCommandName;
  ok: boolean;
  stdout: string;
  errors: string[];
  warnings: string[];
  data: T;
}

type CheckResult = { ok: boolean; errors?: string[]; warnings?: string[] };

export function runStoryOperation(root: string, command: StoryCommandName): StoryOperationResult {
  const projectRoot = path.resolve(root);
  try {
    if (command === "validate") return fromCheck(command, validateProject(projectRoot), "Project is valid");
    if (command === "links") return fromCheck(command, validateLinks(projectRoot), "Links are valid");
    if (command === "continuity") return fromCheck(command, checkProjectContinuity(projectRoot), "Continuity is consistent");
    if (command === "report") {
      const data = projectReport(projectRoot);
      return { command, ok: true, stdout: formatProjectReport(data, { actionable: true }), errors: [], warnings: [], data };
    }
    if (command === "next") {
      const data = projectActions(projectRoot);
      return { command, ok: true, stdout: formatActionReport(data), errors: [], warnings: [], data };
    }
    if (command === "doctor") {
      const data = projectActions(projectRoot);
      const ok = data.validation.ok && data.links.ok && data.continuity.ok;
      return {
        command,
        ok,
        stdout: formatDoctorReport(data),
        errors: [...(data.validation.errors ?? []), ...(data.links.errors ?? []), ...(data.continuity.errors ?? [])],
        warnings: [...(data.validation.warnings ?? []), ...(data.links.warnings ?? []), ...(data.continuity.warnings ?? [])],
        data
      };
    }
    if (command === "reindex") {
      const data = reindexProject(projectRoot);
      const stdout = data.changed.length === 0 ? "Registries already up to date\n" : `Updated ${data.changed.length} registries\n`;
      return { command, ok: true, stdout, errors: [], warnings: [], data };
    }
    const data = computeWordCounts(projectRoot, { write: true });
    const lines = data.chapters.map((chapter: { file: string; wordCount: number }) => `${chapter.file}: ${chapter.wordCount}`);
    lines.push(`Total: ${data.total}`);
    return { command, ok: true, stdout: `${lines.join("\n")}\n`, errors: [], warnings: [], data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { command, ok: false, stdout: `${message}\n`, errors: [message], warnings: [], data: null };
  }
}

export function storyHealth(root: string) {
  const report = runStoryOperation(root, "report");
  const next = runStoryOperation(root, "next");
  return { report, next };
}

function fromCheck(command: StoryCommandName, data: CheckResult, success: string): StoryOperationResult<CheckResult> {
  const errors = data.errors ?? [];
  const warnings = data.warnings ?? [];
  const lines = [data.ok ? success : `${label(command)} failed`];
  lines.push(...errors.map((error) => `error: ${error}`));
  lines.push(...warnings.map((warning) => `warning: ${warning}`));
  return { command, ok: data.ok, stdout: `${lines.join("\n")}\n`, errors, warnings, data };
}

function label(command: StoryCommandName) {
  return command.charAt(0).toUpperCase() + command.slice(1);
}
