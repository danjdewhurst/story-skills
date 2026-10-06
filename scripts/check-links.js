#!/usr/bin/env node
/**
 * Check relative links and #anchors in the repository's markdown.
 *
 * Covers README.md, CONTRIBUTING.md, and every .md file under docs/,
 * skills/, and templates/, plus README.md files under examples/. A link to a
 * file or folder must exist; a #fragment on a link to a markdown file (or on
 * a bare #fragment link) must match a heading slug or an explicit
 * <a id/name> anchor there. Fenced code, inline code, HTML comments, links
 * with a scheme (https:, mailto:), and template placeholders such as
 * {name-kebab}.md are skipped. Run from anywhere; exits non-zero on failure.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const ROOT_FILES = ["README.md", "CONTRIBUTING.md"];
const MARKDOWN_DIRS = ["docs", "skills", "templates"];
const README_DIRS = ["examples"];

function walk(dir, accept, out) {
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    // Directory symlinks are not followed: plugins/story-skills points back
    // at the repository root.
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, accept, out);
    } else if (entry.isFile() && accept(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

export function markdownFiles(root = ROOT) {
  const files = ROOT_FILES.map((name) => path.join(root, name)).filter((file) => fs.existsSync(file));
  for (const dir of MARKDOWN_DIRS) {
    walk(path.join(root, dir), (name) => name.endsWith(".md"), files);
  }
  for (const dir of README_DIRS) {
    walk(path.join(root, dir), (name) => name === "README.md", files);
  }
  return files;
}

function blank(text) {
  return text.replace(/[^\n]/g, " ");
}

// Replaces YAML frontmatter, fenced code blocks, and HTML comments with
// spaces, keeping every newline so offsets map to the same line numbers as
// the source.
export function maskBlocks(text) {
  const lines = text.split("\n");
  let fence = null;
  let frontmatter = lines[0]?.trimEnd() === "---";
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (frontmatter) {
      if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) {
        frontmatter = false;
      }
      lines[i] = blank(line);
      continue;
    }
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
        fence = null;
      }
      lines[i] = blank(line);
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (open && !(open[1][0] === "`" && line.slice(open[0].length).includes("`"))) {
      fence = open[1];
      lines[i] = blank(line);
    }
  }
  return lines.join("\n").replace(/<!--[\s\S]*?-->/g, blank);
}

// maskBlocks, then inline code spans too. A code span closes on a backtick
// run of the same length.
export function maskCode(text) {
  return maskBlocks(text).replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, blank);
}

// GitHub's heading anchors: lowercase, drop everything but letters, marks,
// numbers, connector punctuation (_), spaces, and hyphens, then turn each
// space into a hyphen. A repeated slug gets -1, -2, ... in document order.
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

// Reduces heading markdown to the text GitHub renders, which is what it slugs.
export function headingText(raw) {
  return raw
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/`/g, "")
    .replace(/(^|[^\p{L}\p{N}])(_{1,3})(?=\S)(.+?)(?<=\S)\2(?![\p{L}\p{N}])/gu, "$1$3")
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .trim();
}

export function anchorsFor(text) {
  // Headings keep their code spans: GitHub slugs the code text.
  const lines = maskBlocks(text).split("\n");
  const seen = new Map();
  const anchors = new Set();
  const add = (heading) => {
    const base = slugify(headingText(heading));
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  };
  for (let i = 0; i < lines.length; i += 1) {
    const atx = /^ {0,3}#{1,6}(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(lines[i]);
    if (atx) {
      add(atx[1] ?? "");
      continue;
    }
    // Setext: a paragraph line underlined with === or ---.
    const next = lines[i + 1];
    if (next !== undefined && /^ {0,3}(=+|-+)[ \t]*$/.test(next) && lines[i].trim() !== "" && !/^ {0,3}([-*+>|]|\d+[.)])/.test(lines[i])) {
      add(lines[i].trim());
      i += 1;
    }
  }
  for (const match of maskCode(text).matchAll(/<a\s[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)) {
    anchors.add(match[1]);
  }
  return anchors;
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
    }
  }
  return line;
}

// Returns every link destination with its 1-based line: inline links and
// images (with or without a title), reference definitions, and HTML href/src.
export function extractLinks(text) {
  const masked = maskCode(text);
  const links = [];
  const push = (raw, index) => {
    let target = raw.trim();
    if (target.startsWith("<") && target.endsWith(">")) {
      target = target.slice(1, -1);
    }
    links.push({ target, line: lineAt(masked, index) });
  };
  const inline = /!?\[(?:[^[\]\\]|\\.|\[(?:[^[\]\\]|\\.)*\])*\]\(\s*(<[^<>\n]*>|(?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))*)(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\s*\)/g;
  for (const match of masked.matchAll(inline)) {
    push(match[1], match.index);
  }
  for (const match of masked.matchAll(/^ {0,3}\[(?:[^[\]\\]|\\.)+\]:[ \t]*(<[^<>\n]*>|\S+)/gm)) {
    push(match[1], match.index);
  }
  for (const match of masked.matchAll(/<(?:a|img|source)\s[^>]*?\b(?:href|src|srcset)\s*=\s*["']([^"']+)["']/gi)) {
    push(match[1], match.index);
  }
  return links;
}

// Links that are not local paths, or are templates rather than real paths.
export function isSkipped(target) {
  return target === ""
    || /^[a-z][a-z0-9+.-]*:/i.test(target)
    || target.startsWith("//")
    || /[{}]|\$\{|<|>/.test(target);
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function checkFile(file, root = ROOT, cache = new Map()) {
  const failures = [];
  const text = fs.readFileSync(file, "utf8");
  const relative = path.relative(root, file);
  const anchors = (target) => {
    if (!cache.has(target)) {
      cache.set(target, anchorsFor(fs.readFileSync(target, "utf8")));
    }
    return cache.get(target);
  };
  for (const { target, line } of extractLinks(text)) {
    if (isSkipped(target)) {
      continue;
    }
    const hashAt = target.indexOf("#");
    const filePart = decode(hashAt === -1 ? target : target.slice(0, hashAt)).replace(/\?.*$/, "");
    const fragment = hashAt === -1 ? null : decode(target.slice(hashAt + 1));
    const resolved = filePart === ""
      ? file
      : filePart.startsWith("/")
        ? path.join(root, filePart)
        : path.resolve(path.dirname(file), filePart);
    if (!fs.existsSync(resolved)) {
      failures.push(`${relative}:${line}: ${target} points at a missing file`);
      continue;
    }
    if (fragment === null || fragment === "" || !resolved.endsWith(".md") || !fs.statSync(resolved).isFile()) {
      continue;
    }
    // GitHub's line anchors (#L12, #L12-L20) are not headings.
    if (/^L\d+(-L\d+)?$/.test(fragment)) {
      continue;
    }
    if (!anchors(resolved).has(fragment.toLowerCase()) && !anchors(resolved).has(fragment)) {
      failures.push(`${relative}:${line}: ${target} has no heading or anchor #${fragment} in ${path.relative(root, resolved)}`);
    }
  }
  return failures;
}

export function checkLinks(root = ROOT) {
  const cache = new Map();
  const files = markdownFiles(root);
  const failures = files.flatMap((file) => checkFile(file, root, cache));
  return { files, failures };
}

function main() {
  const { files, failures } = checkLinks();
  if (failures.length > 0) {
    console.error(`Broken links:\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log(`Links are valid in ${files.length} markdown files.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
