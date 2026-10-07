import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { mapLabels } from "../src/compare.js";
import { openingWords } from "../src/html.js";
import { splitWords, wordCount } from "../src/markdown.js";
import { tokenizeDocument } from "../src/similarity.js";
import { createStoryProject, synopsisBook } from "../src/story.js";
import { segmentRun, wordSpans } from "../src/words.js";
import { makeTempDir } from "./helpers.js";

// Sentences whose dictionary segmentation is the same under Bun and Node 18,
// 20, 22, and 24: short, common words with no ambiguous split.
const THAI = "ฉันรักแมว";
const LAO = "ຂ້ອຍຮັກແມວ";
const KHMER = "ខ្ញុំស្រលាញ់ឆ្មា";
const BURMESE = "ကျွန်တော်ကြောင်ကိုချစ်တယ်";

describe("#307 scripts written without spaces", () => {
  test("Thai, Lao, Khmer, and Burmese are split into words by dictionary", () => {
    expect(splitWords(THAI)).toEqual(["ฉัน", "รัก", "แมว"]);
    expect(splitWords(LAO)).toEqual(["ຂ້ອຍ", "ຮັກ", "ແມວ"]);
    expect(splitWords(KHMER)).toEqual(["ខ្ញុំ", "ស្រលាញ់", "ឆ្មា"]);
    expect(splitWords(BURMESE)).toEqual(["ကျွန်တော်", "ကြောင်", "ကို", "ချစ်", "တယ်"]);
  });

  test("their punctuation, spacing, markdown, and neighbouring Latin text count as before", () => {
    expect(wordCount(`${BURMESE}။ ${THAI}`)).toBe(8);
    expect(wordCount(`**${THAI}** and ${LAO}, then *${KHMER}*.`)).toBe(11);
    expect(wordCount(`Mali${THAI}`)).toBe(4);
  });

  test("counts in other scripts are unchanged", () => {
    expect(wordCount("我是一个学生。他很好。")).toBe(9);
    expect(wordCount("コーヒー and tea")).toBe(6);
    expect(wordCount("नमस्ते दुनिया")).toBe(2);
    expect(wordCount("مرحبا بالعالم")).toBe(2);
    expect(wordCount("Привет, мир! don’t well-known 3.14")).toBe(5);
    expect(wordCount("Read https://example.com/a-b now")).toBe(3);
  });

  test("word offsets point at the text as written", () => {
    const text = `Ana: ${THAI} 東京!`;
    const spans = wordSpans(text, /\p{L}+/gu);
    expect(spans.map(({ word }) => word)).toEqual(["Ana", "ฉัน", "รัก", "แมว", "東", "京"]);
    for (const { word, start, end } of spans) {
      expect(text.slice(start, end)).toBe(word);
    }
  });

  test("story similarity splits them the same way", () => {
    const words = tokenizeDocument([{ label: "p1", text: `${THAI} ${BURMESE}` }]);
    expect(words.map((entry) => entry.word)).toEqual(["ฉัน", "รัก", "แมว", "ကျွန်တော်", "ကြောင်", "ကို", "ချစ်", "တယ်"]);
    expect(words[1]).toMatchObject({ start: 3, end: 6 });
  });

  test("compare --anchor finds an edited Chinese, Japanese, or Thai paragraph", () => {
    const entry = (label, text) => ({ label, key: "ch01", text });
    const japanese = mapLabels([entry("ch01-p1", "灯台守は階段を数えた。")], [entry("ch01-p1", "灯台守は階段を二度数えた。")], ["ch01-p1"]);
    expect(japanese[0]).toMatchObject({ status: "edited", to: "ch01-p1" });
    expect(japanese[0].similarity).toBeCloseTo(20 / 22);
    const thai = mapLabels([entry("ch01-p1", `${THAI} แมวกินปลา`)], [entry("ch01-p1", `แมวกินปลา ${THAI}`)], ["ch01-p1"]);
    expect(thai[0]).toMatchObject({ status: "edited", to: "ch01-p1", similarity: 1 });
  });

  test("a soft hyphen or zero-width joiner inside a word keeps it one word", () => {
    expect(splitWords("แม\u00ADว")).toEqual(["แม\u00ADว"]);
    expect(splitWords("แม\u200Cว แม\u200Dว")).toHaveLength(2);
    expect(wordCount("แมว\u00AD")).toBe(1);
  });

  test("a long unbroken run is segmented in windows with the same result", () => {
    // Seeded, so the run is the same every time but not one repeated phrase.
    const pieces = ["ฉัน", "รัก", "แมว", "แมวกินปลา", "สวัสดีครับ"];
    let seed = 7;
    let run = "";
    while (run.length < 25000) {
      seed = (seed * 48271) % 2147483647;
      run += pieces[seed % pieces.length];
    }
    const whole = segmentRun(run, Infinity);
    expect(whole.length).toBeGreaterThan(5000);
    expect(segmentRun(run)).toEqual(whole);
    expect(segmentRun(run, 1000)).toEqual(whole);
    // A window with no words in it still moves on.
    expect(segmentRun("\u104B".repeat(50), 10)).toEqual([]);
  });

  test("opening words quote a few words of a paragraph without spaces", () => {
    expect(openingWords(`${BURMESE}။`, 3)).toBe("ကျွန်တော်ကြောင်ကို\u2026");
    expect(openingWords("灯台守は階段を数えた。")).toBe("灯台守は階段\u2026");
    expect(openingWords("“Wait,” she said — and then, at last, she ran.")).toBe("“Wait,” she said — and then, at\u2026");
  });

  test("a synopsis over budget is cut inside a paragraph without spaces", () => {
    const { root } = createStoryProject({ cwd: makeTempDir(), title: "Cats", force: false });
    const storyFile = path.join(root, "story.md");
    const story = fs.readFileSync(storyFile, "utf8");
    fs.writeFileSync(storyFile, story.replace(/## Synopsis\n[\s\S]*?(\n## |$)/, `## Synopsis\n\n${THAI.repeat(200)}\n$1`));
    const { text } = synopsisBook(root);
    expect(wordCount(text)).toBe(500);
    expect(text).toContain(`Logline: ${THAI}`);
  });

  test("Node splits them the same way, and a long run quickly", () => {
    const probe = spawnSync("node", ["--version"], { encoding: "utf8" });
    if (probe.error || probe.status !== 0) {
      console.warn("Skipping the Node segmentation check: node is not on PATH.");
      return;
    }
    const markdown = pathToFileURL(path.join(import.meta.dirname, "..", "src", "markdown.js")).href;
    // The long run is timed against one a quarter of its length, each the
    // fastest of three runs taken in turn, with no wall-clock limit. Windowed,
    // it takes about four times as long; unwindowed, Node 18 and 20 take about
    // fifty times as long.
    const script = `import(${JSON.stringify(markdown)}).then(({ splitWords }) => {
      const time = (run) => {
        const started = performance.now();
        run();
        return performance.now() - started;
      };
      let short = Infinity;
      let long = Infinity;
      let words = 0;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        short = Math.min(short, time(() => splitWords(${JSON.stringify(THAI)}.repeat(2750))));
        long = Math.min(long, time(() => { words = splitWords(${JSON.stringify(THAI)}.repeat(11000)).length; }));
      }
      console.log(JSON.stringify({ words: ${JSON.stringify([THAI, LAO, KHMER, BURMESE])}.map(splitWords), long: words, ms: { short, long } }));
    })`;
    const result = spawnSync("node", ["-e", script], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    const output = JSON.parse(result.stdout);
    expect(output.words).toEqual([THAI, LAO, KHMER, BURMESE].map(splitWords));
    expect(output.long).toBe(33000);
    expect(output.ms.long).toBeLessThan(8 * output.ms.short + 25);
  });
});

describe("#207 combining marks and joiners stay inside words", () => {
  test("Indic, vowelled Arabic, Persian ZWNJ, NFD Latin, and Unicode hyphens", () => {
    expect(splitWords("नमस्ते दुनिया")).toEqual(["नमस्ते", "दुनिया"]);
    expect(wordCount("كَتَبَ الوَلَدُ")).toBe(2);
    expect(wordCount("می‌خواهم بروم")).toBe(2);
    expect(wordCount("résumé naïve".normalize("NFD"))).toBe(2);
    expect(wordCount("well‑known well‐known hyphen­ation")).toBe(3);
  });

  test("style-sheet and watch-word boundaries do not match inside a marked word", async () => {
    const { analyzeChapter, proseRules } = await import("../src/prose.js");
    const rules = proseRules({ "watch-words": ["cafe", "नमस"] }, []);
    const analysis = analyzeChapter("She ordered a café au lait. नमस्ते.".normalize("NFD"), rules);
    expect(analysis.watch).toEqual([]);
    expect(analyzeChapter("A cafe here.", rules).watch).toEqual([{ word: "cafe", count: 1 }]);
  });
});

describe("#209 numbers, times, URLs, and emails are one word", () => {
  test("counts each as one word", () => {
    expect(wordCount("He paid $1,000 in 1999.")).toBe(5);
    expect(wordCount("Pi is 3.14 today")).toBe(4);
    expect(wordCount("9:30 train")).toBe(2);
    expect(wordCount("See https://example.com/a/b now")).toBe(3);
    expect(wordCount("Email bob@example.com now")).toBe(3);
    expect(splitWords("Chapter 1: One")).toEqual(["Chapter", "1", "One"]);
  });

  test("stays linear on long runs", () => {
    const started = performance.now();
    wordCount(`${"a.".repeat(50000)} ${"b".repeat(100000)} ${"x_".repeat(50000)}`);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("#208 Chinese and Japanese count per character", () => {
  test("each Han, Hiragana, or Katakana character is a word", () => {
    expect(splitWords("我是一个学生。他很好。")).toHaveLength(9);
    expect(wordCount("これは日本語の文章です。")).toBe(11);
    expect(wordCount("コーヒー and tea")).toBe(6);
    expect(wordCount("Plain English words stay whole.")).toBe(5);
  });
});
