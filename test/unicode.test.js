import { describe, expect, test } from "bun:test";
import path from "node:path";
import { languagePack } from "../src/languages/index.js";
import { checkNames, nameWords } from "../src/names.js";
import { analyzeChapter, proseRules } from "../src/prose.js";
import { checkProjectContinuity, createStoryProject, mentionsReport, voicesReport } from "../src/story.js";
import { composedText, nfc } from "../src/unicode.js";
import { wordMatcher } from "../src/words.js";
import { makeTempDir, messages, writeMarkdown } from "./helpers.js";

// The same letters in two Unicode forms: NFC writes é and が as one code
// point, NFD as a base letter and a combining mark.
const RENEE = "Ren\u00e9e";
const RENEE_NFD = "Rene\u0301e";
const KAGAMI = "か\u304cみ";
const KAGAMI_NFD = "かか\u3099み";

function project(language = "en") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Forms", dir: "forms", force: false, language });
  return root;
}

function character(root, id, name, extra = "") {
  writeMarkdown(path.join(root, "characters", `${id}.md`), `name: ${name}\nrole: supporting\nstatus: alive\n${extra}`, `# ${id}\n`);
}

function chapter(root, number, frontmatter, text) {
  writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `title: Chapter ${number}\nnumber: ${number}\nstatus: draft\n${frontmatter}`, `## Chapter Text\n\n${text}\n`);
}

describe("composedText", () => {
  test("text already in NFC is returned as it is", () => {
    const same = composedText("Ren\u00e9e");
    expect(same.text).toBe("Ren\u00e9e");
    expect(same.original(0, 5)).toEqual([0, 5]);
  });

  test("composes NFD text and maps spans back to the text as written", () => {
    const text = `Cafe\u0301 ${RENEE_NFD} ${KAGAMI_NFD}`;
    const composed = composedText(text);
    expect(composed.text).toBe(nfc(text));
    expect(composed.text).toBe(`Caf\u00e9 ${RENEE} ${KAGAMI}`);
    // "Renée" in the composed text, then in the text as written.
    const start = composed.text.indexOf(RENEE);
    expect(composed.original(start, start + RENEE.length)).toEqual([text.indexOf(RENEE_NFD), text.indexOf(RENEE_NFD) + RENEE_NFD.length]);
    const kana = composed.text.indexOf(KAGAMI);
    expect(composed.original(kana, kana + KAGAMI.length)).toEqual([text.indexOf(KAGAMI_NFD), text.length]);
    // A span ending inside a composed letter takes in the whole letter.
    expect(composed.original(0, 4)).toEqual([0, 5]);
    expect(composed.original(3, 4)).toEqual([3, 5]);
  });

  test("Hangul jamo and compatibility ideographs map back whole", () => {
    const text = "\u1100\u1161\u11a8 \u{2f800}!";
    const composed = composedText(text);
    expect(composed.text).toBe("\uac01 \u4e3d!");
    expect(composed.original(0, 1)).toEqual([0, 3]);
    expect(composed.original(2, 3)).toEqual([4, 6]);
    expect(composed.original(3, 4)).toEqual([6, 7]);
  });

  test("a run whose code points change length both ways maps code point by code point", () => {
    // U+FA6C composes to U+242EE (one unit to two) and U+2F800 to U+4E3D
    // (two units to one), so the run keeps its length overall.
    const text = "\ufa6c Ana \u{2f800}";
    const composed = composedText(text);
    expect(composed.text).toBe("\u{242ee} Ana \u4e3d");
    expect(composed.text.length).toBe(text.length);
    expect(composed.original(3, 6)).toEqual([2, 5]);
    expect(wordMatcher(text)(/Ana/gu)).toEqual([[2, 5]]);
  });

  test("wordMatcher finds an NFC pattern in NFD text, at offsets in the text as written", () => {
    const text = `Ask ${RENEE_NFD}.`;
    expect(wordMatcher(text)(new RegExp(RENEE, "gu"))).toEqual([[4, 4 + RENEE_NFD.length]]);
    // か alone is not the か of が.
    expect(wordMatcher(KAGAMI_NFD)(/か(?!\p{M})/gu)).toEqual([[0, 1]]);
  });
});

describe("names and prose in different Unicode forms", () => {
  test("story mentions finds an NFC name in NFD prose, with the column and excerpt as written", () => {
    const root = project();
    character(root, "renee", RENEE);
    chapter(root, 1, "characters:\n  - renee", `Cafe\u0301 talk: ${RENEE_NFD} waited.`);
    const report = mentionsReport(root, { kind: "character", id: "renee" });
    expect(report.matches.map(({ line, column, text, excerpt }) => [line, column, text, excerpt])).toEqual([[10, 13, RENEE_NFD, `Cafe\u0301 talk: ${RENEE_NFD} waited.`]]);
  });

  test("story mentions gives the column and excerpt of a name between compatibility ideographs", () => {
    const root = project();
    character(root, "ana", "Ana");
    chapter(root, 1, "characters:\n  - ana", "\ufa6c Ana \u{2f800} waited.");
    const report = mentionsReport(root, { kind: "character", id: "ana" });
    expect(report.matches.map(({ column, text, excerpt }) => [column, text, excerpt])).toEqual([[3, "Ana", "\ufa6c Ana \u{2f800} waited."]]);
  });

  test("an NFD name in frontmatter finds NFC prose, and continuity sees it", () => {
    const root = project();
    character(root, "renee", RENEE_NFD);
    chapter(root, 1, "", `Caf\u00e9 talk: ${RENEE} waited.`);
    const report = mentionsReport(root, { kind: "character", id: "renee" });
    expect(report.matches.map(({ column, text }) => [column, text])).toEqual([[12, RENEE]]);
    expect(messages(checkProjectContinuity(root).warnings).filter((message) => message.includes("names character renee"))).toHaveLength(1);
  });

  test("Japanese voiced kana match in either form, and a shorter name does not match inside one", () => {
    const root = project("ja");
    character(root, "kagami", KAGAMI);
    character(root, "nfd-kagami", KAGAMI_NFD.replace("み", "こ"));
    character(root, "kaka", "かか");
    chapter(root, 1, "characters:\n  - kagami\n  - nfd-kagami", `ある日、${KAGAMI_NFD}\u304c来た。${"か\u304cこ"}もいた。`);
    const nfdProse = mentionsReport(root, { kind: "character", id: "kagami" });
    expect(nfdProse.matches.map(({ column, text }) => [column, text])).toEqual([[5, KAGAMI_NFD]]);
    const nfdName = mentionsReport(root, { kind: "character", id: "nfd-kagami" });
    expect(nfdName.matches.map(({ column, text }) => [column, text])).toEqual([[13, "か\u304cこ"]]);
    expect(mentionsReport(root, { kind: "character", id: "kaka" }).matches).toEqual([]);
  });

  test("story names compares a candidate in one form with names in the other", () => {
    expect(nameWords(KAGAMI_NFD)).toEqual([KAGAMI]);
    expect(nameWords(`${RENEE_NFD} Hale`)).toEqual([RENEE, "Hale"]);
    const names = [{ kind: "character", id: "kagami", name: KAGAMI, full: KAGAMI, role: "supporting", given: true, file: "characters/kagami.md" }];
    expect(checkNames([KAGAMI_NFD], names, languagePack("ja")).results[0].status).toBe("taken");
  });

  test("watch words and avoided spellings match across forms, and names are still names", () => {
    const style = { "watch-words": [`cafe\u0301`, KAGAMI], preferred: [{ use: "naive", avoid: "na\u00efve" }] };
    const analysis = analyzeChapter(`The caf\u00e9 was nai\u0308ve. ${KAGAMI_NFD}。`, proseRules(style, []));
    expect(analysis.watch).toEqual([{ word: "cafe\u0301", count: 1 }, { word: KAGAMI, count: 1 }]);
    expect(analysis.variants.map((entry) => entry.count)).toEqual([1]);
    // A capitalised avoided spelling that is part of a name in the other
    // form is not counted.
    const named = analyzeChapter(`Na\u00efve Hale met the nai\u0308ve one.`, proseRules({ preferred: [{ use: "naive", avoid: "na\u00efve" }] }, ["Nai\u0308ve Hale"]));
    expect(named.variants.map((entry) => entry.count)).toEqual([1]);
  });

  test("voices attribute an NFD name and find voice phrases in either form", () => {
    const root = project();
    character(root, "renee", RENEE, `voice-avoid:\n  - cafe\u0301`);
    chapter(root, 1, "", [`"I want a caf\u00e9," ${RENEE_NFD} said.`, `"Again," ${RENEE_NFD} said.`].join("\n\n"));
    const report = voicesReport(root);
    expect(report.profiles.map((entry) => [entry.id, entry.lines])).toEqual([["renee", 2]]);
    expect(messages(report.warnings)).toContain(`renee says "cafe\u0301", which is in their voice-avoid list (chapter-01)`);
  });
});
