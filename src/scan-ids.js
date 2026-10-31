// Ids, names, and numbers: the story id, entity ids and the names they come
// from, folder and file names every platform can check out, and the integers
// commands accept.
import crypto from "node:crypto";
import path from "node:path";
import { kebabCase } from "./markdown.js";
import { isBookNumber } from "./series.js";
import { warn } from "./findings.js";
import { projectError, usageError } from "./exit-codes.js";

// The story id is the kebab-case title, or the project folder name when the
// title is missing or has no ASCII letters or digits. Neither is
// transliterated: the id is recomputed on every run, so a Cyrillic or Greek
// title or folder name must give the id it always has. When neither has
// ASCII letters or digits, the id is a substitute (see substituteStoryId)
// rather than "", which named every build dist/.epub.
export function deriveStoryId(title, root) {
  return asciiStoryId(title, root) || substituteStoryId(title, root).id;
}

// The id the title or folder name gives as written, or "" when neither has
// ASCII letters or digits. story init and import refuse to make a project
// without one.
export function asciiStoryId(title, root) {
  return kebabCase(String(title ?? ""), { transliterate: false }) || kebabCase(path.basename(root), { transliterate: false });
}

// The id of a project whose title and folder name have no ASCII letters or
// digits (a cloned project's folder renamed to its Japanese title, say):
// `story-` and eight hex digits of a hash of the title, or of the folder
// name when there is no title, so each book has its own id. It is never
// transliterated, as a Cyrillic title could be: a later release that adds
// letters to the tables would then change the id, and with it the build
// file names, the EPUB identifier, and the IFID. The text is hashed in NFC,
// which Unicode keeps stable, so a title saved decomposed (as macOS stores
// folder names) gives the same id everywhere. `from` names the source, for
// the warning.
function substituteStoryId(title, root) {
  const text = String(title ?? "").trim();
  const hash = crypto.createHash("sha256").update((text || path.basename(root)).normalize("NFC")).digest("hex").slice(0, 8);
  return { id: `story-${hash}`, from: text === "" ? "the folder name" : "the title" };
}

// The warning validate and build give while the story id is a substitute:
// it names every build file, and the writer may want to choose it.
export function substituteStoryIdWarnings(project) {
  const title = project.story.data.title;
  if (project.story.unreadable || asciiStoryId(title, project.root) !== "") {
    return [];
  }
  const { id, from } = substituteStoryId(title, project.root);
  return [warn("substitute-story-id", `story.md title and the project folder name have no ASCII letters or digits, so the story id is ${id}, hashed from ${from}; rename the folder with ASCII letters or digits to choose the id, then run story reindex`, "story.md")];
}

// Characters no path story.md names may hold: the C0 controls, which Windows
// refuses in names (and a NUL makes every file-system call throw), DEL and
// the C1 controls, and the bidirectional marks and controls, which can make
// a path read as another.
export const PATH_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

// The error for a path in story.md (`label` names the field) that holds one
// of PATH_CONTROL_CHARACTERS, shown escaped so the message is readable.
export function controlCharacterError(label, value) {
  const shown = JSON.stringify(value).replace(/[\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return projectError(`story.md ${label} ${shown} must not contain control characters`);
}

export function canonicalChapterId(number) {
  return `chapter-${String(number).padStart(2, "0")}`;
}

// A name or title is one line: a line break would split the heading it
// starts the file with (or add lines after it) and its registry row. U+2028
// and U+2029 count, as JavaScript and many editors read them as line breaks.
export function requireSingleLineName(name, kind, noun = "name") {
  if (/[\r\n\u2028\u2029]/.test(name)) {
    throw usageError(`A ${kind} ${noun} must be a single line`);
  }
}

// Windows reserves these file names with any extension, so `con.md` cannot
// be checked out there.
export const WINDOWS_RESERVED_ID = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

// A folder name every platform can check out: Windows also refuses reserved
// device names with an extension (con.txt), a trailing dot or space, and the
// characters < > : " | ? * and control characters.
export function assertPortableFolderName(name) {
  if (WINDOWS_RESERVED_ID.test(name.split(".")[0].trim().toLowerCase())) {
    throw usageError(`Cannot use folder ${name}: Windows reserves that name. Choose another --dir`);
  }
  if (/[. ]$/.test(name)) {
    throw usageError(`Cannot use folder "${name}": Windows does not allow a folder name ending in a dot or space. Choose another --dir`);
  }
  if (/[<>:"|?*\x00-\x1f]/.test(name)) {
    throw usageError(`Cannot use folder "${name}": Windows does not allow < > : " | ? * or control characters in folder names. Choose another --dir`);
  }
}

export function assertPortableId(id, kind) {
  if (WINDOWS_RESERVED_ID.test(id)) {
    const file = kind === "story" ? id : `${id}.md`;
    throw usageError(`Cannot use ${kind} id ${id}: Windows reserves the file name ${file}. Choose a longer name, such as "${id} ${kind}"`);
  }
}

export function requireKebabId(id, label) {
  if (!isKebabId(id)) {
    throw usageError(`${label} must be a kebab-case id, got "${id}"`);
  }
}

// `--id` for add and rename. Ids stay ASCII kebab-case, so a name written in a
// script with no ASCII letters or digits (Cyrillic, CJK, Greek, Arabic,
// Hebrew, Devanagari) needs one given by hand; the name itself is kept as
// written. Returns undefined when the id should come from the name instead.
export function requestedEntityId(kind, value) {
  const id = String(value ?? "").trim();
  if (id === "") {
    return undefined;
  }
  // Chapter and scene ids encode their numbers, so an id given by hand would
  // contradict the file's own frontmatter.
  if (kind === "chapter" || kind === "scene") {
    throw usageError(`--id does not apply to a ${kind}: a ${kind} id comes from its number. Use --number for a chapter, or --chapter and --scene for a scene`);
  }
  requireKebabId(id, `${kind} id`);
  return id;
}

export function undeducibleIdMessage(kind, name) {
  return `Cannot derive a kebab-case id from ${kind} name "${name}": pass --id with a kebab-case id, or use a name containing ASCII letters or digits`;
}

// A plain decimal integer (`12`, not `0x10`, `1e3`, or `2.0`) within the
// safe-integer range, or null. Number() alone accepts all of those forms and
// silently rounds past 2^53, which creates files validate then rejects.
export function parseDecimalInteger(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : null;
  }
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(text)) {
    return null;
  }
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : null;
}

// 0 (a prequel) and decimals (a 1.5 novella) are valid publication numbers.
export function requireBookNumber(value) {
  const text = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  const number = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
  if (!isBookNumber(number)) {
    throw usageError(`Book number must be 0 or a positive number, such as 2, 0 for a prequel, or 1.5 for a novella; got ${value}`);
  }
  return number;
}

export function requirePositiveInteger(value, label) {
  const number = parseDecimalInteger(value);
  if (number === null || number <= 0) {
    throw usageError(`${label} must be a positive integer, got ${value}`);
  }
  return number;
}

export function isKebabId(value) {
  const text = String(value ?? "").trim();
  return text !== "" && text === kebabCase(text);
}

// Build artifacts are named after the story id; keep the name well inside
// file-system limits (255 bytes) for very long titles.
export function fileStem(storyId) {
  if (storyId.length <= 100) {
    return storyId;
  }
  const cut = storyId.slice(0, 100);
  return cut.slice(0, cut.lastIndexOf("-") > 0 ? cut.lastIndexOf("-") : 100);
}
