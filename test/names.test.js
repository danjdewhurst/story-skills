import { describe, expect, test } from "bun:test";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { checkNames, formatNames, givenName, nameWords } from "../src/names.js";
import { createEntity, createStoryProject, namesReport } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown, messages } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function namesProject() {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Names", force: false });
  createEntity(root, { kind: "character", name: "Mara Quill", role: "protagonist" });
  writeMarkdown(path.join(root, "characters", "ilya-venn.md"), "name: Ilya Venn\nrole: minor\nstatus: alive\naliases:\n  - The Gull", "# Ilya\n");
  writeMarkdown(path.join(root, "characters", "cut-guy.md"), "name: Zander\nrole: minor\nstatus: cut", "# Cut\n");
  createEntity(root, { kind: "location", name: "Saltmarsh" });
  createEntity(root, { kind: "faction", name: "Tide Guild" });
  createEntity(root, { kind: "artifact", name: "Brass Key" });
  createEntity(root, { kind: "system", name: "Rune Craft" });
  createEntity(root, { kind: "term", name: "Tideglass", alias: "Glass" });
  return { root, cwd };
}

describe("story names", () => {
  test("clashes with names, first names, aliases, and terms are errors", () => {
    const { root } = namesProject();
    const report = namesReport(root, ["Mara", "the gull", "Glass", "Brass Key", "Rune Craft", "Tide Guild", "Mára"]);
    expect(report.ok).toBe(false);
    expect(messages(report.errors)).toEqual([
      "\"Mara\" clashes with character mara-quill (Mara)",
      "\"the gull\" clashes with character ilya-venn (The Gull)",
      "\"Glass\" clashes with term tideglass (Glass)",
      "\"Brass Key\" clashes with artifact brass-key (Brass Key)",
      "\"Rune Craft\" clashes with system rune-craft (Rune Craft)",
      "\"Tide Guild\" clashes with faction tide-guild (Tide Guild)",
      "\"Mára\" clashes with character mara-quill (Mara)"
    ]);
    expect(messages(report.warnings)).not.toContain(expect.stringContaining("\"Mara\" looks like character mara-quill"));
  });

  test("look-alikes and shared initials with major characters are warnings; cut characters are ignored", () => {
    const { root } = namesProject();
    const report = namesReport(root, ["Maro", "Saltmarch", "Milo", "Zander", "Ilyana", "Bo"]);
    expect(messages(report.errors)).toEqual([]);
    expect(messages(report.warnings)).toEqual([
      "\"Maro\" looks like character mara-quill (Mara Quill)",
      "\"Saltmarch\" looks like location saltmarsh (Saltmarsh)",
      "\"Milo\" shares an initial with protagonist mara-quill (Mara Quill)",
      "\"Ilyana\" looks like character ilya-venn (Ilya Venn)"
    ]);
    expect(formatNames(report)).toBe("Maro: check\nSaltmarch: check\nMilo: check\nZander: clear\nIlyana: check\nBo: clear\n");
  });

  test("a name in a script written without spaces is one word unless spaces or an interpunct part it", () => {
    expect(nameWords("大島源治")).toEqual(["大島源治"]);
    expect(nameWords("大島 源治")).toEqual(["大島", "源治"]);
    expect(nameWords("王小明")).toEqual(["王小明"]);
    expect(nameWords("哈利·波特")).toEqual(["哈利", "波特"]);
    expect(nameWords("ジョン・スミス")).toEqual(["ジョン", "スミス"]);
    expect(nameWords("สมชายใจดี")).toEqual(["สมชายใจดี"]);
    expect(nameWords("สมชาย ใจดี")).toEqual(["สมชาย", "ใจดี"]);
    expect(nameWords("김민준")).toEqual(["김민준"]);
    expect(nameWords("김 민준")).toEqual(["김", "민준"]);
    expect(nameWords("Dr. O'Neil-Smith")).toEqual(["Dr", "O'Neil-Smith"]);
    expect(givenName("大島源治")).toBe("大島源治");
    expect(givenName("ジョン・スミス")).toBe("ジョン");
    expect(nameWords("王小明(John)")).toEqual(["王小明", "John"]);
    expect(nameWords("大島源治（おおしま）")).toEqual(["大島源治", "おおしま"]);
    expect(givenName("王小明(John)")).toBe("王小明");
  });

  test("an unspaced Japanese or Chinese name is compared whole, not character by character", () => {
    const cwd = makeTempDir();
    const ja = createStoryProject({ cwd, title: "霧見", dir: "kirimi", force: false, language: "ja" }).root;
    writeMarkdown(path.join(ja, "characters", "oshima-genji.md"), "name: 大島源治\nrole: supporting\nstatus: alive", "# 大島\n");
    writeMarkdown(path.join(ja, "characters", "morita-haruka.md"), "name: 森田遥\nrole: protagonist\nstatus: alive", "# 森田\n");
    const jaReport = namesReport(ja, ["大", "源治", "大島源治", "大島源太", "森田"]);
    expect(messages(jaReport.errors)).toEqual(["\"大島源治\" clashes with character oshima-genji (大島源治)"]);
    expect(messages(jaReport.warnings)).toEqual([
      "\"大島源太\" looks like character oshima-genji (大島源治)",
      "\"森田\" shares an initial with protagonist morita-haruka (森田遥)"
    ]);
    expect(formatNames(jaReport)).toBe("大: clear\n源治: clear\n大島源治: taken\n大島源太: check\n森田: check\n");

    const zh = createStoryProject({ cwd, title: "灯塔", dir: "dengta", force: false, language: "zh" }).root;
    writeMarkdown(path.join(zh, "characters", "wang-xiaoming.md"), "name: 王小明\nrole: supporting\nstatus: alive", "# 王\n");
    writeMarkdown(path.join(zh, "characters", "harry.md"), "name: 哈利·波特\nrole: minor\nstatus: alive", "# 哈利\n");
    writeMarkdown(path.join(zh, "characters", "li-wei.md"), "name: 李伟(Wei)\nrole: minor\nstatus: alive", "# 李\n");
    expect(messages(namesReport(zh, ["李伟"]).errors)).toEqual(["\"李伟\" clashes with character li-wei (李伟)"]);
    const zhReport = namesReport(zh, ["王", "小明", "王小明", "哈利", "波"]);
    expect(messages(zhReport.errors)).toEqual([
      "\"王小明\" clashes with character wang-xiaoming (王小明)",
      "\"哈利\" clashes with character harry (哈利)"
    ]);
    expect(formatNames(zhReport)).toBe("王: clear\n小明: clear\n王小明: taken\n哈利: taken\n波: clear\n");
  });

  test("Korean names split at their spaces and unspaced Thai names stay whole", () => {
    const cwd = makeTempDir();
    const ko = createStoryProject({ cwd, title: "등대", dir: "deungdae", force: false, language: "ko" }).root;
    writeMarkdown(path.join(ko, "characters", "kim-minjun.md"), "name: 김 민준\nrole: supporting\nstatus: alive", "# 김\n");
    expect(messages(namesReport(ko, ["김", "민준"]).errors)).toEqual(["\"김\" clashes with character kim-minjun (김)"]);

    const th = createStoryProject({ cwd, title: "ประภาคาร", dir: "prapakan", force: false, language: "th" }).root;
    writeMarkdown(path.join(th, "characters", "somchai.md"), "name: สมชายใจดี\nrole: supporting\nstatus: alive", "# สมชาย\n");
    const thReport = namesReport(th, ["สมชาย", "ใจดี", "สมชายใจดี"]);
    expect(messages(thReport.errors)).toEqual(["\"สมชายใจดี\" clashes with character somchai (สมชายใจดี)"]);
  });

  test("checkNames skips blank candidates and trims the rest", () => {
    expect(checkNames(["", "  ", " Bo "], []).results).toEqual([{ name: "Bo", status: "clear", clashes: [], lookalikes: [], initials: [] }]);
  });

  test("the CLI requires a name and exits 1 on a clash", () => {
    const { root, cwd } = namesProject();
    const missing = invoke(cwd, ["names", "--path", root]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("Usage: story names <name...>");

    const clash = invoke(cwd, ["names", "Mara", "Wren", "--path", root]);
    expect(clash.code).toBe(1);
    expect(clash.out).toBe("Mara: taken\nWren: clear\n");
    expect(clash.err).toContain("Name check failed: 1 errors");

    const clear = invoke(cwd, ["names", "Wren", "--path", root]);
    expect(clear.code).toBe(0);
    expect(clear.err).toContain("Names checked: 0 errors, 0 warnings");
  });
});
