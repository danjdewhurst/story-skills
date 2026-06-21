import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "../../../../src/frontmatter.js";

export interface StoryProjectSummary {
  id: string;
  title: string;
  root: string;
  relativePath: string;
  status: string;
  genre: string;
}

export function defaultWorkspaceRoot(cwd = process.cwd()) {
  return process.env.STORY_STUDIO_WORKSPACE
    ? path.resolve(process.env.STORY_STUDIO_WORKSPACE)
    : path.resolve(cwd, "examples");
}

export function listStoryProjects(workspaceRoot = defaultWorkspaceRoot()): StoryProjectSummary[] {
  const root = realDirectory(workspaceRoot);
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .filter((candidate) => fs.existsSync(path.join(candidate, "story.md")))
    .map((projectRoot) => summariseProject(root, projectRoot))
    .sort((left, right) => left.title.localeCompare(right.title));
}

export function resolveStoryProject(id: string, workspaceRoot = defaultWorkspaceRoot()) {
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) throw new Error(`Invalid project id: ${id}`);
  const root = realDirectory(workspaceRoot);
  const projectRoot = realDirectory(path.join(root, id));
  assertInside(root, projectRoot);
  if (!fs.existsSync(path.join(projectRoot, "story.md"))) throw new Error(`No story.md found for ${id}`);
  return projectRoot;
}

function summariseProject(workspaceRoot: string, projectRoot: string): StoryProjectSummary {
  const realRoot = realDirectory(projectRoot);
  assertInside(workspaceRoot, realRoot);
  const markdown = fs.readFileSync(path.join(realRoot, "story.md"), "utf8");
  const frontmatter = parseFrontmatter(markdown, path.join(realRoot, "story.md")).data as Record<string, unknown>;
  const relativePath = path.relative(workspaceRoot, realRoot);
  return {
    id: relativePath.split(path.sep).join("/"),
    title: String(frontmatter.title ?? path.basename(realRoot)),
    root: realRoot,
    relativePath,
    status: String(frontmatter.status ?? "unknown"),
    genre: [frontmatter.genre, frontmatter["sub-genre"]].filter(Boolean).join(" / ")
  };
}

function realDirectory(target: string) {
  const real = fs.realpathSync(path.resolve(target));
  const stat = fs.statSync(real);
  if (!stat.isDirectory()) throw new Error(`${target} is not a directory`);
  return real;
}

function assertInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${candidate} is outside workspace ${root}`);
  }
}
