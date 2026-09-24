import { describe, expect, test } from "bun:test";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { formatNames } from "../src/names.js";
import { createEntity, createStoryProject, namesReport } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

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
    expect(report.errors).toEqual([
      "\"Mara\" clashes with character mara-quill (Mara)",
      "\"the gull\" clashes with character ilya-venn (The Gull)",
      "\"Glass\" clashes with term tideglass (Glass)",
      "\"Brass Key\" clashes with artifact brass-key (Brass Key)",
      "\"Rune Craft\" clashes with system rune-craft (Rune Craft)",
      "\"Tide Guild\" clashes with faction tide-guild (Tide Guild)",
      "\"Mára\" clashes with character mara-quill (Mara)"
    ]);
    expect(report.warnings).not.toContain(expect.stringContaining("\"Mara\" looks like character mara-quill"));
  });

  test("look-alikes and shared initials with major characters are warnings; cut characters are ignored", () => {
    const { root } = namesProject();
    const report = namesReport(root, ["Maro", "Saltmarch", "Milo", "Zander", "Ilyana", "Bo"]);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([
      "\"Maro\" looks like character mara-quill (Mara Quill)",
      "\"Saltmarch\" looks like location saltmarsh (Saltmarsh)",
      "\"Milo\" shares an initial with protagonist mara-quill (Mara Quill)",
      "\"Ilyana\" looks like character ilya-venn (Ilya Venn)"
    ]);
    expect(formatNames(report)).toBe("Maro: check\nSaltmarch: check\nMilo: check\nZander: clear\nIlyana: check\nBo: clear\n");
  });

  test("the CLI requires a name and exits 1 on a clash", () => {
    const { root, cwd } = namesProject();
    const missing = invoke(cwd, ["names", "--path", root]);
    expect(missing.code).toBe(1);
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
