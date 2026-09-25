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
  const normalized = withoutFencedCode(String(markdown))
    .replace(/`[^`]*`/g, " ")
    // Drop images; keep a link's visible text and drop only its target.
    // Bounded, so a long run of unclosed `[` or `(` stays linear.
    .replace(/!\[[^\]]{0,1000}\]\([^)]{0,1000}\)/g, " ")
    .replace(/\[([^\]]{0,1000})\]\([^)]{0,1000}\)/g, " $1 ")
    // A backslash escape (`didn\'t`) is the character it escapes.
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .replace(/[#>*_~|:]/g, " ");

  // Letters and digits in any script; apostrophes (straight or curly) and
  // hyphens join a word rather than split it, so "don\u2019t" and "well-known"
  // each count once. "U.S.A" is three words because the periods split it.
  return normalized.match(WORD_PATTERN) ?? [];
}

// A scene break paragraph: three or more of the same marker, optionally
// spaced (`* * *`, `---`, `~~~`), also when Pandoc escapes it (`\* \* \*`), or a
// lone `#` as in Scrivener and manuscript convention.
export function isSceneBreak(paragraph) {
  const text = String(paragraph).replace(/\\([*_~-])/g, "$1").trim();
  return text === "#" || /^([*_~-])( ?\1){2,}$/.test(text);
}

export function wordCount(markdown) {
  return splitWords(markdown).length;
}

// The prose of a chapter or matter page, without its outline and without
// HTML comments, which are notes to the author rather than book text.
// `commentReplacement` stands in for each comment (see scanComments).
export function chapterProse(markdownBody, commentReplacement = "") {
  return scanComments(proseSection(markdownBody), commentReplacement).text;
}

// True when the prose opens a comment it never closes, so the `<!--` and the
// text after it would show in the book.
export function hasUnclosedComment(prose) {
  return scanComments(String(prose)).unclosed;
}

// Removes HTML comments in one pass. Fenced code blocks and code spans are
// literal text, so a `<!--` inside them neither opens a comment nor closes
// one. Each segment is searched once for `-->`, so any number of unclosed
// openers stays linear.
// `replacement` stands in for each comment: builds drop comments outright,
// as CommonMark does, while prose analysis keeps words on either side apart.
export function scanComments(text, replacement = "") {
  let unclosed = false;
  const parts = splitFences(text).map((part) => {
    if (part.fenced) {
      return part.text;
    }
    let result = "";
    let position = 0;
    const source = part.text;
    while (position < source.length) {
      const open = source.indexOf("<!--", position);
      const tick = source.indexOf("`", position);
      if (open === -1) {
        result += source.slice(position);
        break;
      }
      if (tick !== -1 && tick < open) {
        // Keep a code span whole; an unmatched backtick is plain text.
        const lineEnd = source.indexOf("\n", tick) === -1 ? source.length : source.indexOf("\n", tick);
        const close = source.indexOf("`", tick + 1);
        const end = close !== -1 && close < lineEnd ? close + 1 : tick + 1;
        result += source.slice(position, end);
        position = end;
        continue;
      }
      const close = source.indexOf("-->", open + 4);
      if (close === -1) {
        unclosed = true;
        result += source.slice(position);
        break;
      }
      result += source.slice(position, open) + replacement;
      position = close + 3;
    }
    return result;
  });
  return { text: parts.join(""), unclosed };
}

// Line indexes inside closed backtick code fences, fence lines included.
// Only a backtick fence that closes counts: builds print fences as text,
// and manuscripts use `~~~` as a scene separator, so an unclosed fence or a
// tilde line never hides the text after it from counts and checks.
export function fencedLineIndexes(lines) {
  const fenced = new Set();
  let open = null;
  for (const [index, line] of lines.entries()) {
    const marker = /^ {0,3}(`{3,})/.exec(line);
    if (!marker) {
      continue;
    }
    if (open === null) {
      open = { index, fence: marker[1] };
    } else if (marker[1].length >= open.fence.length && line.trim() === marker[1]) {
      for (let inside = open.index; inside <= index; inside += 1) {
        fenced.add(inside);
      }
      open = null;
    }
  }
  return fenced;
}

// Splits markdown into closed fenced code blocks and the text between them.
export function splitFences(text) {
  const lines = text.split(/(?<=\n)/);
  const fenced = fencedLineIndexes(lines.map((line) => line.replace(/\r?\n$/, "")));
  const parts = [];
  for (const [index, line] of lines.entries()) {
    const isFenced = fenced.has(index);
    const last = parts[parts.length - 1];
    if (last && last.fenced === isFenced) {
      last.text += line;
    } else {
      parts.push({ fenced: isFenced, text: line });
    }
  }
  return parts;
}

export function withoutFencedCode(text) {
  return splitFences(text).map((part) => (part.fenced ? " " : part.text)).join("");
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
