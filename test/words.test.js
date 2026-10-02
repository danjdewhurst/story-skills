import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mapLabels } from "../src/compare.js";
import { splitWords, wordCount } from "../src/markdown.js";
import { tokenizeDocument } from "../src/similarity.js";
import { wordSpans } from "../src/words.js";

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

  test("Node splits them the same way", () => {
    const probe = spawnSync("node", ["--version"], { encoding: "utf8" });
    if (probe.error || probe.status !== 0) {
      console.warn("Skipping the Node segmentation check: node is not on PATH.");
      return;
    }
    const markdown = pathToFileURL(path.join(import.meta.dirname, "..", "src", "markdown.js")).href;
    const script = `import(${JSON.stringify(markdown)}).then(({ splitWords }) => console.log(JSON.stringify(${JSON.stringify([THAI, LAO, KHMER, BURMESE])}.map(splitWords))))`;
    const result = spawnSync("node", ["-e", script], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual([THAI, LAO, KHMER, BURMESE].map(splitWords));
  });
});
