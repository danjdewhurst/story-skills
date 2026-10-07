import { characterReference } from "./entities.js";
import { fillLabel } from "./languages/index.js";
import { formatNumeral } from "./numerals.js";
import { WORD_PATTERN, wordSpans } from "./words.js";

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
// `labels` are the book's (see buildLabels): `chapter` places the number
// ("Kapitel {n}", "第{n}章") and `chapter-heading` joins it to the title
// ("{chapter}: {title}"). The number is in `numerals`, a system from
// story.md `chapter-numerals` (第十二章, الفصل ١٢; see ./numerals.js), else
// 0-9. A title that repeats the number in either form counts as blank.
export function chapterHeading(number, title, labels = undefined, numerals = "latn") {
  const text = String(title ?? "").trim();
  const chapter = (n) => fillLabel(labels, "chapter", { n }).trim() || fillLabel(undefined, "chapter", { n });
  const label = chapter(formatNumeral(number, numerals));
  // NFKC reads full-width digits as 0-9, so 第１２章 repeats 第12章.
  const fold = (value) => value.normalize("NFKC").toLowerCase();
  const repeats = [label, chapter(String(number))].some((form) => fold(text) === fold(form));
  return text === "" || repeats ? label : fillLabel(labels, "chapter-heading", { chapter: label, title: text });
}

const URL_PLACEHOLDER = "\uE000";
// A word as WORD_PATTERN reads one, or a URL or email address set aside.
const COUNTED_WORD = new RegExp(`${URL_PLACEHOLDER}|${WORD_PATTERN.source}`, "gu");
// Underscores markdown reads as emphasis: every run but one between two
// letters or digits (`snake_case`), which is text and joins the word.
const EMPHASIS_UNDERSCORES = /(?<![\p{L}\p{M}\p{N}_])_+|(?<!_)_+(?![\p{L}\p{N}_])/gu;
// A bare URL or email address counts as one word. The lookbehinds start a
// match only at the start of a token, so scanning stays linear.
const URL_OR_EMAIL = /(?<![a-z0-9+.-])(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>()[\]`]*[^\s<>()[\]`.,;:!?'"\u2019\u201d*_~]|(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}][\p{L}\p{N}._%+-]*@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/giu;

// A link as its visible text, and no image, which is how every build prints
// them and how words are counted. Links and images are CommonMark inline
// ones: the text may hold brackets in pairs, the destination parentheses in
// pairs (`[Foo](https://en.wikipedia.org/wiki/Foo_(bar))`), and a title may
// follow it (`[Foo](https://x.com "Title (x)")`). Text that is not one, such
// as `[Aside](not a link)`, stays as written, and so do code spans, closed
// backtick fences, autolinks, and backslash-escaped brackets.
export function plainLinks(text) {
  return splitFences(String(text)).map((part) => (part.fenced ? part.text : withoutLinks(part.text))).join("");
}

// ASCII punctuation, which a backslash escapes.
const ESCAPABLE = /[!-/:-@[-`{-~]/;
// An autolink: a scheme of 2 to 32 characters, `:`, and no space, control
// character, `<`, or `>`; or an email address, as CommonMark reads them,
// with the labels of its domain (group 1) checked apart (see autolinkEnd).
// U+E000 and U+E001, the markers word counts and builds use, end one too.
// No try reads past the next `<`, so the tries at each `<` stay linear.
const AUTOLINK = /<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\0- <>\x7f\ue000\ue001]*|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@([A-Za-z0-9.-]+))>/y;
const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
// How deep parentheses nest in a link destination, as in cmark, markdown-it,
// and Pandoc: a deeper one is not a link.
const MAX_DESTINATION_PARENS = 32;

// The end of the autolink that starts at `index` (just past its `>`), or -1.
// An email domain's labels are checked one by one: a pattern that repeats
// a label backtracks quadratically on a long run of `b.b.b.`.
export function autolinkEnd(text, index) {
  AUTOLINK.lastIndex = index;
  const match = AUTOLINK.exec(text);
  if (match === null || (match[1] !== undefined && !match[1].split(".").every((label) => DOMAIN_LABEL.test(label)))) {
    return -1;
  }
  return index + match[0].length;
}

// The source with each link replaced by its text and each image dropped, in
// one pass as CommonMark's "look for link or image" reads them: a `]` closes
// the nearest open `[` or `![`, and makes a link when an inline destination
// follows it; a link's text cannot hold another link, so the `[` before it
// can no longer open one. Each paragraph is read apart (see inlineBlocks).
// Code spans and autolinks are skipped whole, and a backslash-escaped
// character is text. A destination steps over each parenthesised group in
// it at once (see parenGroups), so one that fails is never read again by
// the `](` of a link nested in it, and a title is read only up to the next
// quote or parenthesis of its kind: a long run of unclosed `[`, `![`, `](`,
// or backticks stays linear.
function withoutLinks(source) {
  let result = "";
  let position = 0;
  for (const [start, end] of linkCuts(source)) {
    result += source.slice(position, start);
    position = end;
  }
  return result + source.slice(position);
}

// The [start, end] of the markup that withoutLinks drops, in order and
// apart: a link's `[` and its `](...)`, or a whole image.
function linkCuts(source) {
  const cuts = [];
  for (const [start, end] of inlineBlocks(source)) {
    const openers = [];
    // A `[` below this index in `openers` holds a link that has closed, so
    // it opens nothing (a link's text cannot hold a link); a `![` still
    // opens an image.
    let inactive = 0;
    const closeSpan = codeSpanCloser(source, end);
    let groups = null;
    for (let index = start; index < end;) {
      const character = source[index];
      const autolink = character === "<" ? autolinkEnd(source, index) : -1;
      if (character === "\\" && ESCAPABLE.test(source[index + 1] ?? "")) {
        index += 2;
      } else if (character === "`") {
        let run = index;
        while (source[run] === "`") {
          run += 1;
        }
        const close = closeSpan(index, run - index);
        index = close === -1 ? run : close;
      } else if (autolink !== -1) {
        index = autolink;
      } else if (character === "[" || (character === "!" && source[index + 1] === "[")) {
        inactive = Math.min(inactive, openers.length);
        openers.push({ start: index, image: character === "!" });
        index += character === "!" ? 2 : 1;
      } else if (character === "]" && openers.length > 0) {
        const opener = openers.pop();
        let linkEnd = -1;
        if ((opener.image || openers.length >= inactive) && source[index + 1] === "(") {
          groups ??= parenGroups(source, start, end);
          linkEnd = inlineLinkEnd(source, index + 1, end, groups);
        }
        if (linkEnd === -1) {
          index += 1;
          continue;
        }
        if (opener.image) {
          cuts.push([opener.start, linkEnd]);
        } else {
          cuts.push([opener.start, opener.start + 1], [index, linkEnd]);
          inactive = openers.length;
        }
        index = linkEnd;
      } else {
        index += 1;
      }
    }
  }
  // Links close in text order, but an image closes after the links in its
  // text, so the cuts are put in order and joined where they overlap.
  cuts.sort((left, right) => left[0] - right[0]);
  const removed = [];
  let position = 0;
  for (const [start, end] of cuts) {
    if (end > position) {
      removed.push([Math.max(start, position), end]);
      position = end;
    }
  }
  return removed;
}

// The [start, end] of each run of lines in `source` (which holds no closed
// fence) that CommonMark reads as one block of inline text, so a link or
// code span never pairs across two: the builds' paragraphs (see
// markdownParagraphs), which a blank line ends, a scene-break line ends
// and stands apart from (see breaksParagraph), and a block quote ends when
// it opens below lines that are not quoted; and an ATX heading line, which
// is a block of its own, though builds run its text into the paragraph
// around it. A blank line may hold block quote markers. Each line is read
// once.
function inlineBlocks(source) {
  const blocks = [];
  let open = null;
  for (let lineStart = 0; lineStart <= source.length;) {
    const newline = source.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? source.length : newline;
    const line = source.slice(lineStart, lineEnd).replace(/\r$/, "");
    const marker = /^(?:[ \t]*>[ \t]?)+/.exec(line);
    const content = marker ? line.slice(marker[0].length) : line;
    const blank = content.trim() === "";
    const alone = !blank && (breaksParagraph(content) || ATX_HEADING.test(content));
    if (blank || alone || (marker && open !== null && !open.quote)) {
      open = null;
    }
    if (!blank) {
      if (open === null) {
        open = { quote: Boolean(marker), block: [lineStart, lineEnd] };
        blocks.push(open.block);
      }
      open.block[1] = lineEnd;
      if (alone) {
        open = null;
      }
    }
    lineStart = lineEnd + 1;
  }
  return blocks;
}

// Where each parenthesised group of a paragraph ends, for the link
// destinations in it: a map from the index of each `(` to the index just
// past the `)` that closes it, or to -1 when no destination can hold the
// group, because it holds a space or control character or nests deeper
// than MAX_DESTINATION_PARENS. A `(` that nothing closes is left out. One
// pass, with a stack of the groups still open; a backslash escapes the
// character after it, as in a destination.
function parenGroups(source, start, end) {
  const groups = new Map();
  const open = [];
  // The deepest nesting closed so far inside each open group.
  const inner = [];
  let lastSpace = -1;
  for (let index = start; index < end; index += 1) {
    const character = source[index];
    if (character === "\\" && ESCAPABLE.test(source[index + 1] ?? "")) {
      index += 1;
    } else if (character === "(") {
      open.push(index);
      inner.push(0);
    } else if (character === ")" && open.length > 0) {
      const group = open.pop();
      const depth = inner.pop() + 1;
      groups.set(group, depth <= MAX_DESTINATION_PARENS && lastSpace < group ? index + 1 : -1);
      if (inner.length > 0) {
        inner[inner.length - 1] = Math.max(inner[inner.length - 1], depth);
      }
    } else if (character <= " " || character === "\x7f") {
      lastSpace = index;
    }
  }
  return groups;
}

// The end, just past its `)`, of the inline link destination and title that
// open with the `(` at `open`, or -1 when no link does, all before `limit`
// (the end of the paragraph). The destination is `<...>` on one line or a
// run of characters other than spaces and control characters, with its
// parentheses in pairs (`groups`, see parenGroups); the title, after a
// space, is in `"`, `'`, or `()`. A backslash escapes the character after
// it in either. Spaces, and one line break with the block quote markers
// after it, may come between them.
function inlineLinkEnd(source, open, limit, groups) {
  const escaped = (index) => source[index] === "\\" && ESCAPABLE.test(source[index + 1] ?? "");
  let index = skipLinkSpace(source, open + 1, limit);
  if (source[index] === "<") {
    for (index += 1; index < limit && source[index] !== ">"; index += escaped(index) ? 2 : 1) {
      if (source[index] === "<" || source[index] === "\n") {
        return -1;
      }
    }
    if (index >= limit) {
      return -1;
    }
    index += 1;
  } else {
    while (index < limit) {
      const character = source[index];
      if (escaped(index)) {
        index += 2;
      } else if (character === "(") {
        index = groups.get(index) ?? -1;
        if (index === -1) {
          return -1;
        }
      } else if (character === ")" || character <= " " || character === "\x7f") {
        break;
      } else {
        index += 1;
      }
    }
  }
  const destinationEnd = index;
  index = skipLinkSpace(source, index, limit);
  const quote = { "\"": "\"", "'": "'", "(": ")" }[source[index]];
  if (index > destinationEnd && quote !== undefined) {
    for (index += 1; index < limit && source[index] !== quote; index += escaped(index) ? 2 : 1) {
      if (quote === ")" && source[index] === "(") {
        return -1;
      }
    }
    if (index >= limit) {
      return -1;
    }
    index = skipLinkSpace(source, index + 1, limit);
  }
  return index < limit && source[index] === ")" ? index + 1 : -1;
}

// Past the spaces and tabs at `index`, and a line break among them with the
// block quote markers that open the next line. A paragraph has no blank
// line, so there is never a second break.
function skipLinkSpace(source, index, limit) {
  while (index < limit && (source[index] === " " || source[index] === "\t" || source[index] === "\r" || source[index] === "\n")) {
    index += 1;
    if (source[index - 1] === "\n") {
      while (index < limit && (source[index] === " " || source[index] === "\t" || source[index] === ">")) {
        index += 1;
      }
    }
  }
  return index;
}

// Heading markers removed, so an in-prose heading reads as a paragraph. A
// heading with no text is dropped, except a lone `#` (even with trailing
// spaces), which stays a scene break. Closing hashes go with the markers.
export function flattenHeadings(text) {
  return String(text).replace(/^(#+)(?:[ \t]+([^\n]*))?$/gm, (line, hashes, content) => {
    // The spaces before closing hashes match only from the start of their
    // run, so a long run of spaces inside a heading stays linear.
    const heading = String(content ?? "").replace(/(?:^|(?<![ \t])[ \t]+)#+[ \t]*$/, "").trim();
    if (heading !== "") {
      return heading;
    }
    return hashes === "#" ? "#" : "";
  });
}

export function splitWords(markdown) {
  const urls = [];
  // Code is printed by every build, so its words count; only the fence
  // lines themselves, and markup syntax, are left out (see countedText).
  const normalized = countedText(plainLinks(String(markdown))).replace(/\uE000/g, " ")
    .replace(URL_OR_EMAIL, (match) => {
      urls.push(match);
      return ` ${URL_PLACEHOLDER} `;
    })
    // A backslash escape (`didn\'t`) is the character it escapes.
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .replace(EMPHASIS_UNDERSCORES, " ")
    .replace(/[#>*~|`]/g, " ")
    .replace(/(?<!\p{N}):|:(?!\p{N})/gu, " ");

  // Letters and digits in any script, joined as WORD_PATTERN says, so
  // "don\u2019t" and "well-known" each count once. "U.S.A" is three words
  // because the periods split it. Chinese and Japanese count a word per
  // character, and Thai, Lao, Khmer, and Burmese are split by dictionary
  // (see wordSpans).
  let next = 0;
  return wordSpans(normalized, COUNTED_WORD).map(({ word }) => (word === URL_PLACEHOLDER ? urls[next++] : word));
}

// A scene break paragraph: three or more of the same marker, optionally
// spaced (`* * *`, `---`, `~~~`), also when Pandoc escapes it (`\* \* \*`), or a
// lone `#` as in Scrivener and manuscript convention.
export function isSceneBreak(paragraph) {
  const text = String(paragraph).replace(/\\([*_~-])/g, "$1").trim();
  return text === "#" || /^([*_~-])( ?\1){2,}$/.test(text);
}

// A line (or paragraph) that is a scene break, also one spaced with runs of
// spaces or typed spaces (`*  *\u00a0*`).
export function isSceneBreakLine(line) {
  return isSceneBreak(collapseSourceSpace(plainSpaces(line)));
}

// A scene-break line that ends the paragraph above it and starts a new one
// below it in builds, with no blank line between, as a CommonMark thematic
// break does: one indented by fewer than four columns. A more deeply
// indented one continues the paragraph, as in CommonMark.
export function breaksParagraph(line) {
  return /^ {0,3}[^ \t]/.test(line) && isSceneBreakLine(line);
}

// An ATX heading line, as flattenHeadings reads one.
export function isHeadingLine(line) {
  return /^#+(?:[ \t]|$)/.test(line);
}

// The text with a blank line above and below each line that breaks a
// paragraph (see breaksParagraph), for the builds and commands that split
// prose into paragraphs at blank lines themselves. Lines between closed
// backtick fences are code, never a break.
export function separateSceneBreaks(text) {
  const lines = String(text).split("\n");
  const code = fencedLineIndexes(lines.map((line) => line.replace(/\r$/, "")));
  const blank = (line) => /^[ \t\r]*$/.test(line);
  const out = [];
  for (const [index, line] of lines.entries()) {
    const breaks = !code.has(index) && breaksParagraph(line);
    if (breaks && out.length > 0 && !blank(out[out.length - 1])) {
      out.push("");
    }
    out.push(line);
    if (breaks && index < lines.length - 1 && !blank(lines[index + 1])) {
      out.push("");
    }
  }
  return out.join("\n");
}

// The block structure CommonMark reads, for setextSceneBreakLines. Tabs
// count to the next multiple of four columns.
const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const FENCE = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/;
const HTML_BLOCK_TAGS = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
// The seven kinds of HTML block: the first five end at a line holding their
// end marker, the last two at a blank line, and the seventh (a lone tag)
// cannot interrupt a paragraph. The end markers are the ones a browser
// reads, which can come before CommonMark's: an end tag with a space or
// attributes before its `>`, a comment's `--!>` as well as `-->`, and the
// first `>` of a processing instruction or CDATA section, which HTML
// reads as a comment.
const HTML_BLOCKS = [
  { start: /^<(?:script|pre|style|textarea)(?:[ \t>]|$)/i, end: /<\/(?:script|pre|style|textarea)\b[^>]*>/i },
  { start: /^<!--/, end: /--!?>/ },
  { start: /^<\?/, end: />/ },
  { start: /^<![a-z]/i, end: />/ },
  { start: /^<!\[CDATA\[/, end: />/ },
  { start: new RegExp(`^</?(?:${HTML_BLOCK_TAGS})(?:[ \\t>]|/>|$)`, "i"), end: null },
  { start: /^(?:<[a-z][a-z0-9-]*(?:[ \t]+[a-z_:][\w.:-]*(?:[ \t]*=[ \t]*(?:[^ \t"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t]*\/?>|<\/[a-z][a-z0-9-]*[ \t]*>)[ \t]*$/i, end: null, interrupts: false }
];

// How deep block quotes and list items nest before a line's further markers
// read as text. CommonMark sets no limit, but prose never comes near it, and
// the limit keeps a line of `- - - x` (a list in a list, and so on) linear.
const MAX_NESTING = 32;

// A thematic break: three or more of one of `-`, `*`, and `_`, with spaces
// or tabs between, indented by up to three spaces. Read without a
// backtracking pattern, since a line of `- - - x` comes here once for each
// list it opens.
function isThematicBreak(line) {
  const marker = /^ {0,3}([-*_])/.exec(line);
  if (marker === null) {
    return false;
  }
  const rest = line.slice(marker[0].length - 1);
  return rest.split(marker[1]).length > 3 && /^[ \t]*$/.test(rest.replaceAll(marker[1], ""));
}

function expandTabs(line) {
  let out = "";
  for (const character of line) {
    out += character === "\t" ? " ".repeat(4 - (out.length % 4)) : character;
  }
  return out;
}

function indentOf(line) {
  return /^ */.exec(line)[0].length;
}

// The list item a line opens, as { indent, rest } with the column its
// content starts at, or null. An empty item, or a numbered one that does
// not start at 1, cannot interrupt a paragraph, so `1999. The year it
// ended.` inside one is text.
function listItem(line, interrupting) {
  const marker = /^ {0,3}(?:[-+*]|(\d{1,9})[.)])(?= |$)/.exec(line);
  if (!marker || isThematicBreak(line)) {
    return null;
  }
  const after = line.slice(marker[0].length);
  const empty = after.trim() === "";
  if (interrupting && (empty || (marker[1] !== undefined && Number(marker[1]) !== 1))) {
    return null;
  }
  const spaces = indentOf(after);
  const indent = marker[0].length + (empty || spaces > 4 ? 1 : spaces);
  return { indent, rest: empty ? "" : line.slice(indent) };
}

function htmlBlock(line, interrupting) {
  const text = line.slice(indentOf(line));
  return HTML_BLOCKS.find((block) => block.start.test(text) && !(interrupting && block.interrupts === false)) ?? null;
}

// Whether a line, past the containers it continues, opens a block, so it
// cannot continue the open paragraph lazily.
function opensBlock(line) {
  if (line.trim() === "") {
    return true;
  }
  if (indentOf(line) > 3) {
    return false;
  }
  return /^ {0,3}>/.test(line) || listItem(line, true) !== null || isThematicBreak(line) || ATX_HEADING.test(line) || FENCE.test(line) || htmlBlock(line, true) !== null;
}

// Body line indexes (counted from 0) of the `---` lines that builds print as
// a scene break (see breaksParagraph) but CommonMark reads as a setext
// heading underline, which makes the paragraph above a heading in a
// markdown viewer, and in the markdown export opened in one. The prose is
// read as CommonMark reads its blocks: an underline counts only in the
// block quote or list item of its paragraph, and never on a lazy line, and
// nothing in fenced code (backticks or tildes), indented code, or an HTML
// block underlines. Builds read code in closed backtick fences and HTML
// comments as no break at all, so a `---` in one never counts.
export function setextSceneBreakLines(markdownBody) {
  const body = String(markdownBody).replace(/\r\n?/g, "\n");
  const masked = maskMarkup(body);
  const start = proseStart(body, masked);
  const first = masked.slice(0, start).split("\n").length - 1;
  const buildLines = masked.slice(start).split("\n");
  const printsBreak = (index) => breaksParagraph(buildLines[index].replace(/^(?:[ \t]*>[ \t]?)+/, ""));
  const found = [];
  // Open block quotes ({ quote: true }) and list items ({ indent, empty },
  // where `empty` says it has no content yet), outermost first, and the leaf
  // block open in the innermost: null, or { kind } of "paragraph", "code",
  // "fence" (with its `marker`), or "html" (with its `end`, null for a blank
  // line).
  const containers = [];
  let leaf = null;
  for (const [index, source] of body.slice(start).split("\n").entries()) {
    let line = expandTabs(source);
    let matched = 0;
    for (const container of containers) {
      const quote = container.quote ? /^ {0,3}> ?/.exec(line) : null;
      if (quote) {
        line = line.slice(quote[0].length);
      } else if (!container.quote && line.trim() === "" && !container.empty) {
        // A list item goes on over blank lines, unless it opened with one:
        // an item can start with at most one blank line.
        line = "";
      } else if (!container.quote && line.trim() !== "" && indentOf(line) >= container.indent) {
        line = line.slice(container.indent);
        container.empty = false;
      } else {
        break;
      }
      matched += 1;
    }
    if (matched === containers.length && leaf?.kind === "fence") {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === leaf.marker[0] && close[1].length >= leaf.marker.length) {
        leaf = null;
      }
      continue;
    }
    if (matched === containers.length && leaf?.kind === "html") {
      if (leaf.end === null ? line.trim() === "" : leaf.end.test(line)) {
        leaf = null;
      }
      continue;
    }
    if (matched < containers.length) {
      // A lazy continuation line: the paragraph and its containers go on.
      if (leaf?.kind === "paragraph" && !opensBlock(line)) {
        continue;
      }
      containers.length = matched;
      leaf = null;
    }
    while (containers.length < MAX_NESTING) {
      const quote = /^ {0,3}> ?/.exec(line);
      const item = quote ? null : listItem(line, leaf?.kind === "paragraph");
      if (!quote && item === null) {
        break;
      }
      containers.push(quote ? { quote: true } : { quote: false, indent: item.indent, empty: item.rest === "" });
      line = quote ? line.slice(quote[0].length) : item.rest;
      leaf = null;
    }
    const paragraph = leaf?.kind === "paragraph";
    if (line.trim() === "") {
      leaf = paragraph ? null : leaf;
    } else if (indentOf(line) > 3) {
      // Indented code, or the open paragraph's text.
      leaf = paragraph ? leaf : { kind: "code" };
    } else if (paragraph && /^ {0,3}(?:=+|-+)[ \t]*$/.test(line)) {
      if (line.includes("-") && printsBreak(index)) {
        found.push(first + index);
      }
      leaf = null;
    } else if (isThematicBreak(line) || ATX_HEADING.test(line)) {
      leaf = null;
    } else if (FENCE.test(line)) {
      leaf = { kind: "fence", marker: FENCE.exec(line)[1] };
    } else if (htmlBlock(line, paragraph) !== null) {
      const { end } = htmlBlock(line, paragraph);
      leaf = end !== null && end.test(line) ? null : { kind: "html", end };
    } else {
      leaf = paragraph ? leaf : { kind: "paragraph" };
    }
  }
  return found;
}

// A footnote definition (`[^1]: The note.`) as GitHub and Pandoc read one,
// after its indent (footnoteLines allows three spaces at most). Its label
// runs to the first `]`, so a test reads the line once.
const FOOTNOTE_DEFINITION = /^ *\[\^[^\]\n]+\]:/;

// Body line indexes (counted from 0) of the footnote definitions in the
// prose, in a block quote too. Builds have no footnotes, so they print a
// definition and its `[^1]` markers as written, where a markdown viewer
// shows a footnote. A line in an HTML comment, a closed backtick fence, an
// HTML block, or indented code is not one.
export function footnoteLines(markdownBody) {
  const body = String(markdownBody).replace(/\r\n?/g, "\n");
  const masked = maskMarkup(body);
  const start = proseStart(body, masked);
  const first = masked.slice(0, start).split("\n").length - 1;
  const found = [];
  // The HTML block the line before opened or continued, and whether a
  // paragraph is open, which the last kind of HTML block cannot interrupt.
  let html = null;
  let paragraph = false;
  for (const [index, line] of masked.slice(start).split("\n").entries()) {
    const content = expandTabs(line.slice(/^(?: {0,3}>[ \t]?)*/.exec(line)[0].length));
    if (html !== null) {
      html = (html.end === null ? content.trim() === "" : html.end.test(content)) ? null : html;
    } else if (content.trim() === "") {
      paragraph = false;
    } else if (indentOf(content) <= 3) {
      // A line indented further is indented code, or the open paragraph's
      // text, and changes nothing.
      const block = htmlBlock(content, paragraph);
      const footnote = block === null && FOOTNOTE_DEFINITION.test(content);
      if (block !== null) {
        html = block.end !== null && block.end.test(content) ? null : block;
      }
      if (footnote) {
        found.push(first + index);
      }
      paragraph = block === null && !footnote;
    }
  }
  return found;
}

// Chinese and Japanese characters, as fixed ranges so that every runtime
// reads them alike (Unicode's script data grows between versions): CJK
// radicals and ideographic description, the CJK symbols and punctuation
// block (。、「」 and the ideographic space), kana and its extensions,
// kanbun, strokes, enclosed and compatibility CJK, Han in every plane, CJK
// vertical and compatibility forms, and the full-width and halfwidth forms
// besides halfwidth Hangul. Korean, set with spaces between words, is not
// among them.
const CJK_CHARACTER = /^[\u2e80-\u2fff\u3000-\u30ff\u3190-\u319f\u31c0-\u31ff\u3220-\u325f\u3280-\u33ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe10-\ufe1f\ufe30-\ufe4f\uff01-\uff9f\uffe0-\uffee\u{1b000}-\u{1b16f}\u{20000}-\u{3ffff}]$/u;
// Punctuation Chinese and Japanese set at full width though Unicode leaves
// its width open: the middle dot between the parts of a transcribed name
// (列夫·托尔斯泰), dashes, ellipses, and curly quotes.
const WIDE_PUNCTUATION = /^[\u00b7\u2014\u2015\u2018\u2019\u201c\u201d\u2025\u2026]$/u;
// Combining marks and variation selectors, which belong to the character
// before them: 葛 with an ideographic variation selector is still 葛.
const COMBINING = /^[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\u302a-\u302f\u3099\u309a\ufe00-\ufe0f\ufe20-\ufe2f\u{e0100}-\u{e01ef}]$/u;

// The last character of a line, past combining marks and variation
// selectors, or "" for none.
function lastCharacter(text) {
  let end = text.length;
  while (end > 0) {
    const pair = end > 1 && /[\udc00-\udfff]/.test(text[end - 1]) && /[\ud800-\udbff]/.test(text[end - 2]);
    const character = text.slice(end - (pair ? 2 : 1), end);
    if (!COMBINING.test(character)) {
      return character;
    }
    end -= character.length;
  }
  return "";
}

// What a soft line break between two lines of one paragraph becomes:
// nothing between two Chinese or Japanese characters, which set no space
// between words, or between one of them and the full-width punctuation
// beside it, as CSS joins such lines; otherwise a space. `before` and
// `after` are the two lines without the layout whitespace at the break. A
// line that ends or starts with an emphasis or code marker keeps the
// space, so the markup on either side never runs together (`**強調**` and
// `**次**` would make `****`).
export function softBreak(before, after) {
  const left = lastCharacter(String(before));
  const first = String(after).codePointAt(0);
  const right = first === undefined ? "" : String.fromCodePoint(first);
  const cjkLeft = CJK_CHARACTER.test(left);
  const cjkRight = CJK_CHARACTER.test(right);
  return (cjkLeft && (cjkRight || WIDE_PUNCTUATION.test(right))) || (cjkRight && WIDE_PUNCTUATION.test(left)) ? "" : " ";
}

// Whitespace that only lays out the markdown source: ASCII spaces, tabs,
// and line ends, and the Unicode line and paragraph separators. A space a
// writer types as text is not layout and stays: the no-break space and
// the narrow no-break space French sets inside « » and before ? and !, and
// the ideographic space that indents a Japanese or Chinese paragraph.
// JavaScript's \s and trim() take all of them.
const SOURCE_SPACE = new Set([" ", "\t", "\n", "\v", "\f", "\r", "\u2028", "\u2029"]);
const SOURCE_SPACE_RUN = /[ \t\n\v\f\r\u2028\u2029]+/g;

// Each run of layout whitespace as one space.
export function collapseSourceSpace(text) {
  return String(text).replace(SOURCE_SPACE_RUN, " ");
}

// Each typed space as a plain one, for a check that reads a line's shape,
// such as whether it is a scene break; layout whitespace is left as it is.
export function plainSpaces(text) {
  return String(text).replace(/[^\S \t\n\v\f\r\u2028\u2029]/g, " ");
}

// trim() for layout whitespace only.
export function trimSourceSpace(text) {
  const value = String(text);
  let start = 0;
  let end = value.length;
  while (start < end && SOURCE_SPACE.has(value[start])) {
    start += 1;
  }
  while (end > start && SOURCE_SPACE.has(value[end - 1])) {
    end -= 1;
  }
  return value.slice(start, end);
}

// A chapter or matter body without the blank lines at either end, even
// ones that hold only typed spaces, but with the typed space that opens
// its first line of text (a paragraph indent) kept.
export function trimBlankLines(text) {
  const lines = String(text).split("\n");
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") {
    start += 1;
  }
  while (end > start && lines[end - 1].trim() === "") {
    end -= 1;
  }
  return trimSourceSpace(lines.slice(start, end).join("\n"));
}

export function wordCount(markdown) {
  return splitWords(markdown).length;
}

// Created on first use, so a project counted in words never needs it.
let graphemes;

// Characters as Chinese and Japanese count a manuscript: every grapheme
// cluster that is not whitespace, punctuation included, after the markdown
// stripping wordCount does (see countedText). Scene break lines and markup
// characters, every underscore among them, are not book text, so they are
// left out; a full-width space indent is whitespace.
export function characterCount(markdown) {
  // A line is a scene break as written: `&#45;&#45;&#45;` prints as text.
  const lines = plainLinks(String(markdown).replace(/\uE000/g, " ")).split("\n");
  const text = countedText(lines.map((line) => (isSceneBreak(line) ? "" : line)).join("\n"))
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .replace(/[#>*_~|`\s]+/gu, "");
  graphemes ??= new Intl.Segmenter("en", { granularity: "grapheme" });
  let count = 0;
  for (const _ of graphemes.segment(text)) {
    count += 1;
  }
  return count;
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

const TODO_MARKER = /\[TODO\b/i;
const TODO_MARKERS = /\[TODO\b/gi;

// How many `[TODO` markers (`[TODO: check bible]`) prose holds. Pass prose
// with comments removed: a marker inside a comment never reaches a build.
// Only text a reader sees counts, so a marker in a link destination or
// title, a URL, or an HTML tag does not (see maskLinkTargets).
export function countTodoMarkers(prose) {
  const text = String(prose);
  return TODO_MARKER.test(text) ? (maskLinkTargets(text).text.match(TODO_MARKERS) ?? []).length : 0;
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

// Markdown link syntax, as story rename --prose leaves it alone. A link's
// parts may run onto the next line of a paragraph, never across a blank
// line, and a line inside a block quote may open with `>` markers.
const QUOTE_MARKERS = String.raw`(?:[ \t]*>)*`;
const NEXT_LINE = String.raw`\n(?![ \t>]*\r?$)`;
const LINK_BREAK = String.raw`[ \t]*\r?${NEXT_LINE}${QUOTE_MARKERS}[ \t]*`;
const titleText = (close) => String.raw`(?:[^${close}\n]|${NEXT_LINE}){0,1000}`;
const LINK_TITLE = String.raw`(?:"${titleText('"')}"|'${titleText("'")}'|\(${titleText("()")}\))`;
// A reference definition (`[label]: url "Title"`), in a block quote or a
// list item too, with its destination or title on the next line or not,
// and nothing after them on their line, so `[Ines]: are you there?` is
// not one. A footnote (`[^1]: text`) is prose. Bounded, so it stays
// linear.
const LINK_DEFINITION = new RegExp(String.raw`^${QUOTE_MARKERS}[ \t]*\[(?!\^)([^[\]\n]{1,999})\]:(?:${LINK_BREAK}|[ \t]*)(?:<[^<>\n]*>|[^\s<]\S{0,2000})(?:(?:${LINK_BREAK}|[ \t]+)${LINK_TITLE})?[ \t]*$`, "gm");
// A full reference's label, after its text's `]`.
const FULL_REFERENCE_LABEL = String.raw`(?<=\])\[(?:[^[\]\n]|${NEXT_LINE}){0,999}\]`;
// A full reference's label; an autolink; and an HTML tag with its
// attributes (`<img src="img/Ines.png" alt="Ines">`). Bounded, so a long
// run of unclosed `[` or `<` stays linear. Inline destinations are found
// by inlineDestinations.
const LINK_TARGET = new RegExp([
  FULL_REFERENCE_LABEL,
  String.raw`<[a-z][a-z0-9+.-]{1,31}:[^<>\s]*>`,
  String.raw`<\/?[a-z][a-z0-9-]*(?:\s(?:[^<>\n]|${NEXT_LINE}){0,2000})?\/?>`
].join("|"), "gim");
// A bare URL, to the next space, so parentheses and brackets in it are
// part of it (`https://example.com/(Ines)`, `http://[::1]/Ines`), and an
// email address.
const BARE_ADDRESS = /(?<![a-z0-9+.-])(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>]*|(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}][\p{L}\p{N}._%+-]*@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/giu;
// A shortcut (`[Ines]`) or collapsed (`[Ines][]`) reference: its text is
// its label.
const REFERENCE_TEXT = /\[([^[\]\n]{1,999})\](?:\[\])?(?![([])/g;
// A line that ends a paragraph, so a definition may follow it: a heading
// or a thematic break. Blank lines are found apart.
const BLOCK_LINE = /^[ \t>]*(?:#{1,6}(?:[ \t]|\r?$)|([-*_])(?:[ \t]*\1){2,}[ \t]*\r?$)/;

// The reference definitions in `source`, as [start, end, label]. A
// definition counts only where a paragraph may start: at the start, after
// a blank line (or one of nothing but `blank`, as an earlier mask leaves a
// comment), a heading, a thematic break, or another definition.
function linkDefinitions(source, blank = " ") {
  const definitions = [];
  const blankLine = new RegExp(`^[ \\t>${escapeRegExp(blank)}]*\\r?$`);
  let definitionEnd = -1;
  for (const match of source.matchAll(LINK_DEFINITION)) {
    const lineStart = source.lastIndexOf("\n", match.index - 2) + 1;
    const previous = source.slice(lineStart, Math.max(lineStart, match.index - 1));
    const opens = match.index === 0 || blankLine.test(previous) || BLOCK_LINE.test(previous)
      || (definitionEnd !== -1 && source.slice(definitionEnd, match.index).trim() === "");
    if (opens) {
      definitionEnd = match.index + match[0].length;
      definitions.push([match.index, definitionEnd, match[1]]);
    }
  }
  return definitions;
}

// Link syntax in `text` a reader does not see as prose, blanked with
// `blank`, keeping line breaks, so offsets still match: link and image
// destinations and titles, the label of a full reference, reference
// definitions (see linkDefinitions), autolinks, HTML tags, and bare URLs
// and email addresses. Link text and image alt text are kept. Returns
// { text, references }: `references` lists, as [start, end], the text of
// each shortcut or collapsed reference whose label is defined, since that
// text is the label too, and renaming it would break the link.
export function maskLinkTargets(text, blank = " ") {
  const source = String(text);
  const ranges = [];
  const labels = new Set();
  for (const [start, end, name] of linkDefinitions(source, blank)) {
    labels.add(referenceLabel(name));
    ranges.push([start, end]);
  }
  for (const pattern of [LINK_TARGET, BARE_ADDRESS]) {
    for (const match of source.matchAll(pattern)) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  ranges.push(...inlineDestinations(source, blank));
  ranges.sort((left, right) => left[0] - right[0]);
  const masked = [];
  let result = "";
  let position = 0;
  for (const [start, end] of ranges) {
    if (end > position) {
      const from = Math.max(start, position);
      result += source.slice(position, from) + source.slice(from, end).replace(/[^\r\n]/g, blank);
      masked.push([from, end]);
      position = end;
    }
  }
  // References outside the masked parts, found in text order, as are the
  // parts, so one pass over both finds them.
  const references = [];
  let next = 0;
  for (const match of labels.size === 0 ? [] : source.matchAll(REFERENCE_TEXT)) {
    const [start, end] = [match.index + 1, match.index + 1 + match[1].length];
    while (next < masked.length && masked[next][1] <= start) {
      next += 1;
    }
    if (labels.has(referenceLabel(match[1])) && (next === masked.length || masked[next][0] >= end)) {
      references.push([start, end]);
    }
  }
  return { text: result + source.slice(position), references };
}

// The inline link and image destinations in `source`, with their titles,
// each as [start, end] from the `(` after a `]` to the `)` that closes it.
// Parentheses nest to any depth, a backslash escapes the character after
// it as in CommonMark (`img/Ines\(draft.png`), and a destination may run onto the next line
// of its paragraph, never past a blank line or a line of nothing but
// `blank`. One pass, with a stack of the parentheses still open.
function inlineDestinations(source, blank) {
  const ranges = [];
  const open = [];
  const space = (character) => character === " " || character === "\t" || character === "\r" || character === ">" || character === blank;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\" && /[!-/:-@[-`{-~]/.test(source[index + 1] ?? "")) {
      index += 1;
    } else if (character === "(") {
      open.push(index);
    } else if (character === ")") {
      const start = open.pop();
      if (start !== undefined && source[start - 1] === "]") {
        ranges.push([start, index + 1]);
      }
    } else if (character === "\n") {
      let next = index + 1;
      while (next < source.length && space(source[next])) {
        next += 1;
      }
      if (next === source.length || source[next] === "\n") {
        open.length = 0;
      }
    }
  }
  return ranges;
}

// HTML elements, so a tag is told from text in angle brackets. The tags of
// the inline ones, and of custom elements, go without a trace, so
// `<i>un</i>known` is one word; any other tag (`<br>`, `<p>`) parts the
// words on either side.
const INLINE_ELEMENTS = new Set("a abbr b bdi bdo big cite code data del dfn em font i ins kbd mark q rp rt ruby s samp small span strike strong sub sup time tt u var wbr".split(" "));
const OTHER_ELEMENTS = "address area article aside audio base blockquote body br button canvas caption center col colgroup datalist dd details dialog div dl dt embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html iframe img input label legend li link main map menu meta meter nav noscript object ol optgroup option output p picture pre progress script search section select slot source style summary table tbody td template textarea tfoot th thead title tr track ul video";
// A tag name in lower case: a known element, or a custom one, which has a
// hyphen (`<book-note>`). `<I hear you>` and `<Time is short>` are prose.
const ELEMENT = `(?:${[...INLINE_ELEMENTS].join("|")}|${OTHER_ELEMENTS.replace(/ /g, "|")}|[a-z][a-z\\d._]*-[a-z\\d._-]*)(?![\\w.-])`;
// Attributes HTML sets by name alone. Any other word after a tag name must
// take a value (`class="smallcaps"`), so `<i hear you>` is prose too.
const BOOLEAN_ATTRIBUTES = "allowfullscreen async autofocus autoplay checked controls default defer disabled formnovalidate hidden inert ismap itemscope loop multiple muted nomodule novalidate open playsinline readonly required reversed selected";
// An opening or closing tag. Its attributes and their values are bounded,
// so a long run of unclosed `<` or quotes stays linear.
const ATTRIBUTE = String.raw`\s+(?:[a-zA-Z_:][\w.:-]*\s*=\s*(?:"[^"<>]{0,1000}"|'[^'<>]{0,1000}'|[^\s"'=<>\x60]+)|(?:${BOOLEAN_ATTRIBUTES.replace(/ /g, "|")})(?=[\s/>]))`;
const HTML_TAG = String.raw`<(?:${ELEMENT}(?:${ATTRIBUTE}){0,100}\s*\/?|\/${ELEMENT}\s*)>`;
const FOOTNOTE = String.raw`\[\^[^[\]\s]{1,999}\]`;
// Markup syntax that counts leave out: an HTML tag, a footnote marker
// (`[^1]`, with its colon where it opens the note), and an HTML entity,
// which counts as the character it stands for.
const COUNTED_MARKUP = new RegExp([
  HTML_TAG,
  String.raw`(?<=^[ \t]{0,3})${FOOTNOTE}:`,
  FOOTNOTE,
  String.raw`&(?:#\d{1,7}|#[xX][\da-fA-F]{1,6}|[A-Za-z][A-Za-z\d]{1,31});`
].join("|"), "gm");
const FULL_REFERENCE_LABELS = new RegExp(FULL_REFERENCE_LABEL, "gm");
// A task-list box (`- [ ]`, `1. [x]`), after its list marker.
const TASK_BOX = /^((?:[ \t]*>)*[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]+)\[[ xX]\](?=[ \t]|\r?$)/gm;
// A definition indented no more than CommonMark allows; one indented four
// spaces or a tab could be code.
const DEFINITION_INDENT = /^(?:[ \t]*>)* {0,3}\[/;
const NO_LABELS = new Set();

// The text as word and character counts read it: closed code fences
// without their fence lines, and outside them, without markup syntax that
// is not prose. Only the syntax goes, never the text it marks up: an HTML
// tag (`<span class="smallcaps">Lord</span>` keeps `Lord`), a footnote
// marker (`[^1]`, the note's own text counts), a task-list box (`- [x]`),
// and a reference definition (`[mill]: mill.md`) whose label a reference
// link uses, with the label of each full reference to a defined label
// (`[the mill][mill]` keeps `the mill`). An HTML entity is the character
// it stands for (`&rsquo;`). The builds print this syntax as written for
// now, but it is markup, not words. Markup in a code span, or escaped with
// a backslash, is printed as written, so it counts. Run it after
// plainLinks, so an entity in a link (`&#41;`) cannot end it early.
export function countedText(markdown) {
  const parts = splitFences(String(markdown));
  const prose = parts.filter((part) => !part.fenced).map((part) => ({ text: part.text, code: literalSpans(part.text) }));
  // A line shaped like a definition is one only when a reference uses its
  // label, so a chat log's `[Mira]: Hello?` stays prose. A label in code
  // or in such a line is not a use.
  const used = new Set();
  for (const { text, code } of prose) {
    const outsideCode = missesAll(code);
    const outsideDefinitions = missesAll([...text.matchAll(LINK_DEFINITION)].map((match) => [match.index, match.index + match[0].length]));
    for (const match of text.matchAll(REFERENCE_TEXT)) {
      const end = match.index + match[0].length;
      if (outsideCode(match.index, end) && outsideDefinitions(match.index, end)) {
        used.add(referenceLabel(match[1]));
      }
    }
  }
  const definitions = prose.map(({ text }) => linkDefinitions(text)
    .filter(([start, end, label]) => used.has(referenceLabel(label)) && DEFINITION_INDENT.test(text.slice(start, end))));
  const defined = new Set(definitions.flat().map(([, , label]) => referenceLabel(label)));
  let next = 0;
  return parts.map((part) => {
    if (part.fenced) {
      return withoutFenceMarkers(part.text);
    }
    const { text, code } = prose[next];
    const edits = markupEdits(text, code, definitions[next], defined);
    next += 1;
    return applyEdits(text, edits);
  }).join("");
}

// The words of one paragraph of inline markdown, as splitWords counts them
// (a link keeps its text and loses its target, a URL is one word, and
// countedText's markup is read out), as { word, start, end } with offsets
// into `text` as written, so a passage can be quoted as written. A
// reference definition and its labels need the whole chapter, so here
// they are read as text.
export function proseWordSpans(text) {
  const source = String(text);
  // Each stage edits the text of the one before. Offsets map back through
  // every stage, so a word's span is its place in `source`.
  // A link or image needs `](` for its destination, so text without one has
  // no links to cut.
  const cuts = source.includes("](") ? linkCuts(source) : [];
  const links = editedText(source, cuts.map(([start, end]) => [start, end, ""]));
  const markup = editedText(links.text, markupEdits(links.text));
  const urls = editedText(markup.text, urlEdits(markup.text));
  return wordSpans(urls.text, COUNTED_WORD).map(({ word, start, end }) => {
    const [inMarkup, markupEnd] = urls.back(start, end);
    const [inLinks, linksEnd] = markup.back(inMarkup, markupEnd);
    const [from, to] = links.back(inLinks, linksEnd);
    return { word: word === URL_PLACEHOLDER ? markup.text.slice(inMarkup, markupEnd) : word, start: from, end: to };
  });
}

// `text` with each of `edits` ([start, end, replacement], in order and
// apart) made. The result's `back(start, end)` gives the [start, end) span
// of `text` that the characters [start, end) of the result came from. The
// copied runs and the replacements are kept as runs, not a character at a
// time, so a long paragraph costs no more than its edits.
function editedText(text, edits) {
  let result = "";
  const runs = [];
  let position = 0;
  const copy = (end) => {
    if (end > position) {
      runs.push({ out: result.length, from: position, to: end, copied: true });
      result += text.slice(position, end);
    }
  };
  for (const [start, end, replacement] of edits) {
    copy(start);
    runs.push({ out: result.length, from: start, to: end, copied: false });
    result += replacement;
    position = end;
  }
  copy(text.length);
  // The run holding the character at `index` of the result: the last run
  // that starts at or before it.
  const runAt = (index) => {
    let low = 0;
    let high = runs.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (runs[middle].out <= index) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return runs[low];
  };
  // Where the character at `index` of the result starts in `text`, and
  // where it ends: a copied character maps to itself, and a replaced one to
  // the edit that replaced it.
  const startIn = (index) => {
    const run = runAt(index);
    return run.copied ? run.from + (index - run.out) : run.from;
  };
  const endIn = (index) => {
    const run = runAt(index);
    return run.copied ? run.from + (index - run.out) + 1 : run.to;
  };
  return { text: result, back: (start, end) => [startIn(start), endIn(end - 1)] };
}

// The URLs and email addresses of `text`, each set aside as one word as
// splitWords sets them aside, and a stray placeholder character as a space.
function urlEdits(text) {
  const edits = [];
  for (const match of text.matchAll(/\uE000/g)) {
    edits.push([match.index, match.index + 1, " "]);
  }
  // A URL or email address has `://`, `www.`, or `@`, so the pattern runs
  // only where one of them is.
  if (/:\/\/|www\.|@/i.test(text)) {
    for (const match of text.replace(/\uE000/g, " ").matchAll(URL_OR_EMAIL)) {
      edits.push([match.index, match.index + match[0].length, ` ${URL_PLACEHOLDER} `]);
    }
  }
  return edits.sort((left, right) => left[0] - right[0]);
}

// The markup edits countedText makes in `text`, which holds no closed
// fence, as [start, end, replacement] in order, none overlapping another
// or a code span. `definitions` are the reference definitions to drop and
// `defined` the labels a full reference may name.
function markupEdits(text, code = literalSpans(text), definitions = [], defined = NO_LABELS) {
  const edits = definitions.map(([start, end]) => [start, end, text.slice(start, end).replace(/[^\r\n]/g, "")]);
  for (const match of defined.size === 0 ? [] : text.matchAll(FULL_REFERENCE_LABELS)) {
    if (defined.has(referenceLabel(match[0].slice(1, -1)))) {
      edits.push([match.index, match.index + match[0].length, ""]);
    }
  }
  for (const match of text.matchAll(TASK_BOX)) {
    const start = match.index + match[1].length;
    edits.push([start, start + 3, ""]);
  }
  for (const match of text.matchAll(COUNTED_MARKUP)) {
    if (!escaped(text, match.index)) {
      edits.push([match.index, match.index + match[0].length, markupText(match[0])]);
    }
  }
  edits.sort((left, right) => left[0] - right[0]);
  const outsideCode = missesAll(code);
  let position = 0;
  const kept = edits.filter(([start, end]) => {
    if (start < position || !outsideCode(start, end)) {
      return false;
    }
    position = end;
    return true;
  });
  // An autolink is its address, as builds print it, and nothing in it is
  // read as markup.
  const autolinks = code.filter((span) => span[2] === "autolink").map(([start, end]) => [start, end, text.slice(start + 1, end - 1)]);
  return [...kept, ...autolinks].sort((left, right) => left[0] - right[0]);
}

function applyEdits(text, edits) {
  let result = "";
  let position = 0;
  for (const [start, end, replacement] of edits) {
    result += text.slice(position, start) + replacement;
    position = end;
  }
  return result + text.slice(position);
}

// What a match of COUNTED_MARKUP leaves in the text.
function markupText(markup) {
  if (markup[0] === "&") {
    return entityText(markup);
  }
  const name = /^<\/?([a-z][\w.-]*)/.exec(markup)?.[1];
  return name === undefined || INLINE_ELEMENTS.has(name) || name.includes("-") ? "" : " ";
}

// The character an entity (`&amp;`, `&#8217;`, `&#x2019;`) stands for, as
// builds read it (see characterReference). A name HTML lacks, or one in
// the wrong case, is left as written, as CommonMark prints it.
function entityText(entity) {
  return characterReference(entity, 0)?.value ?? entity;
}

// A label as CommonMark matches labels: case and runs of spaces ignored.
function referenceLabel(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

// True when the character at `index` follows an odd run of backslashes,
// which escapes it; an even run is escaped backslashes.
function escaped(text, index) {
  let start = index;
  while (start > 0 && text[start - 1] === "\\") {
    start -= 1;
  }
  return (index - start) % 2 === 1;
}

// A test of whether [start, end] misses every one of `ranges`, which are
// in order and apart, for queries made in order of start.
function missesAll(ranges) {
  let next = 0;
  return (start, end) => {
    while (next < ranges.length && ranges[next][1] <= start) {
      next += 1;
    }
    return next === ranges.length || ranges[next][0] >= end;
  };
}

// The code spans and autolinks in `text`, as [start, end] in order and
// apart, with "autolink" third for an autolink: builds print the markup in
// them as written. An autolink that a code span overlaps is left to the
// code span.
function literalSpans(text) {
  const code = codeSpans(text);
  const spans = [];
  let next = 0;
  for (let index = text.indexOf("<"); index !== -1; index = text.indexOf("<", index + 1)) {
    while (next < code.length && code[next][1] <= index) {
      spans.push(code[next]);
      next += 1;
    }
    const end = escaped(text, index) ? -1 : autolinkEnd(text, index);
    if (end !== -1 && (next === code.length || end <= code[next][0])) {
      spans.push([index, end, "autolink"]);
      index = end - 1;
    }
  }
  return [...spans, ...code.slice(next)];
}

// The code spans in `text`, as [start, end] in order, read as CommonMark
// reads them on one line: a run of backticks and the next run of the same
// length. A backslash before a run outside code escapes its first
// backtick, so the rest opens it. Each run's closer is found in one pass
// from the end of the line, so many runs of different lengths stay linear.
function codeSpans(text) {
  const spans = [];
  let lineStart = 0;
  for (const line of text.split("\n")) {
    const runs = line.includes("`")
      ? [...line.matchAll(/`+/g)].map((match) => {
        const from = match.index + (escaped(line, match.index) ? 1 : 0);
        return { from, opens: match.index + match[0].length - from, length: match[0].length, end: match.index + match[0].length };
      })
      : [];
    const closers = [];
    const later = new Map();
    for (let index = runs.length - 1; index >= 0; index -= 1) {
      closers[index] = later.get(runs[index].opens);
      later.set(runs[index].length, index);
    }
    for (let index = 0; index < runs.length; index += 1) {
      const close = closers[index];
      if (close !== undefined) {
        spans.push([lineStart + runs[index].from, lineStart + runs[close].end]);
        index = close;
      }
    }
    lineStart += line.length + 1;
  }
  return spans;
}

// One left-to-right pass over comments, closed backtick fences, and code
// spans: whichever opens first owns the text until it closes. A `<!--`
// inside a fence or code span is literal, and a fence inside a comment is
// part of the comment, which runs to the first `-->` as a CommonMark HTML
// block does. A comment or fence that never closes hides nothing. A search
// is not repeated while its answer still holds, and one that fails is not
// repeated at all, so any number of unclosed openers, or of code spans on
// one line, stays linear.
function scanMarkup(text) {
  const ranges = [];
  let unclosed = false;
  let fences = null;
  let closeSpan = null;
  let nextOpen = -2;
  let nextTick = -2;
  let lineEnd = -1;
  let position = 0;
  while (position < text.length) {
    if (position > lineEnd) {
      const newline = text.indexOf("\n", position);
      lineEnd = newline === -1 ? text.length : newline;
      closeSpan = null;
    }
    if (position === 0 || text[position - 1] === "\n") {
      // A backtick opener has no backtick after its run, as CommonMark reads
      // one, so ```x``` is a code span and not a fence.
      const marker = /^ {0,3}(`{3,})(?=[^`]*$)/.exec(text.slice(position, lineEnd));
      if (marker) {
        fences ??= fenceCloser(text);
        const end = fences(lineEnd, marker[1].length);
        if (end !== -1) {
          ranges.push({ kind: "fence", start: position, end });
          position = end;
          continue;
        }
      }
    }
    if (nextOpen !== -1 && nextOpen < position) {
      nextOpen = text.indexOf("<!--", position);
    }
    // Likewise the next backtick is found again only once passed, so many
    // lines without one stay linear.
    if (nextTick !== -1 && nextTick < position) {
      nextTick = text.indexOf("`", position);
    }
    const open = nextOpen !== -1 && nextOpen < lineEnd ? nextOpen : -1;
    const tick = nextTick;
    if (tick !== -1 && tick < lineEnd && (open === -1 || tick < open)) {
      // A backslash escapes the first backtick of a run, and the rest of the
      // run is read on its own, as codeSpans reads it.
      if (escaped(text, tick)) {
        position = tick + 1;
        continue;
      }
      // A code span closes on its own line; an unmatched run is plain text.
      let runEnd = tick;
      while (text[runEnd] === "`") {
        runEnd += 1;
      }
      closeSpan ??= codeSpanCloser(text, lineEnd);
      const end = closeSpan(tick, runEnd - tick);
      position = end === -1 ? runEnd : end;
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

// Finds the line that closes a backtick fence in `text`: called with the
// end of the opener's line and its marker's length, it returns the end of
// the first later line of up to three spaces and at least that many
// backticks alone, just past the line, or -1 when there is none. Openers
// must come in text order. Every such line is listed once, with the
// longest marker from it on, so an opener that nothing closes is found out
// at once rather than by reading the rest of the text.
function fenceCloser(text) {
  const closers = [];
  for (let lineStart = 0; lineStart < text.length;) {
    const next = text.indexOf("\n", lineStart);
    const lineEnd = next === -1 ? text.length : next;
    const line = text.slice(lineStart, lineEnd);
    const marker = /^ {0,3}(`{3,})/.exec(line);
    if (marker && line.trim() === marker[1]) {
      closers.push({ start: lineStart, end: Math.min(lineEnd + 1, text.length), length: marker[1].length });
    }
    lineStart = lineEnd + 1;
  }
  const longest = closers.map((closer) => closer.length);
  for (let index = longest.length - 2; index >= 0; index -= 1) {
    longest[index] = Math.max(longest[index], longest[index + 1]);
  }
  let first = 0;
  return (openerEnd, length) => {
    while (first < closers.length && closers[first].start <= openerEnd) {
      first += 1;
    }
    if (first === closers.length || longest[first] < length) {
      return -1;
    }
    let index = first;
    while (closers[index].length < length) {
      index += 1;
    }
    return closers[index].end;
  };
}

// Finds the backtick run that closes a code span in `text` before `limit`:
// called with the start and length of the run that opens the span, it
// returns the end of the next run of the same length, or -1 when none
// closes it. Runs must be opened in text order. The first search that
// fails reads on to `limit` and notes where the last run of each length
// starts, as markdown-it does, so a later run that nothing closes is found
// out at once: runs of many lengths stay linear.
export function codeSpanCloser(text, limit = text.length) {
  const last = new Map();
  let scanned = false;
  return (start, length) => {
    if (scanned && !(last.get(length) > start)) {
      return -1;
    }
    let search = start + length;
    while (search < limit) {
      const next = text.indexOf("`", search);
      if (next === -1 || next >= limit) {
        break;
      }
      let end = next;
      while (text[end] === "`") {
        end += 1;
      }
      if (end - next === length) {
        return end;
      }
      // Once a search has read to the end, the runs are all noted, and a
      // later search passes only earlier ones.
      if (!scanned) {
        last.set(end - next, next);
      }
      search = end;
    }
    scanned = true;
    return -1;
  };
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
    // As in scanMarkup, a line with a backtick after its run opens no fence.
    const marker = /^ {0,3}(`{3,})(?=[^`]*$)/.exec(line);
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
  return markdownBody.slice(proseStart(markdownBody));
}

// The offset in a chapter body where its prose starts: after `## Chapter
// Text`, after the outline, or after the leading heading.
export function proseStart(markdownBody, masked = maskMarkup(markdownBody)) {
  const chapterTextMatch = sectionHeadingPattern("Chapter Text").exec(masked);
  if (chapterTextMatch) {
    return chapterTextMatch.index + chapterTextMatch[0].length;
  }

  const outlineMatch = sectionHeadingPattern("Outline").exec(masked);
  if (!outlineMatch) {
    return leadingHeadingLength(masked);
  }

  const start = outlineMatch.index + outlineMatch[0].length;
  return outlineEnd(markdownBody, masked, start).offset;
}

// Where the outline that starts at `start` (just past its heading) ends. It
// ends just past the `---` that closes it (`divider` is true), or else just
// past its last list item, heading, or indented line, so the prose starts
// after the outline when no divider follows. Only a `---` directly after the
// outline counts: the outline runs over list items, their indented or lazy
// continuation lines, headings, and blank lines, so a `---` scene break after
// the first paragraph of prose is never taken for the divider. Indentation is
// read from the body, not the masked text, since a masked comment turns into
// spaces that would look like indentation.
function outlineEnd(body, masked, start) {
  const lines = masked.slice(start).split("\n");
  const written = body.slice(start).split("\n");
  let offset = start + lines[0].length + 1;
  let previous = "blank";
  // Whether the outline is inside a list item, which a blank line does not end.
  let inItem = false;
  let last = start;
  for (let index = 1; index < lines.length; index += 1) {
    const lineStart = offset;
    offset += lines[index].length + 1;
    const text = lines[index].replace(/\r$/, "");
    const source = written[index].replace(/\r$/, "");
    if (text.trim() === "") {
      previous = "blank";
    } else if (text.trim() === "---") {
      return { divider: true, offset: lineStart + lines[index].length };
    } else if (/^\s*(?:[-*+]|\d+[.)])(?:[ \t]|$)/.test(text)) {
      previous = "item";
      inItem = true;
      last = lineStart + lines[index].length;
    } else if (inItem && /^[ \t]+\S/.test(source)) {
      // An indented paragraph under a list item is part of that item, after a
      // blank line or not. Indented prose under a heading is not.
      previous = "item";
      last = lineStart + lines[index].length;
    } else if (/^ {0,3}#{1,6}(?:[ \t]|$)/.test(text)) {
      previous = "heading";
      inItem = false;
      last = lineStart + lines[index].length;
    } else if (previous === "item") {
      // A line that runs on from a list item, with no blank line, belongs to
      // it, as in markdown. Prose under a heading with no blank line does not.
      last = lineStart + lines[index].length;
    } else {
      break;
    }
  }
  return { divider: false, offset: last };
}

// Whether a chapter body has an outline that runs into its prose: an `## Outline`
// with no `## Chapter Text` heading, no `---` divider below it, and prose after
// it. Its prose start is then read from the outline's own lines (see
// proseStart), so validate warns about it.
export function outlineRunsIntoProse(markdownBody) {
  const body = String(markdownBody).replace(/\r\n?/g, "\n");
  const masked = maskMarkup(body);
  if (sectionHeadingPattern("Chapter Text").test(masked)) {
    return false;
  }
  const outlineMatch = sectionHeadingPattern("Outline").exec(masked);
  if (!outlineMatch || outlineEnd(body, masked, outlineMatch.index + outlineMatch[0].length).divider) {
    return false;
  }
  return chapterProse(body).trim() !== "";
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
