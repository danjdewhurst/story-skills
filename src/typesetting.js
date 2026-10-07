import { err } from "./findings.js";
import { chineseScript, hanScript, languagePack, parseTag, projectLanguage } from "./languages/index.js";
import { textDirection } from "./publishing.js";

// How a book is set for its language's script: the fonts the HTML, print,
// EPUB, and DOCX builds name, whether the script has capitals to set in
// small caps or raise as an initial, its direction, and vertical layout for
// story.md `writing-mode: vertical`. A Latin-script book keeps the fonts and
// layout the builds have always used.

export const WRITING_MODES = new Set(["horizontal", "vertical"]);

// Scripts with upper and lower case.
const CASED_SCRIPTS = new Set(["Latn", "Cyrl", "Grek", "Armn", "Copt", "Glag", "Adlm", "Osge", "Dsrt"]);

// Scripts set top to bottom in columns running right to left. Traditional
// Mongolian runs its columns left to right (vertical-lr), which the builds
// do not set yet.
export const VERTICAL_SCRIPTS = new Set(["Jpan", "Hani", "Hans", "Hant", "Hira", "Kana", "Bopo", "Kore", "Hang"]);

// Scripts Word treats as East Asian (the eastAsia font and language) and as
// complex (the cs font, the bidi language, and bCs/iCs for bold and italic).
const EAST_ASIAN_SCRIPTS = new Set(["Jpan", "Hani", "Hans", "Hant", "Hira", "Kana", "Bopo", "Kore", "Hang"]);
const COMPLEX_SCRIPTS = new Set(["Arab", "Hebr", "Syrc", "Thaa", "Nkoo", "Deva", "Beng", "Guru", "Gujr", "Orya", "Taml", "Telu", "Knda", "Mlym", "Sinh", "Thai", "Laoo", "Khmr", "Mymr", "Tibt"]);

// The script of a common language that has no pack of its own yet (the
// language's own pack's `script` wins), so a Russian or Persian book still
// gets fonts for its script. Chinese languages are not listed: hanScript
// in ./languages/index.js picks Simplified or Traditional for them.
export const LIKELY_SCRIPTS = {
  Cyrl: ["ru", "uk", "be", "bg", "mk", "sr", "kk", "ky", "mn", "tg", "tt", "ba", "cv", "os"],
  Grek: ["el"],
  Armn: ["hy"],
  Geor: ["ka"],
  Arab: ["fa", "ur", "ps", "sd", "ug", "ckb", "ks"],
  Hebr: ["yi"],
  Deva: ["mr", "ne", "sa", "kok", "mai", "bho"],
  Beng: ["bn", "as"],
  Guru: ["pa"],
  Gujr: ["gu"],
  Orya: ["or"],
  Taml: ["ta"],
  Telu: ["te"],
  Knda: ["kn"],
  Mlym: ["ml"],
  Sinh: ["si"],
  Laoo: ["lo"],
  Khmr: ["km"],
  Mymr: ["my"],
  Tibt: ["bo", "dz"],
  Ethi: ["am", "ti"],
  Thaa: ["dv"],
  Syrc: ["syr"],
  Cher: ["chr"]
};
const SCRIPT_OF = new Map(Object.entries(LIKELY_SCRIPTS).flatMap(([script, codes]) => codes.map((code) => [code, script])));

const LATIN_SERIF = `Georgia, "Iowan Old Style", "Palatino Linotype", serif`;

// CSS font stacks by script: fonts that ship with macOS, iOS, Windows, or
// Android, then Noto, then the generic family. A script not listed here
// uses the Latin stack, and the browser falls back glyph by glyph.
const FONT_STACKS = {
  Cyrl: `Georgia, "Palatino Linotype", "Times New Roman", "Noto Serif", "DejaVu Serif", serif`,
  Jpan: `"Hiragino Mincho ProN", "Yu Mincho", YuMincho, "MS Mincho", "Noto Serif JP", "Noto Serif CJK JP", serif`,
  Hans: `"Songti SC", STSong, SimSun, "Noto Serif SC", "Noto Serif CJK SC", serif`,
  Hant: `"Songti TC", PMingLiU, MingLiU, "Noto Serif TC", "Noto Serif CJK TC", serif`,
  Kore: `AppleMyungjo, Batang, "Nanum Myeongjo", "Noto Serif KR", "Noto Serif CJK KR", serif`,
  Arab: `"Noto Naskh Arabic", "Geeza Pro", "Times New Roman", "Traditional Arabic", serif`,
  Hebr: `"Noto Serif Hebrew", "Times New Roman", David, "Arial Hebrew", serif`,
  Deva: `"Noto Serif Devanagari", "Kohinoor Devanagari", "Devanagari Sangam MN", Mangal, "Nirmala UI", serif`,
  Thai: `"Noto Serif Thai", Thonburi, "Leelawadee UI", Tahoma, serif`,
  Cher: `"Plantagenet Cherokee", Gadugi, "Noto Sans Cherokee", serif`
};
FONT_STACKS.Grek = FONT_STACKS.Cyrl;

// DOCX fonts for the East Asian and complex-script slots, by script: fonts
// Word installs on Windows and macOS. Every other slot is Times New Roman.
const DOCX_EAST_ASIA = { Jpan: "MS Mincho", Hans: "SimSun", Hant: "PMingLiU", Kore: "Batang" };
const DOCX_COMPLEX = { Deva: "Mangal", Thai: "Tahoma" };

// The tag in its usual case (zh-Hant-TW, en-GB), read as the language
// packs read it (parseTag: aliases such as iw and jpn resolved, an extlang
// tag such as zh-yue as yue, a grandfathered tag in its modern form), for
// Word's language settings. "und" when the tag names no language.
export function writtenTag(language) {
  const { script, region, subtags } = parseTag(language);
  const at = script === null ? 1 : 2;
  return subtags.map((subtag, index) => {
    if (index === 1 && script !== null) {
      return script;
    }
    return index === at && region !== null ? subtag.toUpperCase() : subtag;
  }).join("-");
}

// The ISO 15924 script a book in `language` is written in: the tag's script
// subtag (sr-Latn, zh-Hant), else for Chinese the one its pack is chosen
// by (chineseScript: zh-TW and yue are Traditional), else the language's
// own pack's, else the table above, else a macrolanguage pack's, else
// Latin. Tags resolve as the packs resolve them, the same on every runtime.
export function languageScript(language) {
  const { primary, script } = parseTag(language);
  if (script !== null) {
    return script;
  }
  const chinese = chineseScript(language);
  if (chinese !== null) {
    return chinese;
  }
  const pack = languagePack(language);
  const own = pack.code.split("-")[0] === primary ? pack.script : null;
  return own ?? SCRIPT_OF.get(primary) ?? pack.script ?? "Latn";
}

// The script whose fonts set the book: Japanese kana and Han in a Japanese
// book use Japanese fonts, Hangul uses Korean ones, and Han alone uses the
// Chinese fonts for the language's script.
function fontScript(script, language) {
  if (script === "Hira" || script === "Kana") {
    return "Jpan";
  }
  if (script === "Hang") {
    return "Kore";
  }
  if (script === "Bopo") {
    return "Hant";
  }
  if (script === "Hani") {
    const { primary } = parseTag(language);
    if (primary === "ja" || primary === "ko") {
      return primary === "ja" ? "Jpan" : "Kore";
    }
    return hanScript(language);
  }
  return script;
}

// Whether `language` can be set vertically. scripts/schema-patterns.js
// generates the schema's language pattern for writing-mode: vertical from
// this and the tables it reads, and test/schema.test.js keeps them in step.
export function supportsVertical(language) {
  return VERTICAL_SCRIPTS.has(languageScript(language));
}

const SETTINGS = new Map();

// The typesetting for a book in `language` with story.md `writing-mode`:
// { script, cased, rtl, vertical, fonts: { body, heads, latin }, docx }.
// `vertical` holds only where the script can be set vertically; validate
// reports the rest. `cased` follows the pack's `cased`, except that a script subtag
// decides it (ja-Latn is cased, sr-Cyrl is too). `fonts.heads` sets running
// heads and folios, and `fonts.latin` says the stacks are the Latin ones
// the builds have always used. `docx` names the eastAsia and cs fonts (null keeps
// Times New Roman) and whether runs need East Asian or complex-script
// language and formatting.
export function typesetting(language = "en", writingMode = "horizontal") {
  const key = `${language}\u0000${writingMode}`;
  if (!SETTINGS.has(key)) {
    const script = languageScript(language);
    const explicit = parseTag(language).script !== null;
    const fonts = fontScript(script, language);
    const body = FONT_STACKS[fonts] ?? LATIN_SERIF;
    SETTINGS.set(key, Object.freeze({
      script,
      cased: CASED_SCRIPTS.has(script) && (explicit || languagePack(language).cased),
      rtl: textDirection(language) === "rtl",
      vertical: writingMode === "vertical" && VERTICAL_SCRIPTS.has(script),
      fonts: Object.freeze({ body, heads: body === LATIN_SERIF ? "Georgia, serif" : body, latin: body === LATIN_SERIF }),
      docx: Object.freeze({
        eastAsia: DOCX_EAST_ASIA[fonts] ?? null,
        cs: DOCX_COMPLEX[fonts] ?? null,
        eastAsian: EAST_ASIAN_SCRIPTS.has(script),
        complex: COMPLEX_SCRIPTS.has(script)
      })
    }));
  }
  return SETTINGS.get(key);
}

// story.md `writing-mode: vertical` for a language whose script is not set
// vertically. The value itself is checked against WRITING_MODES elsewhere.
export function validateWritingMode(data, errors) {
  if (data["writing-mode"] !== "vertical") {
    return;
  }
  const language = projectLanguage(data);
  if (languageScript(language) === "Mong") {
    errors.push(err("unsupported-writing-mode", `story.md writing-mode vertical is not supported yet for ${language}: traditional Mongolian runs its columns left to right (vertical-lr), so builds ignore it`, "story.md"));
  } else if (!supportsVertical(language)) {
    errors.push(err("unsupported-writing-mode", `story.md writing-mode vertical needs a language set in vertical columns, such as ja, zh, zh-Hant, or ko; ${language} is set horizontally, so builds ignore it`, "story.md"));
  }
}
