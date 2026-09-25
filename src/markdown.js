export function kebabCase(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2018\u2019]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function titleCaseSlug(slug) {
  return String(slug)
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

const WORD_PATTERN = /[\p{L}\p{N}]+(?:['\u2019-][\p{L}\p{N}]+)*/gu;

export function splitWords(markdown) {
  const normalized = String(markdown)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    // Drop images; keep a link's visible text and drop only its target.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, " $1 ")
    .replace(/[#>*_~|:]/g, " ");

  // Letters and digits in any script; apostrophes (straight or curly) and
  // hyphens join a word rather than split it, so "don\u2019t" and "well-known"
  // each count once. "U.S.A" is three words because the periods split it.
  return normalized.match(WORD_PATTERN) ?? [];
}

export function wordCount(markdown) {
  return splitWords(markdown).length;
}

// The prose of a chapter or matter page, without its outline and without
// HTML comments, which are notes to the author rather than book text.
export function chapterProse(markdownBody) {
  // A comment written inside a code span is literal text.
  return proseSection(markdownBody).replace(/`[^`\n]*`|<!--[\s\S]*?-->/g, (match) => (match.startsWith("`") ? match : ""));
}

// True when the prose still opens a comment it never closes, so the rest of
// the text would show in the book with a stray `<!--`.
export function hasUnclosedComment(prose) {
  return String(prose).replace(/`[^`\n]*`/g, "").includes("<!--");
}

function proseSection(markdownBody) {
  const chapterTextMatch = /^## Chapter Text\s*$/im.exec(markdownBody);
  if (chapterTextMatch) {
    return markdownBody.slice(chapterTextMatch.index + chapterTextMatch[0].length);
  }

  const outlineMatch = /^## Outline\s*$/im.exec(markdownBody);
  if (!outlineMatch) {
    return stripLeadingH1(markdownBody);
  }

  const afterOutline = markdownBody.slice(outlineMatch.index + outlineMatch[0].length);
  const dividerMatch = /^\s*---\s*$/m.exec(afterOutline);
  return dividerMatch ? afterOutline.slice(dividerMatch.index + dividerMatch[0].length) : afterOutline;
}

export function extractSection(markdown, heading) {
  const escaped = escapeRegExp(heading);
  const pattern = new RegExp(`^## ${escaped}\\s*$`, "im");
  const match = pattern.exec(markdown);
  if (!match) {
    return "";
  }

  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const next = /^##\s+/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripLeadingH1(markdownBody) {
  const match = /^(?:[ \t]*\r?\n)*[ \t]{0,3}#(?!#)[ \t]+[^\r\n]*(?:\r?\n|$)/.exec(markdownBody);
  return match ? markdownBody.slice(match[0].length) : markdownBody;
}
