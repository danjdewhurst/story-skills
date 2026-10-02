import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fountainScript } from "../src/fountain.js";
import { extractNameCandidates } from "../src/import.js";
import { languagePack } from "../src/languages/index.js";
import { compareText, formatNumber, lowerCase, matchingCase, matchingText, upperCase } from "../src/languages/locale.js";
import { shunnWordCount } from "../src/packaging.js";
import { analyzeChapter, proseRules } from "../src/prose.js";
import { buildSeries } from "../src/series.js";
import { buildTimeline } from "../src/timeline.js";
import { buildBook, createStoryProject, scanProject, validateProject } from "../src/story.js";
import { makeTempDir, writeMarkdown } from "./helpers.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sorted = (words, tag) => [...words].sort(compareText(languagePack(tag)));

// The English pack with another language's collation and casing, for the
// checks whose word lists only English has so far.
function englishWordsIn(locale) {
  return { ...languagePack("en"), locale };
}

function project(language, title = "Locale Test") {
  const { root } = createStoryProject({ cwd: makeTempDir(), title, language, force: false });
  return root;
}

describe("locale-aware text", () => {
  test("orders display text by the language's collation", () => {
    const words = ["Zucker", "Äpfel", "Apfel", "Öl", "Ofen"];
    // German files Ä and Ö with A and O; Swedish puts them after Z.
    expect(sorted(words, "de")).toEqual(["Apfel", "Äpfel", "Ofen", "Öl", "Zucker"]);
    expect(sorted(words, "sv")).toEqual(["Apfel", "Ofen", "Zucker", "Äpfel", "Öl"]);
    // Turkish has ç after c, and dotless ı before dotted i.
    const turkish = ["çay", "cuma", "ilaç", "ılık", "dağ"];
    expect(sorted(turkish, "tr")).toEqual(["cuma", "çay", "dağ", "ılık", "ilaç"]);
    expect(sorted(turkish, "en")).toEqual(["çay", "cuma", "dağ", "ilaç", "ılık"]);
  });

  test("breaks ties the collator cannot by code point, whatever the input order", () => {
    const composed = "café";
    const decomposed = "café";
    expect(compareText(languagePack("en"))(composed, decomposed)).not.toBe(0);
    expect(sorted([composed, decomposed], "fr")).toEqual(sorted([decomposed, composed], "fr"));
  });

  test("upper- and lower-cases in the language", () => {
    expect(upperCase("istanbul", languagePack("tr"))).toBe("İSTANBUL");
    expect(lowerCase("IŞIK İZMİR", languagePack("tr"))).toBe("ışık izmir");
    expect(upperCase("istanbul", languagePack("en"))).toBe("ISTANBUL");
    expect(upperCase("straße", languagePack("de"))).toBe("STRASSE");
  });

  test("prepares Turkish and Azerbaijani text for matching and maps spans back to the text as written", () => {
    const same = matchingText("IŞIK İnce", languagePack("tr"));
    expect(same.text).toBe("ışık ince");
    expect(same.original(5, 9)).toEqual([5, 9]);
    expect(matchingCase("İNCE", languagePack("az-Latn-AZ"))).toBe("ince");
    // Turkish drops a dot written after I, one shorter.
    const turkish = matchingText("Bir I\u0307nce yol, I\u0130\u0307 I\u0323\u0307", languagePack("tr"));
    expect(turkish.text).toBe("bir ince yol, \u0131i\u0307 i\u0323");
    expect(turkish.original(4, 8)).toEqual([4, 9]);
    expect(turkish.original(9, 12)).toEqual([10, 13]);
    expect(turkish.original(4, 5)).toEqual([4, 6]);
    expect(turkish.original(5, 6)).toEqual([6, 7]);
    expect(turkish.original(14, 17)).toEqual([15, 18]);
    expect(turkish.original(18, 20)).toEqual([19, 22]);
    expect(turkish.original(18, 19)).toEqual([19, 22]);
    expect(turkish.original(19, 20)).toEqual([19, 22]);
  });

  test("leaves text as written for matching outside Turkish and Azerbaijani", () => {
    for (const tag of ["en", "lt", "ru", "kk"]) {
      const prepared = matchingText("İnce ÌR Ирина", languagePack(tag));
      expect(prepared.text).toBe("İnce ÌR Ирина");
      expect(prepared.original(5, 7)).toEqual([5, 7]);
      expect(matchingCase("İnce", languagePack(tag))).toBe("İnce");
    }
  });

  test("writes reader-facing numbers in the language, always with 0-9 digits", () => {
    expect(formatNumber(1234567, languagePack("en"))).toBe("1,234,567");
    expect(formatNumber(12300, languagePack("de"))).toBe("12.300");
    expect(formatNumber(12300, languagePack("sv"))).toBe("12 300");
    expect(formatNumber(12300, languagePack("ar"))).toBe("12,300");
  });
});

describe("locale-aware reports and builds", () => {
  test("the narration guide lists names in the story's language", () => {
    const names = { anna: "Anna", zorn: "Zorn", asa: "Åsa", orjan: "Örjan" };
    const guide = (language) => {
      const root = project(language);
      writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: One\nnumber: 1\nstatus: draft", "## Chapter Text\n\nWords.\n");
      for (const [id, name] of Object.entries(names)) {
        writeMarkdown(path.join(root, "characters", `${id}.md`), `name: ${name}\nrole: minor\nstatus: alive\npronunciation: ${id}`, `# ${name}\n`);
      }
      const text = fs.readFileSync(buildBook(root, { format: "narration" }).outFile, "utf8");
      return [...text.matchAll(/^\| (\S+) \| \S+ \| character \|$/gm)].map((match) => match[1]);
    };
    expect(guide("sv")).toEqual(["Anna", "Zorn", "Åsa", "Örjan"]);
    expect(guide("en")).toEqual(["Anna", "Åsa", "Örjan", "Zorn"]);
  });

  test("POV balance breaks ties by id, the same in every language", () => {
    const povs = (language) => {
      const root = project(language);
      // Danish collation puts aa after z; ids must not follow it.
      ["zorn", "aage"].forEach((pov, index) => {
        writeMarkdown(path.join(root, "characters", `${pov}.md`), `name: ${pov === "aage" ? "Aage" : "Zorn"}\nrole: minor\nstatus: alive`, `# ${pov}\n`);
        writeMarkdown(path.join(root, "chapters", `chapter-0${index + 1}.md`), `title: Part ${index + 1}\nnumber: ${index + 1}\nstatus: draft\npov: ${pov}`, "## Chapter Text\n\nOne two three.\n");
      });
      expect(validateProject(root).errors).toEqual([]);
      return buildTimeline(scanProject(root)).pov.map((entry) => entry.pov);
    };
    expect(povs("da")).toEqual(["aage", "zorn"]);
    expect(povs("en")).toEqual(["aage", "zorn"]);
  });

  test("series books without a number sort by title in their shared language", () => {
    const order = (language, other = language) => {
      const cwd = makeTempDir();
      const first = createStoryProject({ cwd, title: "Zon", language, force: false }).root;
      const second = createStoryProject({ cwd, title: "Öde", language: other, force: false }).root;
      const last = createStoryProject({ cwd, title: "Slut", language, force: false }).root;
      const storyPath = path.join(last, "story.md");
      fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(/^---\n/, `---\nfollows:\n  - ../${path.basename(first)}\n  - ../${path.basename(second)}\n`), "utf8");
      return buildSeries(last, scanProject).books.map((book) => book.title);
    };
    expect(order("sv")).toEqual(["Zon", "Öde", "Slut"]);
    expect(order("de")).toEqual(["Öde", "Zon", "Slut"]);
    // Regional variants of one language share its collation.
    expect(order("sv-SE", "sv-FI")).toEqual(["Zon", "Öde", "Slut"]);
    // Books in different languages sort in English.
    expect(order("sv", "de")).toEqual(["Öde", "Zon", "Slut"]);
  });

  test("validate compares a style-sheet use and avoid in the story's casing", () => {
    const errors = (language, use, avoid) => {
      const root = project(language);
      fs.writeFileSync(path.join(root, "style-sheet.md"), `---\npreferred:\n  - use: ${use}\n    avoid: ${avoid}\n---\n\n# Style Sheet\n`, "utf8");
      return validateProject(root).errors.filter((entry) => entry.code === "style-use-equals-avoid").length;
    };
    expect(errors("tr", "IŞIK", "ışık")).toBe(1);
    expect(errors("tr", "İnce", "ince")).toBe(1);
    expect(errors("en", "Grey", "grey")).toBe(1);
    expect(errors("en", "grey", "gray")).toBe(0);
  });

  test("prose word lists sort in the story's language", () => {
    const echoes = (locale) => {
      const rules = proseRules({}, [], englishWordsIn(locale));
      const analysis = analyzeChapter("Zebra zebra went home. Ärlig ärlig went home.", rules);
      return analysis.echoes.map((entry) => entry.word);
    };
    expect(echoes("sv")).toEqual(["zebra", "ärlig"]);
    expect(echoes("de")).toEqual(["ärlig", "zebra"]);
  });

  test("import name candidates sort in the manuscript's language", () => {
    const prose = "They met Zora and Åke there. ".repeat(3);
    const names = (locale) => extractNameCandidates(prose, englishWordsIn(locale)).map((entry) => entry.name);
    expect(names("sv")).toEqual(["Zora", "Åke"]);
    expect(names("en")).toEqual(["Åke", "Zora"]);
  });

  test("Fountain capitalises names and places in the story's language", () => {
    const script = (tag) => fountainScript({
      title: "Liman",
      authors: [],
      form: "novel",
      pack: languagePack(tag),
      chapters: [{ id: "chapter-01", heading: "Bir", scenes: [{ id: "s1", title: "Gece", locationName: "İskele", setting: "exterior", time: "night", date: "", cast: ["Işıl", "İpek"], dilemma: "", outcome: "", flashbackTo: "", notes: [] }] }]
    });
    expect(script("tr")).toContain("EXT. İSKELE - NIGHT");
    expect(script("tr")).toContain("Characters: IŞIL, İPEK");
  });

  test("the Shunn word count is written as the story's language writes numbers", () => {
    expect(shunnWordCount(12345)).toBe("12,300");
    expect(shunnWordCount(12345, languagePack("de"))).toBe("12.300");
    expect(shunnWordCount(512, languagePack("de"))).toBe("512");
    const root = project("de");
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: Eins\nnumber: 1\nstatus: draft", `## Chapter Text\n\n${"Wort ".repeat(1234)}\n`);
    const text = fs.readFileSync(buildBook(root, { format: "shunn" }).outFile, "utf8");
    expect(text).toContain("Approximately 1.200 words");
  });

  // Collation can differ between ICU versions, so the bundled fallback under
  // Node must give the same bytes as Bun for these cases.
  test("the Node fallback writes the same locale-sorted output as Bun", () => {
    const probe = spawnSync("node", ["--version"], { encoding: "utf8" });
    if (probe.error || probe.status !== 0) {
      console.warn("Skipping the Node locale check: node is not on PATH.");
      return;
    }
    const root = project("sv");
    for (const name of ["Zorn", "Åsa", "Anna", "Örjan"]) {
      writeMarkdown(path.join(root, "characters", `${name.toLowerCase()}.md`), `name: ${name}\nrole: minor\nstatus: alive\npronunciation: ${name}`, `# ${name}\n`);
    }
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: Ett\nnumber: 1\nstatus: draft", `## Chapter Text\n\n${"ord ".repeat(1234)}\n`);
    const bundle = path.join(repoRoot, "skills", "story-maintenance", "scripts", "story.js");
    for (const format of ["narration", "shunn"]) {
      const bun = fs.readFileSync(buildBook(root, { format }).outFile, "utf8");
      const out = path.join(makeTempDir(), `node.${format}.md`);
      const run = spawnSync("node", [bundle, "build", root, "--format", format, "--out", out], { encoding: "utf8" });
      expect(run.status).toBe(0);
      expect(fs.readFileSync(out, "utf8")).toBe(bun);
    }
  });
});
