// Markdown links in a record body: the parts outside link destinations and
// URLs, and the file targets of inline and reference-style links.

// Applies `transform` to the parts of `body` outside link destinations and
// URLs, leaving those untouched.
export function mapOutsideLinks(body, transform) {
  let result = "";
  let last = 0;
  for (const [start, end] of linksAndUrls(body)) {
    result += transform(body.slice(last, start)) + body.slice(start, end);
    last = end;
  }
  return result + transform(body.slice(last));
}

// Where a link, autolink, or bare URL can start: a `]`, a `<`, or a letter
// at the start of a word.
const LINK_OR_URL_START = /[\]<]|(?<![A-Za-z0-9_])[A-Za-z]/g;

const SCHEME_RUN = /[A-Za-z0-9+.-]*/y;

// Markdown link destinations, autolinks, and bare URLs, as [start, end]
// pairs in text order: text where a bare id token is part of a path or
// address, not a reference to this book's record. These are the matches of
// /\]\([^)\n]*\)|<[a-z][a-z0-9+.-]*:[^>\s]*>|\b[a-z][a-z0-9+.-]*:\/\/[^\s<>)\]]*/gi
// at any length, found without that regex: the next `)` or line break, and
// the next `>` or space, are found again only once passed, and a word that
// does not reach `://` is skipped whole, so a long line of unclosed `](` or
// `<a:`, or of letters and dots, stays linear.
function linksAndUrls(body) {
  const spans = [];
  const next = (pattern, from) => {
    pattern.lastIndex = from;
    return pattern.exec(body)?.index ?? -1;
  };
  let destinationEnd = -2;
  let autolinkEnd = -2;
  LINK_OR_URL_START.lastIndex = 0;
  for (let match; (match = LINK_OR_URL_START.exec(body)) !== null;) {
    const start = match.index;
    let end = -1;
    if (match[0] === "]") {
      if (body[start + 1] === "(") {
        if (destinationEnd !== -1 && destinationEnd < start + 2) {
          destinationEnd = next(/[)\n]/g, start + 2);
        }
        end = body[destinationEnd] === ")" ? destinationEnd + 1 : -1;
      }
    } else if (match[0] === "<") {
      SCHEME_RUN.lastIndex = start + 1;
      const colon = start + 1 + SCHEME_RUN.exec(body)[0].length;
      if (/[A-Za-z]/.test(body[start + 1] ?? "") && body[colon] === ":") {
        if (autolinkEnd !== -1 && autolinkEnd < colon + 1) {
          autolinkEnd = next(/[>\s]/g, colon + 1);
        }
        end = body[autolinkEnd] === ">" ? autolinkEnd + 1 : -1;
      }
    } else {
      SCHEME_RUN.lastIndex = start;
      const scheme = start + SCHEME_RUN.exec(body)[0].length;
      if (body.startsWith("://", scheme)) {
        const stop = next(/[\s<>)\]]/g, scheme + 3);
        end = stop === -1 ? body.length : stop;
      } else {
        // No later letter of this run of scheme characters reaches `://`
        // either, and none of them can start a link or autolink.
        LINK_OR_URL_START.lastIndex = scheme;
      }
    }
    if (end !== -1) {
      spans.push([start, end]);
      LINK_OR_URL_START.lastIndex = end;
    }
  }
  return spans;
}

// A reference-style link definition: indent, label, target.
export const LINK_DEFINITION_PATTERN = /^( {0,3}\[)([^\]\n]+)\]:[ \t]*(<[^>\n]*>|[^\s]+)/gm;

// The file targets of a body's inline and reference-style links, without
// any #fragment or ?query: validate checks them, and a dry run copies what
// they point at outside the project.
export function extractMarkdownLinkTargets(body) {
  const targets = [];
  // Each `](` up to the next `)`, as /\]\(([^)]+)\)/g would match, but
  // found with indexOf: when no `)` follows, that regex scans to the end
  // again from every `](`, which is quadratic.
  let open = body.indexOf("](");
  while (open !== -1) {
    const close = body.indexOf(")", open + 2);
    if (close === -1) {
      break;
    }
    if (close === open + 2) {
      open = body.indexOf("](", open + 1);
      continue;
    }
    // `[x](<a.md>)` and `[x](a.md "Title")` both link to a.md. An unquoted
    // space stays in the target so `(Bad Name.md)` is still reported. The
    // space before a title matches only from the start of its run, so a
    // long run of spaces stays linear.
    const inner = body.slice(open + 2, close).trim();
    const bracketed = /^<([^>]*)>/.exec(inner);
    const target = (bracketed ? bracketed[1] : inner.replace(/(?<!\s)\s+(?:"[^"]*"|'[^']*')$/, "")).trim();
    if (target && !/^(https?:|mailto:|#)/i.test(target)) {
      targets.push(target.split("#")[0].split("?")[0]);
    }
    open = body.indexOf("](", close + 1);
  }
  // Reference-style definitions: `[label]: ../characters/bo.md`.
  for (const definition of body.matchAll(LINK_DEFINITION_PATTERN)) {
    const target = definition[3].replace(/^<|>$/g, "").trim();
    if (target && !/^(https?:|mailto:|#)/i.test(target)) {
      targets.push(target.split("#")[0].split("?")[0]);
    }
  }
  return targets;
}
