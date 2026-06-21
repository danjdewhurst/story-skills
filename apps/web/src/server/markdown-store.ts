import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter, stringifyFrontmatter } from "../../../../src/frontmatter.js";
import { runStoryOperation } from "./story-cli";

export interface MarkdownDocument {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  raw: string;
}

export function readMarkdownDocument(projectRoot: string, relativePath: string): MarkdownDocument {
  const fullPath = safeProjectPath(projectRoot, relativePath, { mustExist: true });
  const raw = fs.readFileSync(fullPath, "utf8");
  const parsed = parseFrontmatter(raw, fullPath);
  return { path: relativePath, frontmatter: parsed.data as Record<string, unknown>, body: parsed.body, raw };
}

export function saveMarkdownDocument(projectRoot: string, relativePath: string, frontmatter: Record<string, unknown>, body: string) {
  const fullPath = safeProjectPath(projectRoot, relativePath, { mustExist: true });
  const next = `${stringifyFrontmatter(frontmatter)}${body.replace(/^\n+/, "")}`;
  fs.writeFileSync(fullPath, next, "utf8");
  return { document: readMarkdownDocument(projectRoot, relativePath), validation: runStoryOperation(projectRoot, "validate") };
}

export function safeProjectPath(projectRoot: string, relativePath: string, options: { mustExist?: boolean } = {}) {
  if (path.isAbsolute(relativePath) || relativePath.includes("\0")) throw new Error(`Invalid project path: ${relativePath}`);
  const root = fs.realpathSync(projectRoot);
  const resolved = path.resolve(root, relativePath);
  const real = options.mustExist ? fs.realpathSync(resolved) : resolved;
  const relative = path.relative(root, real);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${relativePath} is outside project root`);
  return real;
}
