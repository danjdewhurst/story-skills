import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { LABEL_KEYS, languagePack } from "../src/languages/index.js";
import { buildBook, createStoryProject } from "../src/story.js";
import { makeTempDir, writeMarkdown } from "./helpers.js";

// The languages with translated labels, and Traditional Chinese.
const TRANSLATED = ["es", "fr", "de", "it", "pt", "pt-PT", "nl", "sv", "pl", "ru", "uk", "tr", "ar", "he", "fa", "hi", "ja", "zh", "ko", "zh-Hant"];

const CODEX_KEYS = LABEL_KEYS.filter((key) => key.startsWith("codex-"));

// Codex labels a language spells as English does, because that is the
// language's own word (French Notes, German Status) or symbol (h for hours).
const SAME_AS_ENGLISH = {
  es: ["codex-hours"],
  fr: ["codex-factions", "codex-arcs", "codex-faction", "codex-arc", "codex-questions", "codex-notes", "codex-type", "codex-date", "codex-question"],
  de: ["codex-system", "codex-status", "codex-region", "codex-hook"],
  it: ["codex-hours"],
  pt: ["codex-hours"],
  "pt-PT": ["codex-hours"],
  nl: ["codex-status", "codex-routes", "codex-hook"],
  sv: ["codex-system", "codex-status", "codex-region"],
  pl: ["codex-system", "codex-status", "codex-region"]
};

// Frontmatter values the codex shows as written: statuses and other ids.
const DATA_WORDS = new Set(["draft", "alive", "deceased", "hidden", "resolved", "open", "planted", "revealed", "paid-off", "main"]);

// A story that reaches every codex label a spoiler build can show: every
// kind of entity, dated, undated, out-of-order, and flashback scenes, a
// route, a progression, knowledge, a red herring, an arc with no file, a
// target and deadline, a session log, an untitled chapter, a death, a
// chapter beat, and a chapter with no point of view. Names and values are invented
// words, so any English on a page is a label.
function project(language) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Lumo", force: false });
  const storyPath = path.join(root, "story.md");
  const story = fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", `schema-version: 2\nlanguage: ${language}\nauthor: Ada Kiro\ntarget-words: 900\ndeadline: 2030-01-01\n`);
  fs.writeFileSync(storyPath, story, "utf8");
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: Kai\nnumber: 1\nstatus: draft\npov: mara\ncharacters: [mara, tobo]\nlocations: [vela]\narcs-advanced: [suno, zuzu]\nhook: rapa\nbeat: Kuro\ntarget-words: 100", "## Chapter Text\n\nMara Tobo.\n");
  writeMarkdown(path.join(root, "chapters", "chapter-02.md"), "title: \"\"\nnumber: 2\nstatus: draft\npov: mara\ncharacters: [mara, kalo]", "## Chapter Text\n\nMara.\n");
  writeMarkdown(path.join(root, "chapters", "chapter-03.md"), "title: Ulo\nnumber: 3\nstatus: draft\ncharacters: [mara]", "## Chapter Text\n\nMara.\n");
  writeMarkdown(path.join(root, "scenes", "chapter-01-scene-01.md"), "title: Nemo\nchapter: chapter-01\nscene: 1\npov: mara\nlocation: vela\ndate: 2020-05-02\noutcome: lipo", "\n# Nemo\n");
  writeMarkdown(path.join(root, "scenes", "chapter-02-scene-01.md"), "title: Oru\nchapter: chapter-02\nscene: 1\npov: mara\nlocation: vela\ndate: 2020-05-01\nflashback-to: 2019-01-01", "\n# Oru\n");
  writeMarkdown(path.join(root, "scenes", "chapter-02-scene-02.md"), "title: Pexa\nchapter: chapter-02\nscene: 2\nlocation: vela", "\n# Pexa\n");
  writeMarkdown(path.join(root, "characters", "mara.md"), "name: Mara\nrole: kilo\nstatus: alive\naliases: [Mari]\npronunciation: MA-ra\nrelationships:\n  - character: tobo\n    type: soro\nlocations: [vela]", "\n# Mara\n\nLoru.\n");
  writeMarkdown(path.join(root, "characters", "tobo.md"), "name: Tobo\nrole: nilo\nstatus: deceased\narc: zeta\ndied-in: chapter-01\nrevived-in: chapter-02\nprogressions:\n  - from: chapter-02\n    field: rango\n    value: fanto", "\n# Tobo\n");
  writeMarkdown(path.join(root, "characters", "kalo.md"), "name: Kalo\nrole: nilo\nstatus: deceased\ndied-in: chapter-02", "\n# Kalo\n");
  writeMarkdown(path.join(root, "worldbuilding", "locations", "vela.md"), "name: Vela\ntype: turo\nregion: sudo\nsetting: muro\nnotable-characters: [mara]\nroutes:\n  - to: pira\n    hours: 2\n    mode: barko", "\n# Vela\n");
  writeMarkdown(path.join(root, "worldbuilding", "locations", "pira.md"), "name: Pira\ntype: turo", "\n# Pira\n");
  writeMarkdown(path.join(root, "worldbuilding", "factions", "rondo.md"), "name: Rondo\ntype: gildo\nstatus: hidden\nmembers: [mara]\nlocations: [vela]", "\n# Rondo\n");
  writeMarkdown(path.join(root, "worldbuilding", "artifacts", "klavo.md"), "name: Klavo\ntype: objo\nstatus: hidden\nowner: tobo\nlocation: vela", "\n# Klavo\n");
  writeMarkdown(path.join(root, "worldbuilding", "systems", "lego.md"), "name: Lego\ntype: juro", "\n# Lego\n");
  writeMarkdown(path.join(root, "plot", "arcs", "suno.md"), "name: Suno\ntype: main\nstatus: resolved\nthemes: [lumo]\ncharacters: [mara]", "\n# Suno\n");
  writeMarkdown(path.join(root, "continuity", "clues", "boto.md"), "title: Boto\nstatus: planted\nplanted: chapter-01\nred-herring: true\nsignificance-delayed: true\ncharacters: [mara]", "\n# Boto\n");
  writeMarkdown(path.join(root, "continuity", "questions", "kiu.md"), "title: Kiu?\nstatus: resolved\nintroduced: chapter-01\nresolved: chapter-02\ncharacters: [mara]", "\n# Kiu?\n");
  writeMarkdown(path.join(root, "continuity", "promises", "fajro.md"), "title: Fajro\nstatus: planted\nplanted: chapter-01\narcs: [suno]\ncharacters: [mara]", "\n# Fajro\n");
  fs.writeFileSync(path.join(root, "continuity", "state.md"), "---\ntype: continuity-state\nknowledge-state:\n  - character: mara\n    knows: sekreto\n    learned-in: chapter-01\n  - character: mara\n    knows: nomo\n---\n\n# Continuity State\n", "utf8");
  fs.writeFileSync(path.join(root, "progress.md"), "---\ntype: progress-log\nsessions:\n  - date: 2020-05-01\n    words: 10\n---\n\n# Progress Log\n", "utf8");
  return root;
}

// Every page's text, with tags and their attributes as text too, so a
// title, an aria-label, and an alt all count.
function siteText(root, options = {}) {
  const folder = buildBook(root, { format: "codex", spoilers: true, ...options }).outFile;
  const pages = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const html = fs.readFileSync(full, "utf8").replace(/<style>[\s\S]*?<\/style>/, "").replace(/<code>[\s\S]*?<\/code>/g, " ");
        pages.push(html.replace(/<[^>]*?(?:(?:aria-label|title)="([^"]*)")?[^>]*>/g, " $1 ").replace(/&amp;/g, "&"));
      }
    }
  };
  walk(folder);
  return pages.join("\n");
}

// The English words of a label: its text between placeholders, trimmed of
// punctuation, of two or more letters.
function fragments(text) {
  return String(text).split(/\{[a-z]+\}/).map((part) => part.replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "")).filter((part) => /\p{L}{2}/u.test(part) && !DATA_WORDS.has(part));
}

// The text of every codex a language shows: the fixture with and without
// spoilers, and an empty book counted in characters.
function everySite(tag) {
  const root = project(tag);
  const full = siteText(root);
  fs.rmSync(path.join(root, "dist"), { recursive: true });
  const safe = siteText(root, { spoilers: false });
  const empty = createStoryProject({ cwd: makeTempDir(), title: "Lumo", force: false }).root;
  const story = path.join(empty, "story.md");
  fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace("schema-version: 2\n", `schema-version: 2\nlanguage: ${tag}\ncount-unit: characters\ntarget-characters: 900\n`), "utf8");
  return [full, safe, siteText(empty)];
}

const word = (fragment) => new RegExp(`(?<![\\p{L}\\p{N}-])${fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}-])`, "u");

describe("codex labels", () => {
  test("every translated pack translates every codex label", () => {
    const english = languagePack("en").labels;
    expect(CODEX_KEYS.length).toBeGreaterThan(90);
    for (const tag of TRANSLATED) {
      const labels = languagePack(tag).labels;
      const same = CODEX_KEYS.filter((key) => labels[key] === english[key]);
      expect({ tag, same }).toEqual({ tag, same: SAME_AS_ENGLISH[tag] ?? [] });
    }
  });

  test("the English codex shows every codex label", () => {
    const text = siteText(project("en"));
    // A spoiler build of the fixture reaches every label but the ones for
    // an empty book, a book counted in characters, a spoiler-safe build,
    // and a book with more than one red herring.
    const elsewhere = ["codex-no-entities", "codex-no-dates", "codex-none", "codex-total-characters", "codex-target-characters", "codex-character-count", "codex-note-safe", "codex-threads-note", "codex-clue-totals"];
    const missing = CODEX_KEYS.filter((key) => !elsewhere.includes(key)).filter((key) => !fragments(languagePack("en").labels[key]).every((fragment) => word(fragment).test(text)));
    expect(missing).toEqual([]);
  });

  for (const tag of TRANSLATED) {
    test(`a codex in ${tag} keeps no English label`, () => {
      const labels = languagePack(tag).labels;
      const own = CODEX_KEYS.map((key) => labels[key]).join("\n");
      const english = new Set(CODEX_KEYS.flatMap((key) => fragments(languagePack("en").labels[key])));
      // A word the language's own labels use (French Notes) is its own.
      const check = [...english].filter((fragment) => !word(fragment).test(own));
      const sites = everySite(tag);
      // Each English word left, with the text around it.
      const left = check.flatMap((fragment) => sites.map((text) => word(fragment).exec(text)).filter(Boolean).slice(0, 1).map((match) => match.input.slice(Math.max(0, match.index - 30), match.index + 30)));
      expect({ tag, left }).toEqual({ tag, left: [] });
    });
  }

  test("story.md labels reword the codex", () => {
    const root = project("de");
    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace("language: de\n", "language: de\nlabels:\n  - codex-story-bible: Weltenbuch\n  - codex-index-title: \"{title} – Weltenbuch\"\n  - codex-characters: Figuren\n"), "utf8");
    const folder = buildBook(root, { format: "codex" }).outFile;
    const index = fs.readFileSync(path.join(folder, "index.html"), "utf8");
    expect(index).toContain("<title>Lumo – Weltenbuch</title>");
    expect(index).toContain('<nav aria-label="Weltenbuch"><a href="index.html" aria-current="page">Weltenbuch</a>');
    expect(index).toContain('<section id="characters"><h2>Figuren <span class="count">3</span></h2>');
    // The rest stay German.
    expect(index).toContain('<a href="timeline.html">Zeitleiste</a>');
  });

  // #539: an Arabic or Hebrew verb or participle takes its subject's gender,
  // as a Hindi noun for a person does, so the codex says what it knows about
  // a character with nouns for the action and the passive, which read the
  // same for any character. These are the masculine forms the packs used
  // before, and the forms that replaced them.
  const GENDERED = {
    ar: {
      masculine: ["يظهر في", "مذكور في", "يعرف", "يموت", "يعود إلى الحياة", "المالك", "أضف", "ابنِ"],
      neutral: ["مواضع الظهور", "مواضع الذكر", "ما تعرفه الشخصية", "الوفاة في", "العودة إلى الحياة في", "في حوزة", "يُحدَّد موقع المشهد", "ويُبنى المرجع كاملًا"]
    },
    he: {
      masculine: ["מופיע", "מקושר", "יודע", "מת", "קם לתחייה", "מתקדם"],
      neutral: ["הופעות", "אזכורים", "ידע", "מוות", "חזרה לחיים", "מתקדמת ב־"]
    },
    hi: { masculine: ["स्वामी"], neutral: ["स्वामित्व"] }
  };
  for (const [tag, { masculine, neutral }] of Object.entries(GENDERED)) {
    test(`a codex in ${tag} says nothing about a character in the masculine`, () => {
      const text = everySite(tag).join("\n");
      expect({ tag, masculine: masculine.filter((form) => word(form).test(text)) }).toEqual({ tag, masculine: [] });
      expect({ tag, missing: neutral.filter((form) => !text.includes(form)) }).toEqual({ tag, missing: [] });
    });
  }

  test("the Arabic example's heroine gets the neutral headings", () => {
    const root = makeTempDir();
    fs.cpSync(path.join(import.meta.dir, "..", "examples", "laysat-lil-bay"), root, { recursive: true });
    const folder = buildBook(root, { format: "codex", spoilers: true }).outFile;
    const page = fs.readFileSync(path.join(folder, "characters", "salma-haddad.html"), "utf8");
    for (const heading of ["مواضع الظهور", "مواضع الذكر", "ما تعرفه الشخصية"]) {
      expect(page).toContain(`<h2>${heading}</h2>`);
    }
    expect(page).not.toMatch(/<h2>(?:يظهر في|مذكور في|يعرف)<\/h2>/);
  });

  // The death column's cell names the chapter and never repeats the
  // column's heading word (Turkish bölümde only contains ölüm).
  test("the death column does not repeat its heading", () => {
    const repeats = TRANSLATED.filter((tag) => {
      const { labels, segmentation } = languagePack(tag);
      const [heading, cell] = [labels["codex-death"], labels["codex-dies-in-chapter"]];
      return segmentation === "space" ? new RegExp(word(heading).source, "iu").test(cell) : cell.includes(heading);
    });
    expect(repeats).toEqual([]);
  });

  // The other labels #539 changed: the note under an empty Questions,
  // Promises, or Clues list agrees with all three (feminine in Spanish and
  // Portuguese, a noun of its own where the lists' genders differ), the
  // Russian POV column names the character, and Arabic calls the codex a
  // reference (دليل is also evidence).
  test("the reviewed labels keep their reviewed wording", () => {
    const reviewed = (entries) => entries.map(([tag, key]) => [tag, key, languagePack(tag).labels[key]]);
    const expected = [
      ["es", "codex-none", "Ninguna."], ["pt", "codex-none", "Nenhuma."], ["pt-PT", "codex-none", "Nenhuma."],
      ["fr", "codex-none", "Aucun élément."], ["it", "codex-none", "Nessun elemento."], ["fa", "codex-none", "موردی نیست."],
      ["ru", "codex-pov", "Фокальный персонаж"],
      ["ar", "codex-story-bible", "مرجع القصة"], ["ar", "codex-index-title", "{title}: مرجع القصة"]
    ];
    expect(reviewed(expected)).toEqual(expected);
    expect(languagePack("ar").labels["codex-note-spoilers"]).toStartWith("مرجع القصة");
  });

  test("an untitled chapter takes the book's chapter label", () => {
    const folder = buildBook(project("de"), { format: "codex" }).outFile;
    expect(fs.readFileSync(path.join(folder, "progress.html"), "utf8")).toContain("<tr><td>Kapitel 2</td>");
  });
});
