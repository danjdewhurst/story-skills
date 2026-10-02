import { wordSpans } from "./words.js";

// Latin letters that NFKD does not decompose into a base letter plus marks,
// spelled the way they are usually transliterated into ASCII.
const LATIN_FOLDS = {
  "\u00c6": "AE", "\u00e6": "ae", "\u00d8": "O", "\u00f8": "o", "\u0141": "L", "\u0142": "l",
  "\u00df": "ss", "\u1e9e": "SS", "\u0110": "D", "\u0111": "d", "\u00d0": "D", "\u00f0": "d",
  "\u00de": "Th", "\u00fe": "th", "\u0152": "OE", "\u0153": "oe", "\u0126": "H", "\u0127": "h",
  "\u0166": "T", "\u0167": "t", "\u014a": "Ng", "\u014b": "ng", "\u0131": "i", "\u0138": "k"
};
const LATIN_FOLD_PATTERN = new RegExp(`[${Object.keys(LATIN_FOLDS).join("")}]`, "g");

// Folds accented and special Latin letters to plain ASCII letters: "Søren"
// becomes "Soren", "Straße" becomes "Strasse". Other scripts pass through.
export function foldLatin(value) {
  return String(value)
    .replace(LATIN_FOLD_PATTERN, (letter) => LATIN_FOLDS[letter])
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Lowercase Cyrillic letters as ASCII, one table for every language written
// in Cyrillic. Shared letters follow a simplified BGN/PCGN Russian
// romanisation (ж zh, х kh, ц ts, щ shch, ы y, the hard and soft signs
// dropped), so a language-specific spelling, such as Ukrainian и as "y" or
// Bulgarian щ as "sht" and ъ as "a", needs --id. The letters other languages
// add take their usual forms: Ukrainian є ye, і i, ї yi, ґ g; Belarusian ў u;
// Serbian and Macedonian ђ dj, ј j, љ lj, њ nj, ћ c, џ dz, ѓ gj, ќ kj, ѕ dz;
// Bulgarian and Macedonian ѐ e, ѝ i.
const CYRILLIC = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  є: "ye", і: "i", ї: "yi", ґ: "g", ў: "u",
  ђ: "dj", ј: "j", љ: "lj", њ: "nj", ћ: "c", џ: "dz", ѓ: "gj", ќ: "kj", ѕ: "dz", ѐ: "e", ѝ: "i"
};

// Lowercase Greek letters as ASCII, after ELOT 743 (the Greek standard the UN
// adopted) simplified to fixed values: αυ, ευ, and ηυ are always "av", "ev",
// and "iv" (ELOT writes "af", "ef", and "if" before a voiceless consonant),
// μπ, ντ, and γκ are always "mp", "nt", and "gk" (ELOT writes "b", "d", and
// "g" at the start of a word), and accents and breathings are dropped. A
// diaeresis keeps two vowels apart, so αϋ is "ay" rather than "av".
const GREEK_DIGRAPHS = { αυ: "av", ευ: "ev", ηυ: "iv", ου: "ou", γγ: "ng", γξ: "nx", γχ: "nch" };
const GREEK = {
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k", λ: "l",
  μ: "m", ν: "n", ξ: "x", ο: "o", π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f",
  χ: "ch", ψ: "ps", ω: "o", ϊ: "i", ϋ: "y"
};
const TRANSLITERATIONS = { ...GREEK_DIGRAPHS, ...CYRILLIC, ...GREEK };
const TRANSLITERATION_PATTERN = new RegExp(
  `${Object.keys(GREEK_DIGRAPHS).join("|")}|[${Object.keys(CYRILLIC).join("")}${Object.keys(GREEK).join("")}]`,
  "g"
);
const UNTRANSLITERATED_LETTER = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;

// Spells Cyrillic and Greek letters in lowercase ASCII: "Пётр" becomes "petr",
// "Ολυμπία" becomes "olympia". Other text is only lowercased, but the modifier
// apostrophe Ukrainian writes (Мʼята) is dropped like any other apostrophe.
// Greek accents and breathings go first, keeping a diaeresis, and the text is
// recomposed so й, ё, ї, ѓ, and ќ match the table whether they arrive composed
// or not. Returns null when a Cyrillic or Greek letter has no entry (Kazakh қ,
// pre-reform ѣ), so a name is never spelled with letters missing.
function transliterate(value) {
  const spelled = String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/([\u0370-\u03ff])([\u0300-\u036f]+)/g, (_, letter, marks) => letter + (marks.includes("\u0308") ? "\u0308" : ""))
    .normalize("NFC")
    .replace(/\u02bc/g, "")
    .replace(TRANSLITERATION_PATTERN, (letters) => TRANSLITERATIONS[letters]);
  return UNTRANSLITERATED_LETTER.test(spelled) ? null : spelled;
}

// The ASCII kebab-case id for a name or title. Latin letters are folded and
// Cyrillic and Greek transliterated; other scripts (CJK, Arabic, Hebrew, and
// the rest) leave nothing, so a name written only in them needs --id. A name
// with a Cyrillic or Greek letter the tables lack is not transliterated at
// all, and slugs as it did before transliteration.
// `transliterate: false` leaves Cyrillic and Greek out as well, for ids that
// are recomputed on every run (the story id, review-copy labels) and so must
// not change for projects made before transliteration.
export function kebabCase(value, { transliterate: scripts = true } = {}) {
  return foldLatin((scripts ? transliterate(value) : null) ?? value)
    .replace(/['‘’]/g, "")
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

// "Chapter 3: Arrival", or plain "Chapter 3" when the title is blank or only
// repeats the number, so an untitled chapter never reads "Chapter 3: Chapter 3".
// `word` is story.md's `chapter-label` ("Kapitel"); a `{n}` in it places the
// number ("第{n}章"), otherwise the number follows it.
export function chapterHeading(number, title, word = "Chapter") {
  const text = String(title ?? "").trim();
  const name = String(word ?? "").trim() || "Chapter";
  const label = name.includes("{n}") ? name.replace(/\{n\}/g, String(number)) : `${name} ${number}`;
  return text === "" || text.toLowerCase() === label.toLowerCase() ? label : `${label}: ${text}`;
}

// Characters that continue a word: letters, combining marks (vowel signs,
// viramas, harakat, niqqud, decomposed accents), digits, and the invisible
// joiners ZWNJ, ZWJ, and the soft hyphen. A word starts with a letter or digit.
const WORD_CHARS = "\\p{L}\\p{M}\\p{N}\\u200C\\u200D\\u00AD";
const URL_PLACEHOLDER = "\uE000";
// Apostrophes and hyphens (ASCII, U+2010, U+2011) join word parts, and so do
// `.` `,` `:` between digits, so `$1,000`, `3.14`, and `9:30` are one word.
const WORD_PATTERN = new RegExp(
  `${URL_PLACEHOLDER}|[\\p{L}\\p{N}][${WORD_CHARS}]*(?:(?:['\u2019\u2010\u2011-]|(?<=\\p{N})[.,:](?=\\p{N}))[\\p{L}\\p{N}][${WORD_CHARS}]*)*`,
  "gu"
);
// A bare URL or email address counts as one word. The lookbehinds start a
// match only at the start of a token, so scanning stays linear.
const URL_OR_EMAIL = /(?<![a-z0-9+.-])(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>()[\]`]*[^\s<>()[\]`.,;:!?'"\u2019\u201d*_~]|(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}][\p{L}\p{N}._%+-]*@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/giu;

// A link as its visible text, and no image, which is how every build prints
// them and how words are counted. Bounded, so a long run of unclosed `[` or
// `(` stays linear.
export function plainLinks(text) {
  return String(text)
    .replace(/!\[[^\]]{0,1000}\]\([^)]{0,1000}\)/g, "")
    .replace(/\[([^\]]{0,1000})\]\([^)]{0,1000}\)/g, "$1");
}

// Heading markers removed, so an in-prose heading reads as a paragraph. A
// heading with no text is dropped, except a lone `#` (even with trailing
// spaces), which stays a scene break. Closing hashes go with the markers.
export function flattenHeadings(text) {
  return String(text).replace(/^(#+)(?:[ \t]+([^\n]*))?$/gm, (line, hashes, content) => {
    const heading = String(content ?? "").replace(/(?:^|[ \t]+)#+[ \t]*$/, "").trim();
    if (heading !== "") {
      return heading;
    }
    return hashes === "#" ? "#" : "";
  });
}

export function splitWords(markdown) {
  const urls = [];
  // Code is printed by every build, so its words count; only the fence
  // lines themselves are left out.
  const normalized = plainLinks(withoutFenceMarkers(String(markdown).replace(/\uE000/g, " ")))
    .replace(URL_OR_EMAIL, (match) => {
      urls.push(match);
      return ` ${URL_PLACEHOLDER} `;
    })
    // A backslash escape (`didn\'t`) is the character it escapes.
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .replace(/[#>*_~|`]/g, " ")
    .replace(/(?<!\p{N}):|:(?!\p{N})/gu, " ");

  // Letters and digits in any script; apostrophes (straight or curly) and
  // hyphens join a word rather than split it, so "don\u2019t" and "well-known"
  // each count once. "U.S.A" is three words because the periods split it.
  // Chinese and Japanese count a word per character, and Thai, Lao, Khmer,
  // and Burmese are split by dictionary (see wordSpans).
  let next = 0;
  return wordSpans(normalized, WORD_PATTERN).map(({ word }) => (word === URL_PLACEHOLDER ? urls[next++] : word));
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

// How many `[TODO` markers (`[TODO: check bible]`) prose holds. Pass prose
// with comments removed: a marker inside a comment never reaches a build.
export function countTodoMarkers(prose) {
  return (String(prose).match(/\[TODO\b/gi) ?? []).length;
}


// Removes HTML comments. `replacement` stands in for each comment: builds
// drop comments outright, as CommonMark does, while prose analysis keeps
// words on either side apart.
export function scanComments(text, replacement = "") {
  const source = String(text);
  const { ranges, unclosed } = scanMarkup(source);
  let result = "";
  let position = 0;
  for (const range of ranges) {
    if (range.kind === "comment") {
      result += source.slice(position, range.start) + replacement;
      position = range.end;
    }
  }
  return { text: result + source.slice(position), unclosed };
}

// The text with every HTML comment and closed code fence blanked to spaces,
// keeping line breaks, so headings and dividers can be found by offset
// without matching one written inside a comment or a fence.
export function maskMarkup(text) {
  const source = String(text);
  let result = "";
  let position = 0;
  for (const range of scanMarkup(source).ranges) {
    result += source.slice(position, range.start) + source.slice(range.start, range.end).replace(/[^\r\n]/g, " ");
    position = range.end;
  }
  return result + source.slice(position);
}

// One left-to-right pass over comments, closed backtick fences, and code
// spans: whichever opens first owns the text until it closes. A `<!--`
// inside a fence or code span is literal, and a fence inside a comment is
// part of the comment, which runs to the first `-->` as a CommonMark HTML
// block does. A comment or fence that never closes hides nothing. A search
// that fails is not repeated, so any number of unclosed openers stays linear.
function scanMarkup(text) {
  const ranges = [];
  let unclosed = false;
  // A fence opener this long or longer has no closing line left.
  let fenceLimit = Infinity;
  let nextOpen = -2;
  let position = 0;
  while (position < text.length) {
    const newline = text.indexOf("\n", position);
    const lineEnd = newline === -1 ? text.length : newline;
    if (position === 0 || text[position - 1] === "\n") {
      const marker = /^ {0,3}(`{3,})/.exec(text.slice(position, lineEnd));
      if (marker && marker[1].length < fenceLimit) {
        const end = fenceEnd(text, lineEnd, marker[1].length);
        if (end === -1) {
          fenceLimit = marker[1].length;
        } else {
          ranges.push({ kind: "fence", start: position, end });
          position = end;
          continue;
        }
      }
    }
    if (nextOpen !== -1 && nextOpen < position) {
      nextOpen = text.indexOf("<!--", position);
    }
    const open = nextOpen !== -1 && nextOpen < lineEnd ? nextOpen : -1;
    const tick = text.indexOf("`", position);
    if (tick !== -1 && tick < lineEnd && (open === -1 || tick < open)) {
      position = codeSpanEnd(text, tick, lineEnd);
      continue;
    }
    if (open === -1) {
      position = lineEnd + 1;
      continue;
    }
    const close = text.indexOf("-->", open + 4);
    if (close === -1) {
      // No `-->` anywhere after, so no later `<!--` closes either.
      unclosed = true;
      nextOpen = -1;
      position = open + 4;
      continue;
    }
    ranges.push({ kind: "comment", start: open, end: close + 3 });
    position = close + 3;
  }
  return { ranges, unclosed };
}

// The end of the fence whose opener line ends at `openerEnd`, just past its
// closing line, or -1 when no line closes it.
function fenceEnd(text, openerEnd, length) {
  for (let lineStart = openerEnd + 1; lineStart < text.length;) {
    const next = text.indexOf("\n", lineStart);
    const lineEnd = next === -1 ? text.length : next;
    const line = text.slice(lineStart, lineEnd);
    const marker = /^ {0,3}(`{3,})/.exec(line);
    if (marker && marker[1].length >= length && line.trim() === marker[1]) {
      return Math.min(lineEnd + 1, text.length);
    }
    lineStart = lineEnd + 1;
  }
  return -1;
}

// Past a code span opened by the backtick run at `tick`, closed by a run of
// the same length on the same line; an unmatched run is plain text.
function codeSpanEnd(text, tick, lineEnd) {
  let runEnd = tick;
  while (text[runEnd] === "`") {
    runEnd += 1;
  }
  const length = runEnd - tick;
  let search = runEnd;
  while (search < lineEnd) {
    const start = text.indexOf("`", search);
    if (start === -1 || start >= lineEnd) {
      break;
    }
    let end = start;
    while (text[end] === "`") {
      end += 1;
    }
    if (end - start === length) {
      return end;
    }
    search = end;
  }
  return runEnd;
}

// Line indexes inside closed backtick code fences, fence lines included.
// Only a backtick fence that closes counts: builds print fences as text,
// and manuscripts use `~~~` as a scene separator, so an unclosed fence or a
// tilde line never hides the text after it from counts and checks.
export function fencedLineIndexes(lines) {
  const fenced = new Set();
  for (const [start, end] of closedFences(lines)) {
    for (let inside = start; inside <= end; inside += 1) {
      fenced.add(inside);
    }
  }
  return fenced;
}

// [opening line, closing line] index pairs of the closed backtick fences.
function closedFences(lines) {
  const fences = [];
  let open = null;
  for (const [index, line] of lines.entries()) {
    const marker = /^ {0,3}(`{3,})/.exec(line);
    if (!marker) {
      continue;
    }
    if (open === null) {
      open = { index, fence: marker[1] };
    } else if (marker[1].length >= open.fence.length && line.trim() === marker[1]) {
      fences.push([open.index, index]);
      open = null;
    }
  }
  return fences;
}

// The text without the opening and closing lines of closed code fences;
// the code between them stays, as every build prints it.
export function withoutFenceMarkers(text) {
  const lines = String(text).split(/(?<=\n)/);
  const markers = new Set(closedFences(lines.map((line) => line.replace(/\r?\n$/, ""))).flat());
  return lines.map((line, index) => (markers.has(index) ? "\n" : line)).join("");
}

// The text with each closed fenced code block replaced by a space, for
// checks that read only prose (dialogue, paragraph matching).
export function withoutFencedCode(text) {
  return splitFences(text).map((part) => (part.fenced ? " " : part.text)).join("");
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

// A `## Heading` line as CommonMark reads it: up to three spaces of indent,
// any run of spaces after the hashes, and optional closing hashes.
function sectionHeadingPattern(heading) {
  return new RegExp(`^ {0,3}##[ \\t]+${escapeRegExp(heading)}(?:[ \\t]+#+)?[ \\t]*\\r?$`, "im");
}

const NEXT_SECTION = /^ {0,3}##(?:[ \t]|\r?$)/m;

// Headings, the outline divider, and the leading heading are found on the
// masked text, so none written inside a comment or code fence counts; the
// prose is then sliced from the original at the same offset.
function proseSection(markdownBody) {
  const masked = maskMarkup(markdownBody);
  const chapterTextMatch = sectionHeadingPattern("Chapter Text").exec(masked);
  if (chapterTextMatch) {
    return markdownBody.slice(chapterTextMatch.index + chapterTextMatch[0].length);
  }

  const outlineMatch = sectionHeadingPattern("Outline").exec(masked);
  if (!outlineMatch) {
    return markdownBody.slice(leadingHeadingLength(masked));
  }

  const start = outlineMatch.index + outlineMatch[0].length;
  return markdownBody.slice(outlineDivider(masked, start) ?? start);
}

// The offset just past the `---` that closes the outline, or null. Only a
// `---` directly after the outline counts: the outline runs over list items,
// their indented or lazy continuation lines, headings, and blank
// lines, so a `---` scene break after the first paragraph of prose is never
// taken for the divider.
function outlineDivider(masked, start) {
  const lines = masked.slice(start).split("\n");
  let offset = start + lines[0].length + 1;
  let previous = "blank";
  for (const line of lines.slice(1)) {
    const lineStart = offset;
    offset += line.length + 1;
    const text = line.replace(/\r$/, "");
    if (text.trim() === "") {
      previous = "blank";
    } else if (text.trim() === "---") {
      return lineStart + line.length;
    } else if (/^\s*(?:[-*+]|\d+[.)])(?:[ \t]|$)/.test(text) || /^ {0,3}#{2,}(?:[ \t]|$)/.test(text) || /^[ \t]+\S/.test(text)) {
      previous = "outline";
    } else if (previous !== "outline") {
      return null;
    }
  }
  return null;
}

export function extractSection(markdown, heading) {
  const masked = maskMarkup(markdown);
  const match = sectionHeadingPattern(heading).exec(masked);
  if (!match) {
    return "";
  }

  const start = match.index + match[0].length;
  const next = NEXT_SECTION.exec(masked.slice(start));
  const rest = markdown.slice(start);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The length of a leading `# Heading` line, or of a leading setext heading
// (one line underlined with `===`), with any blank lines before it; 0 if none.
function leadingHeadingLength(masked) {
  const match = /^(?:[ \t]*\r?\n)*(?:[ \t]{0,3}#(?!#)[ \t]+[^\r\n]*|[ \t]{0,3}\S[^\r\n]*\r?\n[ \t]{0,3}=+[ \t]*)(?:\r?\n|$)/.exec(masked);
  return match ? match[0].length : 0;
}
