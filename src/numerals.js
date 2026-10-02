import { err } from "./findings.js";
import { hanScript, parseTag, projectLanguage } from "./languages/index.js";
import { languageScript } from "./typesetting.js";

// Numerals for the chapter numbers builds print, from story.md
// `chapter-numerals`: `western` (0-9, the default) or `native`, the
// numerals of the language's own script: Han numerals in Japanese and
// Chinese (第十二章), the script's digits elsewhere (الفصل ١٢, अध्याय १२).
// Every table is written out here, never taken from Intl, so a book builds
// the same bytes on every runtime. Only the printed number changes: ids,
// file names, and anchors keep 0-9.

export const CHAPTER_NUMERALS = new Set(["western", "native"]);

// The code point of zero in each script's decimal digits, by the CLDR
// numbering system name. Each block runs 0 to 9 in order.
const DIGIT_ZEROS = {
  arab: 0x0660, // Arabic-Indic: ٠١٢٣٤٥٦٧٨٩
  arabext: 0x06f0, // Extended Arabic-Indic (Persian, Urdu): ۰۱۲۳۴۵۶۷۸۹
  nkoo: 0x07c0,
  deva: 0x0966,
  beng: 0x09e6,
  guru: 0x0a66,
  gujr: 0x0ae6,
  orya: 0x0b66,
  tamldec: 0x0be6,
  telu: 0x0c66,
  knda: 0x0ce6,
  mlym: 0x0d66,
  thai: 0x0e50,
  laoo: 0x0ed0,
  tibt: 0x0f20,
  mymr: 0x1040,
  khmr: 0x17e0,
  mong: 0x1810,
  mtei: 0xabf0
};

// The digits a script's books print, by ISO 15924 script.
const SCRIPT_DIGITS = {
  Arab: "arab", Nkoo: "nkoo", Deva: "deva", Beng: "beng", Guru: "guru", Gujr: "gujr", Orya: "orya",
  Taml: "tamldec", Telu: "telu", Knda: "knda", Mlym: "mlym", Thai: "thai", Laoo: "laoo", Tibt: "tibt",
  Mymr: "mymr", Khmr: "khmr", Mong: "mong", Mtei: "mtei"
};

// The script a tag without a script subtag is written in, where the
// typesetting table (languageScript) has none of its own: N'Ko, Manipuri
// in Bengali script, Dari, and Azerbaijani in Iran and Uzbek in
// Afghanistan, which are written in Arabic script there. Keyed by language
// and region, then language.
const NUMERAL_SCRIPTS = { nqo: "Nkoo", mni: "Beng", prs: "Arab", "az-ir": "Arab", "uz-af": "Arab" };

// Languages in Arabic script that write the Persian forms of 4, 5, and 6
// (۴ ۵ ۶), as CLDR has them: Persian and Dari, Urdu, Pashto, Kashmiri,
// Punjabi in Shahmukhi, and Azerbaijani and Uzbek in Arabic script.
const EXTENDED_ARABIC = new Set(["fa", "prs", "ur", "ps", "ks", "pa", "az", "uz"]);

// Han numerals: Japanese (jpan), Simplified Chinese (hans), and
// Traditional Chinese (hant), by the script's characters.
const HAN_DIGITS = "〇一二三四五六七八九";
const HAN_UNITS = ["", "十", "百", "千"];
// Units for each group of four digits, up to 兆 (10^12), which covers every
// safe integer. Simplified Chinese has no settled unit for 10^12, so it
// writes 万亿, or 万 before a 亿 group of its own (一万二千亿).
const HAN_GROUPS = { jpan: ["", "万", "億", "兆"], hans: ["", "万", "亿", "万亿"], hant: ["", "萬", "億", "兆"] };

// The native numeral system for `language` (a CLDR name such as arab, deva,
// or jpan), or null when its script has none the builds print: Latin,
// Cyrillic, Hebrew, Korean, and the rest keep 0-9.
export function nativeNumerals(language) {
  const { primary, script: subtag, region } = parseTag(language);
  const script = subtag ?? NUMERAL_SCRIPTS[`${primary}-${region}`] ?? NUMERAL_SCRIPTS[primary] ?? languageScript(language);
  if (script === "Jpan" || script === "Hira" || script === "Kana" || (script === "Hani" && primary === "ja")) {
    return "jpan";
  }
  if (script === "Hans" || script === "Hant") {
    return script.toLowerCase();
  }
  // Han alone (zh-Hani, yue-Hani) takes the Chinese characters the tag is
  // written in; Korean hanja numbering is not supported.
  if ((script === "Hani" && primary !== "ko") || script === "Bopo") {
    return hanScript(language).toLowerCase();
  }
  if (script === "Arab" && EXTENDED_ARABIC.has(primary)) {
    return "arabext";
  }
  return SCRIPT_DIGITS[script] ?? null;
}

// The numeral system a book's chapter numbers print in: its native one
// when story.md sets `chapter-numerals: native` and the language has one,
// else latn. validateChapterNumerals reports a setting builds ignore.
export function chapterNumerals(data) {
  return data?.["chapter-numerals"] === "native" ? nativeNumerals(projectLanguage(data)) ?? "latn" : "latn";
}

// A whole number in a numeral system: latn and unknown systems give 0-9,
// a digit system swaps each digit, and a Han system writes the number out.
// No grouping separators, so 1200 is ١٢٠٠ and 一千二百 / 千二百.
export function formatNumeral(value, system = "latn") {
  const text = String(value);
  if (DIGIT_ZEROS[system] !== undefined && /^\d+$/.test(text)) {
    return text.replace(/\d/g, (digit) => String.fromCodePoint(DIGIT_ZEROS[system] + Number(digit)));
  }
  if (HAN_GROUPS[system] !== undefined && Number.isSafeInteger(value) && value >= 0) {
    return hanNumeral(value, system);
  }
  return text;
}

// A safe integer in Han numerals, in groups of four digits (万, 億, 兆).
// Japanese drops 一 before 十, 百, and 千 (百一, 千十) and writes no zero
// within a number. Chinese drops 一 only before a leading 十 (十二, but
// 一百一十), writes one 零 for each run of zeros between digits (一百零一,
// 一千零一十), and one before a group under a thousand that follows a
// higher one (一万零五十).
function hanNumeral(value, system) {
  const chinese = system !== "jpan";
  if (value === 0) {
    return chinese ? "零" : HAN_DIGITS[0];
  }
  const groups = [];
  for (let rest = value; rest > 0; rest = Math.floor(rest / 10000)) {
    groups.push(rest % 10000);
  }
  let text = "";
  let gap = false;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group === 0) {
      gap = text !== "";
      continue;
    }
    if (chinese && text !== "" && (gap || group < 1000)) {
      text += "零";
    }
    const unit = system === "hans" && index === 3 && groups[2] !== 0 ? "万" : HAN_GROUPS[system][index];
    text += hanGroup(group, chinese, text === "") + unit;
    gap = false;
  }
  return text;
}

// One group of up to four digits. `leading` says nothing comes before it,
// so a Chinese 十 there drops its 一.
function hanGroup(group, chinese, leading) {
  const digits = String(group).padStart(4, "0").split("").map(Number);
  let text = "";
  let zero = false;
  digits.forEach((digit, position) => {
    const unit = HAN_UNITS[3 - position];
    if (digit === 0) {
      zero = text !== "";
      return;
    }
    if (chinese && zero) {
      text += "零";
    }
    zero = false;
    const one = digit === 1 && unit !== "" && (!chinese || (unit === "十" && leading && text === ""));
    text += `${one ? "" : HAN_DIGITS[digit]}${unit}`;
  });
  return text;
}

// story.md `chapter-numerals: native` for a language with no native
// numerals. The value itself is checked against CHAPTER_NUMERALS elsewhere.
export function validateChapterNumerals(data, errors) {
  if (data["chapter-numerals"] !== "native") {
    return;
  }
  const language = projectLanguage(data);
  if (nativeNumerals(language) === null) {
    errors.push(err("unsupported-chapter-numerals", `story.md chapter-numerals native needs a language with its own numerals, such as ja, zh, ar, fa, hi, or th; ${language} prints 0-9, so builds ignore it`, "story.md"));
  }
}
