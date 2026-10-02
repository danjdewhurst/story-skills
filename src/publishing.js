import { storyDateError } from "./continuity.js";
import { err, warn } from "./findings.js";
import { isLanguageTag } from "./languages/index.js";
import { isBookNumber, seriesDisplayName } from "./series.js";

// Publishing metadata kept in story.md: what retailers, distributors, and the
// EPUB package need. Every field is optional; validate checks the shape and
// the build formats read it.

export const MAX_KEYWORDS = 7;
const BISAC_PATTERN = /^[A-Z]{3}\d{6}$/;
const SCALAR_FIELDS = ["author", "language", "isbn", "publisher", "publication-date", "description", "copyright", "cover-alt", "ai-disclosure", "chapter-label", "contents-label"];

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

export function textDirection(language) {
  const [primary, ...subtags] = String(language ?? "").trim().toLowerCase().split("-");
  const script = subtags.find((subtag) => /^[a-z]{4}$/.test(subtag));
  if (script !== undefined) {
    return RTL_SCRIPTS.has(script) ? "rtl" : "ltr";
  }
  return RTL_LANGUAGES.has(primary) ? "rtl" : "ltr";
}

export function publishingMeta(data) {
  const text = (field) => (typeof data[field] === "string" && !isPlaceholder(data[field]) ? data[field].trim() : "");
  const list = (field) => (Array.isArray(data[field]) ? data[field].filter((item) => typeof item === "string" && item.trim() !== "" && !isPlaceholder(item)).map((item) => item.trim()) : []);
  const authors = list("authors");
  const author = text("author");
  return {
    authors: authors.length > 0 ? authors : author === "" ? [] : [author],
    language: text("language") || "en",
    // "vertical" sets a Japanese or Chinese book in columns; see typesetting.js.
    writingMode: text("writing-mode") || "horizontal",
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
    // Generated labels for a book not in English: "Kapitel" for the chapter
    // headings and "Inhalt" for the table of contents.
    chapterLabel: text("chapter-label") || "Chapter",
    contentsLabel: text("contents-label") || "Contents"
  };
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
  for (const field of [...SCALAR_FIELDS, "authors", "keywords", "subjects"]) {
    const values = Array.isArray(data[field]) ? data[field] : [data[field]];
    if (values.some(isPlaceholder)) {
      warnings.push(warn("todo-placeholder", `story.md ${field} is still a [TODO] placeholder; builds leave it out`, "story.md"));
    }
  }
  if (data.author !== undefined && data.authors !== undefined) {
    warnings.push(warn("author-and-authors", "story.md sets both author and authors; builds use authors", "story.md"));
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

// The generated copyright page, used when story.md sets `copyright` and no
// matter page already covers it.
export function copyrightPage(meta) {
  const lines = [meta.copyright, "", "All rights reserved."];
  if (meta.publisher !== "") {
    lines.push("", `Published by ${meta.publisher}`);
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
  const { title, data, meta, words, pages } = input;
  const seriesName = seriesDisplayName(data);
  const series = typeof seriesName === "string" ? `${seriesName}${isBookNumber(data["book-number"]) ? `, book ${data["book-number"]}` : ""}` : "";
  const rows = [
    ["Title", title],
    ["Series", series],
    ["Author(s)", meta.authors.join("; ")],
    ["ISBN", meta.isbn],
    ["Publisher", meta.publisher],
    ["Publication date", meta.publicationDate],
    ["Language", meta.language],
    ["Genre", [data.genre, data["sub-genre"]].filter((value) => typeof value === "string" && value !== "").join(" / ")],
    ["Form", typeof data.form === "string" ? data.form : ""],
    ["Word count", String(words)],
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
    ["Author named (`author` or `authors`)", meta.authors.length > 0],
    ["ISBN for this edition (`isbn`), or a retailer-assigned identifier", meta.isbn !== ""],
    ["Publisher or imprint (`publisher`)", meta.publisher !== ""],
    ["Publication date (`publication-date`)", meta.publicationDate !== ""],
    [`Description under ${DESCRIPTION_LIMIT} characters (\`description\`)`, meta.description !== "" && meta.description.length <= DESCRIPTION_LIMIT],
    [`Keywords, up to ${MAX_KEYWORDS} (\`keywords\`)`, meta.keywords.length > 0 && meta.keywords.length <= MAX_KEYWORDS],
    ["BISAC subjects (`subjects`)", meta.subjects.length > 0],
    ["Copyright line (`copyright`) or copyright matter page", meta.copyright !== "" || input.hasCopyrightPage],
    // The build checks the file; a path alone is not a cover.
    ["Cover image (`cover`)", Boolean(input.coverReady)],
    ["Cover alt text (`cover-alt`)", meta.coverAlt !== ""],
    ["AI-use statement decided (`ai-disclosure`)", meta.aiDisclosure !== ""],
    [`Permissions cleared for quoted matter (\`permission\`${(input.pendingPermissions ?? []).length > 0 ? `; pending: ${input.pendingPermissions.join(", ")}` : ""})`, (input.pendingPermissions ?? []).length === 0],
    [`No \`[TODO\` markers in chapter prose${(input.todoChapters ?? []).length > 0 ? ` (found in: ${input.todoChapters.join(", ")})` : ""}`, (input.todoChapters ?? []).length === 0],
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
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}
