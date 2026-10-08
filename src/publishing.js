import { storyDateError } from "./continuity.js";
import { err, warn } from "./findings.js";
import { DEFAULT_LANGUAGE, fillLabel, isLanguageTag, joinNames, LABEL_KEYS, languagePack, lookupTag, projectLanguage } from "./languages/index.js";
import { COUNT_LABELS, dropCountForms } from "./languages/locale.js";
import { countTodoMarkers } from "./markdown.js";
import { chapterNumerals } from "./numerals.js";
import { isBookNumber, seriesDisplayName } from "./series.js";

// Publishing metadata kept in story.md: what retailers, distributors, and the
// EPUB package need. Every field is optional; validate checks the shape and
// the build formats read it.

export const MAX_KEYWORDS = 7;
const BISAC_PATTERN = /^[A-Z]{3}\d{6}$/;
const SCALAR_FIELDS = ["author", "surname", "short-title", "language", "isbn", "publisher", "publication-date", "description", "copyright", "cover-alt", "ai-disclosure", "chapter-label", "contents-label"];

// A `[TODO: author to supply]` marker, which the publishing skill leaves
// rather than inventing a value. Builds and the readiness checklist treat it
// as missing so it never reaches a retailer.
export function isPlaceholder(value) {
  return typeof value === "string" && /^\[TODO\b/i.test(value.trim());
}

// Languages written right to left, by primary subtag, and the scripts that
// make any language right to left (az-Arab, pa-Arab). A Latin or other script
// subtag makes a listed language left to right (ku-Latn).
const RTL_LANGUAGES = new Set(["ar", "arc", "ckb", "dv", "fa", "he", "iw", "ji", "ks", "ku", "ps", "sd", "syr", "ug", "ur", "yi"]);
const RTL_SCRIPTS = new Set(["adlm", "arab", "hebr", "mand", "nkoo", "rohg", "samr", "syrc", "thaa"]);

// The tag is read as the language packs read it (lookupTag), so an alias
// (fas, per, heb, iw) or an extlang under a right-to-left macrolanguage
// (ar-arz) gets the same direction as its pack's language.
export function textDirection(language) {
  const [lookup, macrolanguage] = lookupTag(String(language ?? "").trim() || DEFAULT_LANGUAGE);
  const [primary, ...subtags] = lookup.split("-");
  // The script is the subtag right after the language. A four-letter subtag
  // later on belongs to an extension or private use (en-u-nu-arab).
  const script = /^[a-z]{4}$/.test(subtags[0] ?? "") ? subtags[0] : undefined;
  if (script !== undefined) {
    return RTL_SCRIPTS.has(script) ? "rtl" : "ltr";
  }
  return RTL_LANGUAGES.has(primary) || RTL_LANGUAGES.has(macrolanguage) ? "rtl" : "ltr";
}

// A name field that takes one name or a list (story.md `editor`, chapter
// `author`), as a list of trimmed names without blanks or placeholders.
export function nameList(value) {
  const names = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  return names.filter((name) => typeof name === "string" && name.trim() !== "" && !isPlaceholder(name)).map((name) => name.trim());
}

// The title page's credit lines: the authors' names, then the editors'
// with the `edited-by` label. A collection by one writer has the first, an
// anthology the second, and either can be missing, from the book or from
// metadata a caller built without that list.
export function creditLines(meta) {
  const authors = meta.authors ?? [];
  const editors = meta.editors ?? [];
  const lines = [];
  if (authors.length > 0) {
    lines.push(joinNames(authors, meta.labels));
  }
  if (editors.length > 0) {
    lines.push(fillLabel(meta.labels, "edited-by", { names: joinNames(editors, meta.labels) }));
  }
  return lines;
}

// The one name a running head or a format's author field carries: the
// authors, or the editors of a book with no author of its own.
export function leadNames(meta) {
  return joinNames(meta.authors.length > 0 ? meta.authors : meta.editors, meta.labels);
}

// A chapter's byline in the book's language ("by Ben Other"), or "" for a
// chapter without its own author.
export function chapterByline(names, labels) {
  return names.length === 0 ? "" : fillLabel(labels, "byline", { names: joinNames(names, labels) });
}

export function publishingMeta(data) {
  const text = (field) => (typeof data[field] === "string" && !isPlaceholder(data[field]) ? data[field].trim() : "");
  const list = (field) => (Array.isArray(data[field]) ? data[field].filter((item) => typeof item === "string" && item.trim() !== "" && !isPlaceholder(item)).map((item) => item.trim()) : []);
  const authors = list("authors");
  const author = text("author");
  const pack = languagePack(projectLanguage(data));
  return {
    authors: authors.length > 0 ? authors : author === "" ? [] : [author],
    // A collection's or anthology's editors, credited apart from its authors.
    editors: nameList(data.editor),
    // The Shunn running head's surname and short title, when the ones the
    // builds derive from the first author and the title are wrong.
    surname: text("surname"),
    shortTitle: text("short-title"),
    language: text("language") || "en",
    // "vertical" sets a Japanese or Chinese book in columns; see typesetting.js.
    writingMode: text("writing-mode") || "horizontal",
    // The numeral system chapter headings print their numbers in (latn,
    // jpan, arab); see numerals.js.
    chapterNumerals: chapterNumerals(data),
    // An unquoted ISBN-13 parses as a number, so accept that too.
    isbn: normalizeIsbn(typeof data.isbn === "number" ? String(data.isbn) : text("isbn")),
    publisher: text("publisher"),
    publicationDate: text("publication-date"),
    description: text("description"),
    keywords: list("keywords"),
    subjects: list("subjects"),
    copyright: text("copyright"),
    coverAlt: text("cover-alt"),
    aiDisclosure: text("ai-disclosure"),
    // Generated text in the language's words, and its narration pace in
    // the pack's count unit (`countUnit`), which story.md can override.
    labels: buildLabels(data, pack),
    narrationRate: pack.narrationRate,
    countUnit: pack.countUnit
  };
}

// The build labels for a book: English, then the language pack's, then
// story.md's `chapter-label` and `contents-label`, then its `labels:` list.
// A chapter label without `{n}` takes the number after it ("Teil 3"). A
// blank label is unset, so no title, heading, or landmark comes out empty,
// except `by`, where blank leaves the Shunn byline's "by" line out. A book's
// own `labels:` entry for a length label also replaces the pack's count
// forms of it, so the book's wording holds for every count (see COUNT_LABELS).
export function buildLabels(data, pack = languagePack(projectLanguage(data))) {
  const labels = { ...languagePack("en").labels, ...pack.labels };
  const set = (key, value) => {
    if (typeof value !== "string" || isPlaceholder(value) || isBlankLabel(key, value)) {
      return false;
    }
    labels[key] = key !== "chapter" ? value : value.includes("{n}") ? value.trim() : `${value.trim()} {n}`;
    return true;
  };
  set("chapter", data["chapter-label"]);
  set("contents", typeof data["contents-label"] === "string" ? data["contents-label"].trim() : undefined);
  for (const [key, value] of labelEntries(data.labels)) {
    if (LABEL_KEYS.includes(key) && set(key, value) && COUNT_LABELS.includes(key)) {
      dropCountForms(labels, key);
    }
  }
  return labels;
}

// story.md `labels:` as [key, value] pairs. The frontmatter has no nested
// maps, so it is a list of `- key: text` entries.
function labelEntries(value) {
  return Array.isArray(value) ? value.filter(isEntry).flatMap((entry) => Object.entries(entry)) : [];
}

// Whether a label value counts as unset for being blank.
function isBlankLabel(key, value) {
  return key !== "by" && value.trim() === "";
}

function isEntry(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validatePublishing(data, errors, warnings) {
  for (const field of SCALAR_FIELDS) {
    if (data[field] !== undefined && typeof data[field] !== "string" && !(field === "isbn" && typeof data[field] === "number")) {
      errors.push(err("field-not-text", `story.md frontmatter field ${field} must be text`, "story.md"));
    }
  }
  for (const field of ["keywords", "subjects", "authors"]) {
    if (data[field] !== undefined && (!Array.isArray(data[field]) || data[field].some((item) => typeof item !== "string"))) {
      errors.push(err("field-not-list", `story.md frontmatter field ${field} must be a list of text`, "story.md"));
    }
  }
  validateNames(data, "editor", "story.md", errors);
  if (data.labels !== undefined) {
    if (!Array.isArray(data.labels) || !data.labels.every(isEntry)) {
      errors.push(err("field-not-list", "story.md frontmatter field labels must be a list of label: text entries, such as - chapter: Teil {n}", "story.md"));
    } else {
      for (const [key, value] of labelEntries(data.labels)) {
        if (!LABEL_KEYS.includes(key)) {
          warnings.push(warn("unknown-label", `story.md labels entry ${key} is not a build label; builds ignore it (see docs/manuscripts.md#build-labels)`, "story.md"));
        } else if (typeof value !== "string") {
          errors.push(err("field-not-text", `story.md labels entry ${key} must be text`, "story.md"));
        } else if (isPlaceholder(value)) {
          warnings.push(warn("todo-placeholder", `story.md labels entry ${key} is still a [TODO] placeholder; builds use the language's own text`, "story.md"));
        } else if (isBlankLabel(key, value)) {
          warnings.push(warn("blank-label", `story.md labels entry ${key} is blank; builds use the language's own text`, "story.md"));
        }
      }
    }
  }
  if (typeof data.language === "string" && !isPlaceholder(data.language) && !isLanguageTag(data.language)) {
    errors.push(err("invalid-language", `story.md language ${data.language} must be a BCP 47 tag such as en, en-GB, or fr`, "story.md"));
  }
  const isbn = typeof data.isbn === "number" ? String(data.isbn) : data.isbn;
  if (typeof isbn === "string" && isbn.trim() !== "" && !isPlaceholder(isbn) && normalizeIsbn(isbn) === "") {
    const hint = typeof data.isbn === "number" ? "; quote it so leading zeros survive" : "";
    errors.push(err("invalid-isbn", `story.md isbn ${isbn} is not a valid ISBN-13 or ISBN-10 (check the digits and checksum${hint})`, "story.md"));
  }
  if (typeof data["publication-date"] === "string" && !isPlaceholder(data["publication-date"])) {
    const dateError = storyDateError(data["publication-date"]);
    if (dateError !== "") {
      errors.push(err("invalid-date", `story.md publication-date ${dateError}`, "story.md"));
    }
  }
  if (Array.isArray(data.subjects)) {
    for (const subject of data.subjects) {
      if (typeof subject === "string" && !isPlaceholder(subject) && !BISAC_PATTERN.test(subject.trim())) {
        errors.push(err("invalid-subject", `story.md subject ${subject} must be a BISAC code such as FIC022000`, "story.md"));
      }
    }
  }
  if (Array.isArray(data.keywords) && data.keywords.length > MAX_KEYWORDS) {
    warnings.push(warn("too-many-keywords", `story.md lists ${data.keywords.length} keywords; most retailers accept ${MAX_KEYWORDS}`, "story.md"));
  }
  for (const field of [...SCALAR_FIELDS, "authors", "editor", "keywords", "subjects"]) {
    const values = Array.isArray(data[field]) ? data[field] : [data[field]];
    if (values.some(isPlaceholder)) {
      warnings.push(warn("todo-placeholder", `story.md ${field} is still a [TODO] placeholder; builds leave it out`, "story.md"));
    }
  }
  if (data.author !== undefined && data.authors !== undefined) {
    warnings.push(warn("author-and-authors", "story.md sets both author and authors; builds use authors", "story.md"));
  }
}

// A name field (story.md `editor`, chapter `author`): one name as text,
// or a list of names, none of them blank.
export function validateNames(data, field, label, errors) {
  const value = data[field];
  if (value === undefined) {
    return;
  }
  const names = Array.isArray(value) ? value : [value];
  if (names.some((name) => typeof name !== "string" || name.trim() === "")) {
    errors.push(err("field-not-text", `${label} frontmatter field ${field} must be a name or a list of names, such as ${field}: Ada Writer`, label));
  }
}

// Returns the ISBN as bare digits (and a final X for ISBN-10), or "" when the
// value is not a valid ISBN.
export function normalizeIsbn(value) {
  const compact = String(value ?? "").replace(/[\s-]/g, "").toUpperCase();
  if (/^97[89]\d{10}$/.test(compact)) {
    const sum = [...compact.slice(0, 12)].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
    return (10 - (sum % 10)) % 10 === Number(compact[12]) ? compact : "";
  }
  if (/^\d{9}[\dX]$/.test(compact)) {
    const sum = [...compact].reduce((total, char, index) => total + (char === "X" ? 10 : Number(char)) * (10 - index), 0);
    return sum % 11 === 0 ? compact : "";
  }
  return "";
}

// A copyright page is found by its id or its title, once, and every build
// format reads the flag.
export function isCopyrightMatter(entry) {
  return entry.id === "copyright" || /copyright/i.test(entry.title);
}

// The story.md fields the generated copyright page prints, with the
// publishingMeta key that holds each. The ISBN prints as digits only.
const COPYRIGHT_PAGE_FIELDS = [["copyright", "copyright"], ["publisher", "publisher"], ["ai-disclosure", "aiDisclosure"]];

// Each of those fields with `[TODO` markers inside it, as { field, markers }.
// A value that is only a placeholder is left out of the page, but one that
// holds a marker after other text (`© 2026 [TODO: author to supply]`)
// prints as written.
export function copyrightPageTodos(meta) {
  return COPYRIGHT_PAGE_FIELDS
    .map(([field, key]) => ({ field, markers: countTodoMarkers(meta[key]) }))
    .filter((entry) => entry.markers > 0);
}

// The generated copyright page, used when story.md sets `copyright` and no
// matter page already covers it.
export function copyrightPage(meta) {
  const lines = [meta.copyright, "", fillLabel(meta.labels, "all-rights-reserved")];
  if (meta.publisher !== "") {
    lines.push("", fillLabel(meta.labels, "published-by", { publisher: meta.publisher }));
  }
  if (meta.isbn !== "") {
    lines.push("", `ISBN ${meta.isbn}`);
  }
  if (meta.aiDisclosure !== "") {
    lines.push("", meta.aiDisclosure);
  }
  return lines.join("\n");
}

export const DESCRIPTION_LIMIT = 4000;

// Retailer metadata sheet: every field a distributor form asks for, with a
// readiness checklist of what is still missing.
export function metadataSheet(input) {
  const { title, data, meta, words, characters, pages } = input;
  const seriesName = seriesDisplayName(data);
  const series = typeof seriesName === "string" ? `${seriesName}${isBookNumber(data["book-number"]) ? `, book ${data["book-number"]}` : ""}` : "";
  const rows = [
    ["Title", title],
    ["Series", series],
    ["Author(s)", meta.authors.join("; ")],
    // Only an anthology or edited collection has an editor to list.
    ...(meta.editors.length === 0 ? [] : [["Editor(s)", meta.editors.join("; ")]]),
    ["ISBN", meta.isbn],
    ["Publisher", meta.publisher],
    ["Publication date", meta.publicationDate],
    ["Language", meta.language],
    ["Genre", [data.genre, data["sub-genre"]].filter((value) => typeof value === "string" && value !== "").join(" / ")],
    ["Form", typeof data.form === "string" ? data.form : ""],
    characters === undefined ? ["Word count", String(words)] : ["Character count", String(characters)],
    ["Estimated print pages", Object.entries(pages).map(([trim, count]) => `${count} at ${trim}`).join(", ")],
    ["Description", meta.description === "" ? "" : `${meta.description.length} characters (limit ${DESCRIPTION_LIMIT})`],
    ["Keywords", meta.keywords.length === 0 ? "" : `${meta.keywords.length} of ${MAX_KEYWORDS}: ${meta.keywords.join("; ")}`],
    ["BISAC subjects", meta.subjects.join("; ")],
    ["Copyright", meta.copyright],
    ["Cover", typeof data.cover === "string" ? data.cover : ""],
    ["Cover alt text", meta.coverAlt],
    ["AI disclosure", meta.aiDisclosure]
  ];
  const checks = [
    ["Author named (`author` or `authors`, or an anthology's `editor`)", meta.authors.length > 0 || meta.editors.length > 0],
    ["ISBN for this edition (`isbn`), or a retailer-assigned identifier", meta.isbn !== ""],
    ["Publisher or imprint (`publisher`)", meta.publisher !== ""],
    ["Publication date (`publication-date`)", meta.publicationDate !== ""],
    [`Description under ${DESCRIPTION_LIMIT} characters (\`description\`)`, meta.description !== "" && meta.description.length <= DESCRIPTION_LIMIT],
    [`Keywords, up to ${MAX_KEYWORDS} (\`keywords\`)`, meta.keywords.length > 0 && meta.keywords.length <= MAX_KEYWORDS],
    ["BISAC subjects (`subjects`)", meta.subjects.length > 0],
    [`Copyright line (\`copyright\`) or copyright matter page${(input.pendingCopyright ?? []).length > 0 ? ` (pending permission: ${input.pendingCopyright.join(", ")})` : ""}`, meta.copyright !== "" || input.hasCopyrightPage],
    // The build checks the file; a path alone is not a cover.
    ["Cover image (`cover`)", Boolean(input.coverReady)],
    ["Cover alt text (`cover-alt`)", meta.coverAlt !== ""],
    ["AI-use statement decided (`ai-disclosure`)", meta.aiDisclosure !== ""],
    [`Permissions cleared for quoted matter (\`permission\`${(input.pendingPermissions ?? []).length > 0 ? `; pending: ${input.pendingPermissions.join(", ")}` : ""})`, (input.pendingPermissions ?? []).length === 0],
    [`No \`[TODO\` markers in chapter prose${(input.todoChapters ?? []).length > 0 ? ` (found in: ${input.todoChapters.join(", ")})` : ""}`, (input.todoChapters ?? []).length === 0],
    [`No \`[TODO\` markers on matter pages${(input.todoMatter ?? []).length > 0 ? ` (found in: ${input.todoMatter.join(", ")})` : ""}`, (input.todoMatter ?? []).length === 0],
    ["Story status is complete", data.status === "complete"]
  ];
  return [
    `# ${title}: Retailer Metadata`,
    "",
    "Generated from story.md. Retailer limits change; check each retailer's current requirements before upload.",
    "",
    "| Field | Value |",
    "| --- | --- |",
    ...rows.map(([field, value]) => `| ${field} | ${value === "" ? "(missing)" : tableCell(value)} |`),
    "",
    "## Description",
    "",
    meta.description === "" ? "(missing)" : meta.description,
    "",
    "## Readiness",
    "",
    ...checks.map(([label, ok]) => `- [${ok ? "x" : " "}] ${label}`),
    ""
  ].join("\n");
}

function tableCell(value) {
  return String(value).replace(/(\\*)\|/g, "$1$1\\|").replace(/\n/g, " ");
}
