import { warn } from "./findings.js";
import { projectPath } from "./files.js";
import { checkSet, languagePack } from "./languages/index.js";
import { lowerCase, upperCase } from "./languages/locale.js";
import { escapeRegExp, maskMarkup, proseStart } from "./markdown.js";
import { existingNames, givenName } from "./names.js";
import { readMarkdown } from "./scan.js";
import { nfc } from "./unicode.js";
import { wholeWords, wordMatcher } from "./words.js";

// Where chapter prose names the bible's entities: `story mentions` lists
// each place, and `story continuity` compares them with each chapter's
// `characters`, `mentions`, and `locations`.
//
// A name matches as written, so a character called Rose is not found in
// "a rose", and as whole words, which in Chinese, Japanese, and Thai are
// found as story prose finds watch words. Only the first letter of a name
// of two or more words may differ in case ("The Hollow" matches "the
// Hollow"); a one-word name written in lower case also matches with a
// capital, at the start of a sentence. Possessives (Maren's) and hyphenated
// compounds (Vale-born) count. Each place in the text goes to the longest
// name found there, so "Edran Vale" is not also a mention of a location
// called Vale; a name two entities share counts for both. Names and prose
// are compared in NFC, so a name typed with é or が finds prose written
// with e + U+0301 or か + U+3099, and the other way round; lines, columns,
// and excerpts are those of the file as written.

// The entity kinds with a name to look for, as story mentions takes them.
export const MENTION_KINDS = ["character", "location", "faction", "artifact", "system", "term"];

const BLANKED = "\u0000";

// Every name and alias to look for, cut characters included, each once per
// entity, in NFC, with its pattern. A name that opens with titles or articles (the
// pack's `titleWords`) is also looked for without them, so "The Hollow" is
// found in "the whole Hollow" and "Captain Edran Vale" as "Edran Vale".
export function mentionNames(project) {
  const pack = project.pack ?? languagePack();
  const titles = checkSet(pack, "titleWords");
  const seen = new Set();
  const names = [];
  const add = (kind, id, name) => {
    const key = `${kind} ${id} ${name}`;
    if (name !== "" && !seen.has(key)) {
      seen.add(key);
      names.push({ kind, id, name, pattern: namePattern(name, pack) });
    }
  };
  for (const entry of existingNames(project, { cut: true })) {
    const name = nfc(entry.name);
    add(entry.kind, entry.id, name);
    add(entry.kind, entry.id, withoutTitles(name, titles, pack));
  }
  return names;
}

// `name` without the titles and articles it opens with (`titles`, the
// pack's `titleWords`), or `name` itself when it has none or is all titles.
function withoutTitles(name, titles, pack) {
  const words = name.split(/\s+/);
  const first = words.findIndex((word) => !titles?.has(lowerCase(word, pack).replace(/[.’']/g, "")));
  return titles && first > 0 ? words.slice(first).join(" ") : name;
}

// A name as a pattern for wordMatcher. Its words are apart by spaces, or by
// one line break as in a wrapped paragraph, never by a blank line that ends
// the paragraph.
function namePattern(name, pack) {
  const words = name.split(/\s+/);
  const body = words.map((word, index) => {
    const escape = (part) => escapeRegExp(part).replace(/['’]/g, "['’]");
    const [first, ...others] = Array.from(word);
    if (index > 0 || /['’]/.test(first)) {
      return escape(word);
    }
    const rest = escape(others.join(""));
    const upper = upperCase(first, pack);
    const lower = lowerCase(first, pack);
    // A lower-case one-word name may open a sentence; the first word of a
    // longer name may be either case. Otherwise the case is as written.
    const variants = words.length > 1 ? [first, upper, lower] : first === lower ? [first, upper] : [first];
    const unique = [...new Set(variants)].map(escapeRegExp);
    return `${unique.length === 1 ? unique[0] : `(?:${unique.join("|")})`}${rest}`;
  }).join("(?:[^\\S\\n]+|[^\\S\\n]*\\n[^\\S\\n]*)");
  return new RegExp(wholeWords(body, name), "gu");
}

// The chapter's prose as it sits in its file, and `offset`, where the
// prose starts in the file. Comments and code fences are blanked with a
// character that is neither a letter nor a space, keeping line breaks, so
// offsets and line numbers still match the file and no name runs across
// one. Null when the file cannot be read, which the scan has already
// reported.
export function chapterText(project, chapter) {
  let markdown;
  try {
    markdown = readMarkdown(chapter.file, project.root);
  } catch {
    return null;
  }
  const { body } = markdown;
  const masked = maskMarkup(body);
  const start = proseStart(body, masked);
  let text = "";
  for (let index = start; index < body.length; index += 1) {
    text += masked[index] === body[index] ? body[index] : BLANKED;
  }
  return { raw: markdown.rawMarkdown, text, offset: markdown.rawMarkdown.length - body.length + start };
}

// The names `names` finds in `text`, as { start, end, text, entities },
// in text order. Overlapping matches go to the longest; a span two names
// match exactly goes to every entity they belong to.
export function findMentions(text, names) {
  const find = wordMatcher(text);
  const spans = new Map();
  for (const entry of names) {
    for (const [start, end] of find(entry.pattern)) {
      const key = `${start}:${end}`;
      const span = spans.get(key) ?? { start, end, entities: [] };
      if (!span.entities.some((entity) => entity.kind === entry.kind && entity.id === entry.id)) {
        span.entities.push({ kind: entry.kind, id: entry.id });
      }
      spans.set(key, span);
    }
  }
  const ordered = [...spans.values()].sort((left, right) => (right.end - right.start) - (left.end - left.start) || left.start - right.start);
  const taken = [];
  const kept = [];
  for (const span of ordered) {
    if (taken.some(([start, end]) => span.start < end && start < span.end)) {
      continue;
    }
    taken.push([span.start, span.end]);
    kept.push({ ...span, text: text.slice(span.start, span.end) });
  }
  return kept.sort((left, right) => left.start - right.start);
}

// Whether a one-word name at `start` opens a sentence while the chapter
// also uses it as an ordinary lower-case word ("Rose from her chair" in a
// chapter with "a rose"), so the capital may be the sentence's, not the
// name's. Used only by the continuity check; story mentions lists every
// match.
export function ambiguousMention(text, mention, pack, find = wordMatcher(text)) {
  if (/\s/u.test(mention.text)) {
    return false;
  }
  const written = nfc(mention.text);
  const lower = lowerCase(written, pack);
  if (lower === written || !opensSentence(text, mention.start)) {
    return false;
  }
  return find(new RegExp(wholeWords(escapeRegExp(lower), lower), "gu"), { first: true }).length > 0;
}

function opensSentence(text, start) {
  const before = text.slice(Math.max(0, start - 200), start).replace(/[ \t"'“”‘’«»„()[\]*_>#—–-]+$/u, "");
  if (before === "" || before.endsWith("\n")) {
    return true;
  }
  return /[.!?…]$/u.test(before.trimEnd());
}

// Mentions with the line and column they are on in the chapter file, and
// the line itself, trimmed.
export function locateMentions(chapterProse, mentions) {
  const { raw, offset } = chapterProse;
  let line = 1;
  let lineStart = 0;
  let position = 0;
  return mentions.map((mention) => {
    const at = offset + mention.start;
    for (; position < at; position += 1) {
      if (raw[position] === "\n") {
        line += 1;
        lineStart = position + 1;
      }
    }
    const lineEnd = raw.indexOf("\n", at);
    const lineText = raw.slice(lineStart, lineEnd === -1 ? raw.length : lineEnd).replace(/\r$/, "");
    return { ...mention, line, column: at - lineStart + 1, excerpt: excerpt(lineText, at - lineStart, mention.text.length) };
  });
}

const EXCERPT_RADIUS = 60;

function excerpt(lineText, column, length) {
  const from = Math.max(0, column - EXCERPT_RADIUS);
  const to = Math.min(lineText.length, column + length + EXCERPT_RADIUS);
  return `${from > 0 ? "…" : ""}${lineText.slice(from, to).trim()}${to < lineText.length ? "…" : ""}`;
}

// The ids a chapter's frontmatter lists for an entity kind, or null for a
// kind chapters do not list.
export function listedIds(chapter, kind) {
  if (kind === "character") {
    return new Set([chapter.pov, ...chapter.characters, ...chapter.mentions].filter(Boolean));
  }
  if (kind === "location") {
    return new Set(chapter.locations);
  }
  if (kind === "artifact") {
    return new Set(chapter.mentions);
  }
  return null;
}

// Findings on names in each drafted chapter's prose. `named-not-listed`:
// the prose names a character its frontmatter lists in none of `pov`,
// `characters`, or `mentions`. With `unnamed`, also `mention-not-named`: a
// character or artifact in its `mentions` that the prose never names.
// story continuity runs only the first; story mentions with no entity runs
// both, since a mention by relationship alone ("her father") is common.
// Characters in `characters` are never checked for a name, since a POV "I"
// or a pronoun is often all the page gives them. Locations are named in
// passing more often than they are visited, and artifacts have no list
// for being present, so neither is checked for a missing listing. Cut
// characters are left to the cut-character checks.
export function auditMentions(project, { unnamed = false } = {}) {
  const warnings = [];
  const drafted = project.chapters.filter((chapter) => chapter.status !== "outline");
  if (drafted.length === 0) {
    return warnings;
  }
  const pack = project.pack ?? languagePack();
  const cut = new Set(project.characters.filter((character) => character.status === "cut").map((character) => character.id));
  const names = mentionNames(project);
  const known = new Set(names.map((entry) => `${entry.kind} ${entry.id}`));
  for (const chapter of drafted) {
    const prose = chapterText(project, chapter);
    if (prose === null || prose.text.trim() === "") {
      continue;
    }
    const label = projectPath(project.root, chapter.file);
    const find = wordMatcher(prose.text);
    const mentions = findMentions(prose.text, names);
    const named = new Set();
    const unlisted = new Map();
    const listed = listedIds(chapter, "character");
    for (const mention of mentions) {
      for (const entity of mention.entities) {
        named.add(`${entity.kind} ${entity.id}`);
      }
      // A name two entities share does not say which one is meant.
      if (mention.entities.length !== 1) {
        continue;
      }
      const [{ kind, id }] = mention.entities;
      if (kind !== "character" || cut.has(id) || listed.has(id) || unlisted.has(id)) {
        continue;
      }
      if (!ambiguousMention(prose.text, mention, pack, find)) {
        unlisted.set(id, mention.text);
      }
    }
    for (const id of [...unlisted.keys()].sort()) {
      warnings.push(warn("named-not-listed", `${label} names character ${id} ("${unlisted.get(id)}") but does not list them in characters or mentions`, label, chapter.id));
    }
    if (!unnamed) {
      continue;
    }
    for (const id of [...new Set(chapter.mentions)].sort()) {
      if (id === chapter.pov || cut.has(id)) {
        continue;
      }
      const kind = known.has(`character ${id}`) ? "character" : known.has(`artifact ${id}`) ? "artifact" : null;
      // A missing id is a links error, not this check's.
      if (kind !== null && !named.has(`${kind} ${id}`)) {
        warnings.push(warn("mention-not-named", `${label} lists ${kind} ${id} in mentions but never names it; add the name the chapter uses as an alias, or drop the mention`, label, chapter.id));
      }
    }
  }
  return warnings;
}

// story mentions: every place drafted chapter prose names one entity. An
// outline chapter's body is planning notes, which auditMentions skips too.
export function entityMentions(project, kind, id) {
  const entries = mentionNames(project);
  const own = entries.filter((entry) => entry.kind === kind && entry.id === id);
  const chapters = [];
  const matches = [];
  for (const chapter of project.chapters.filter((entry) => entry.status !== "outline")) {
    const prose = chapterText(project, chapter);
    if (prose === null) {
      continue;
    }
    const file = projectPath(project.root, chapter.file);
    const found = locateMentions(prose, findMentions(prose.text, entries).filter((mention) => mention.entities.some((entity) => entity.kind === kind && entity.id === id)));
    const listed = listedIds(chapter, kind);
    if (found.length > 0 || listed?.has(id)) {
      chapters.push({ chapter: chapter.id, file, count: found.length, listed: listed === null ? null : listed.has(id) });
    }
    for (const mention of found) {
      matches.push({ chapter: chapter.id, file, line: mention.line, column: mention.column, text: mention.text, excerpt: mention.excerpt });
    }
  }
  return { names: own.map((entry) => entry.name), chapters, matches };
}

export function formatMentions(report) {
  // A name wrapped onto the next line prints on one.
  const lines = report.matches.map((match) => `${match.file}:${match.line}:${match.column}: ${match.text.replace(/\s+/gu, " ")}: ${match.excerpt}`);
  const heading = `${report.kind} ${report.id} (${report.names.join(", ")})`;
  if (report.matches.length === 0) {
    lines.push(`No mentions of ${heading} in chapter prose`);
  } else {
    const chapters = report.chapters.filter((chapter) => chapter.count > 0).length;
    lines.push(`${report.matches.length} ${report.matches.length === 1 ? "mention" : "mentions"} of ${heading} in ${chapters} ${chapters === 1 ? "chapter" : "chapters"}`);
  }
  for (const chapter of report.chapters) {
    if (chapter.listed === false) {
      lines.push(`${chapter.file} names it but does not list it`);
    } else if (chapter.listed && chapter.count === 0) {
      lines.push(`${chapter.file} lists it but its prose never names it`);
    }
  }
  return `${lines.join("\n")}\n`;
}

const RENAME_COLLECTIONS = {
  character: ["characters", "name"],
  location: ["locations", "name"],
  faction: ["factions", "name"],
  artifact: ["artifacts", "name"],
  system: ["systems", "name"],
  term: ["glossaryTerms", "term"]
};

// The spaces, or the one line break, between two words of a name in prose.
const NAME_GAP = /([^\S\n]+|[^\S\n]*\n[^\S\n]*)/u;

// story rename --prose: the forms of entity `kind` `id`'s name that prose
// may use, each with the form of `newName` it becomes, the longest first.
// The full name and the name without its titles ("Edran Vale" for "Captain
// Edran Vale") become the new name in the same form, and a character's
// given name alone becomes the new given name. An old name with no titles
// becomes the new name without its titles too, since a title the prose
// puts before it ("Captain Edran Vale" for a character named "Edran Vale")
// stays in the prose.
function renameForms(project, kind, id, newName, pack, titles) {
  const [collection, field] = RENAME_COLLECTIONS[kind];
  const entity = project[collection].find((entry) => entry.id === id);
  const oldName = nfc(String(entity?.[field] ?? "").trim());
  const target = String(newName).trim();
  const oldBare = withoutTitles(oldName, titles, pack);
  const targetBare = withoutTitles(target, titles, pack);
  const forms = [[oldName, oldBare === oldName ? targetBare : target], [oldBare, targetBare]];
  const given = kind === "character" ? givenName(oldName, pack) : "";
  if (given !== "") {
    forms.push([given, givenName(target, pack) || target]);
  }
  return forms.map(([from, to]) => ({ pattern: new RegExp(`^(?:${namePattern(from, pack).source})$`, "u"), from, to }));
}

// The first name a rename would write into the prose that is already a
// name, alias, or given name of another entity, as { name, kind, id }, or
// null. A form the rename leaves as it is (a surname-only change keeps the
// given name) is not checked, since the prose already shares it.
function renameClash(forms, names, kind, id, pack) {
  const others = new Map();
  for (const entry of names) {
    if (entry.kind !== kind || entry.id !== id) {
      others.set(lowerCase(entry.name, pack), entry);
    }
  }
  for (const { from, to } of forms) {
    const other = nfc(to) === from ? undefined : others.get(lowerCase(nfc(to), pack));
    if (other) {
      return { name: to, kind: other.kind, id: other.id };
    }
  }
  return null;
}

// story rename --prose: the edits that rename entity `kind` `id` to
// `newName` in drafted chapter prose, found as story mentions finds them,
// with each form of the name replaced as renameForms gives it. Aliases are
// left as written, since a nickname usually outlives a change of name, and
// so is a span the name shares with another entity, which `shared` lists.
// A possessive or hyphenated suffix stays, since it lies outside the match.
// Returns { clash } when the new name would be another entity's in the
// prose (see renameClash), and otherwise { files, edits, aliases, shared }:
// `files` maps each chapter file to { original, next }, `edits` lists each
// replacement as { file, line, endLine, column, from, to }, where endLine
// is the last line of a name wrapped across lines, `aliases` counts the
// alias mentions left, and `shared` lists the shared spans as { file,
// line, column, text }.
export function proseRenames(project, kind, id, newName) {
  const pack = project.pack ?? languagePack();
  const titles = checkSet(pack, "titleWords");
  const forms = renameForms(project, kind, id, newName, pack, titles);
  const names = mentionNames(project);
  const clash = renameClash(forms, names, kind, id, pack);
  if (clash) {
    return { clash };
  }
  const result = { files: new Map(), edits: [], aliases: 0, shared: [] };
  // A chapter that cannot be read is left out; the scan has reported it.
  const drafted = project.chapters.filter((entry) => entry.status !== "outline")
    .map((chapter) => [chapter, chapterText(project, chapter)])
    .filter(([, prose]) => prose !== null);
  for (const [chapter, prose] of drafted) {
    const file = projectPath(project.root, chapter.file);
    const own = findMentions(prose.text, names).filter((mention) => mention.entities.some((entry) => entry.kind === kind && entry.id === id));
    const located = locateMentions(prose, own);
    let next = "";
    let copied = 0;
    own.forEach((mention, index) => {
      const where = { file, line: located[index].line, column: located[index].column };
      if (mention.entities.length > 1) {
        result.shared.push({ ...where, text: mention.text });
        return;
      }
      const written = nfc(mention.text);
      const form = forms.find(({ pattern }) => pattern.test(written));
      if (!form) {
        result.aliases += 1;
        return;
      }
      const replacement = renamedText(written, form.from, form.to, pack, titles);
      if (replacement === mention.text) {
        return;
      }
      const start = prose.offset + mention.start;
      next += `${prose.raw.slice(copied, start)}${replacement}`;
      copied = prose.offset + mention.end;
      const endLine = where.line + (mention.text.match(/\n/gu)?.length ?? 0);
      result.edits.push({ file, line: where.line, endLine, column: where.column, from: mention.text, to: replacement });
    });
    if (copied > 0) {
      result.files.set(chapter.file, { original: prose.raw, next: `${next}${prose.raw.slice(copied)}` });
    }
  }
  return result;
}

// `to` in the shape of `written`, the prose's match for name form `from`:
// with `written`'s gaps between words, so a name wrapped across lines
// keeps its line break where the new name has words to keep it between,
// and with its first letter cased as `written`'s when that differs from
// `from`'s ("the Hollow", or "Rose" opening a sentence for a name written
// "rose"). Only the first letter can differ, since a name matches as
// written otherwise, and its case carries over only when `from` and `to`
// both open with a title or article or neither does, so "the Hollow"
// renamed to "Deep" is "Deep", not "deep".
function renamedText(written, from, to, pack, titles) {
  const gaps = written.split(NAME_GAP).filter((part, index) => index % 2 === 1);
  const words = to.split(/\s+/u);
  let text = words.map((word, index) => (index === 0 ? word : `${gaps[index - 1] ?? " "}${word}`)).join("");
  const [first] = Array.from(written);
  const [named] = Array.from(from);
  const opensWithTitle = (name) => Boolean(titles?.has(lowerCase(name.split(/\s+/u)[0], pack).replace(/[.’']/g, "")));
  if (first !== named && opensWithTitle(from) === opensWithTitle(to)) {
    const [lead] = Array.from(text);
    const cased = first === upperCase(first, pack) ? upperCase(lead, pack) : lowerCase(lead, pack);
    text = `${cased}${text.slice(lead.length)}`;
  }
  return text;
}
