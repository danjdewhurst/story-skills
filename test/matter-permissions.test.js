import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { buildBook, compareProject, createStoryProject, exportManuscript, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, readArchiveText, writeMarkdown, messages } from "./helpers.js";

function project(status = "drafting", { cwd = makeTempDir(), dir } = {}) {
  const { root } = createStoryProject({ cwd, title: "Quoted", force: false, dir });
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("status: planning", `status: ${status}`), "utf8");
  return root;
}

function writeEpigraph(root, fields) {
  writeMarkdown(path.join(root, "matter", "epigraph.md"), `title: Epigraph\nplacement: front\nheading: false\n${fields}`, "\nA line of a song.\n");
}

function matterFindings(result) {
  return result.filter((finding) => finding.startsWith("matter/epigraph.md"));
}

describe("matter permissions", () => {
  test("recorded permissions validate cleanly", () => {
    const root = project("complete");
    writeEpigraph(root, "permission: granted\nrights-holder: Tide Music Ltd\ncredit: Lyrics from \"Lamp\" by A. Singer, used by permission.");
    const result = validateProject(root);
    expect(matterFindings(messages(result.errors))).toEqual([]);
    expect(matterFindings(messages(result.warnings))).toEqual([]);
  });

  test("pending permission on a complete story and granted without a holder are warnings", () => {
    const root = project("complete");
    writeEpigraph(root, "permission: pending");
    expect(matterFindings(messages(validateProject(root).warnings))).toEqual(["matter/epigraph.md permission is still pending and the story is complete"]);

    writeEpigraph(root, "permission: granted");
    expect(matterFindings(messages(validateProject(root).warnings))).toEqual(["matter/epigraph.md permission is granted but no rights-holder is recorded"]);

    const drafting = project();
    writeEpigraph(drafting, "permission: pending");
    expect(matterFindings(messages(validateProject(drafting).warnings))).toEqual([]);
  });

  test("unknown permission values and non-text holders are errors", () => {
    const root = project();
    writeEpigraph(root, "permission: maybe\nrights-holder:\n  - A\n  - B");
    expect(matterFindings(messages(validateProject(root).errors))).toEqual([
      "matter/epigraph.md frontmatter field permission has unsupported value maybe",
      "matter/epigraph.md frontmatter field rights-holder must be a scalar"
    ]);
  });
});

const QUOTE = "A line of a song.";
const LEFT_OUT = "matter/epigraph.md permission is still pending, so it is left out; pass --include-pending to include it";
const MATTER_BUILDS = ["markdown", "epub", "docx", "html", "print", "narration"];

// A drafted book with one chapter and an epigraph at `permission`.
function quotedBook(permission, options) {
  const root = project("drafting", options);
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: Opening\nnumber: 1\nstatus: draft\nword-count: 2", "\n## Chapter Text\n\nChapter prose.\n");
  writeEpigraph(root, `permission: ${permission}`);
  return root;
}

function builtText(file) {
  return /\.(?:epub|docx)$/.test(file) ? readArchiveText(file) : fs.readFileSync(file, "utf8");
}

function cli(root, argv) {
  const io = memoryIo(path.dirname(root));
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function addToStory(root, lines) {
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("tense: past\n", `tense: past\n${lines}\n`), "utf8");
}

describe("pending permissions in export and build (#558)", () => {
  test("export and every build that prints matter leave a pending page out, with a warning", () => {
    const root = quotedBook("pending");
    const exported = exportManuscript(root);
    expect(fs.readFileSync(exported.outFile, "utf8")).not.toContain(QUOTE);
    expect(exported.warnings).toEqual([{ code: "permission-pending-left-out", message: LEFT_OUT, file: "matter/epigraph.md", chapter: null }]);
    for (const format of MATTER_BUILDS) {
      const result = buildBook(root, { format });
      const text = builtText(result.outFile);
      expect(text, format).toContain("Chapter prose.");
      expect(text, format).not.toContain(QUOTE);
      expect(messages(result.warnings), format).toEqual([LEFT_OUT]);
    }
  });

  test("--include-pending keeps the page, and a cleared page needs no flag", () => {
    const root = quotedBook("pending");
    const exported = exportManuscript(root, { includePending: true });
    expect(fs.readFileSync(exported.outFile, "utf8")).toContain(QUOTE);
    expect(exported.warnings).toEqual([]);
    for (const format of MATTER_BUILDS) {
      const result = buildBook(root, { format, includePending: true });
      expect(builtText(result.outFile), format).toContain(QUOTE);
      expect(result.warnings, format).toEqual([]);
    }
    for (const permission of ["granted\nrights-holder: Tide Music Ltd", "not-needed", "public-domain"]) {
      writeEpigraph(root, `permission: ${permission}`);
      const result = buildBook(root, { format: "html" });
      expect(fs.readFileSync(result.outFile, "utf8")).toContain(QUOTE);
      expect(result.warnings).toEqual([]);
    }
  });

  test("builds without matter pages say nothing about it and refuse --include-pending", () => {
    const root = quotedBook("pending");
    for (const options of [{ format: "shunn" }, { format: "docx", shunn: true }, { format: "metadata" }, { format: "twee" }, { format: "ink" }, { format: "fountain" }, { format: "codex" }]) {
      const label = JSON.stringify(options);
      expect(buildBook(root, options).warnings.map((finding) => finding.code), label).not.toContain("permission-pending-left-out");
      expect(() => buildBook(root, { ...options, includePending: true }), label).toThrow("--include-pending applies only to builds that print matter pages: --format markdown, epub, docx (without --shunn), html, print, and narration");
    }
    // The metadata checklist still names the page, as before.
    expect(fs.readFileSync(buildBook(root, { format: "metadata" }).outFile, "utf8")).toContain("pending: epigraph");
  });

  test("story build and export print the warning, and --include-pending keeps the page", () => {
    const root = quotedBook("pending");
    const built = cli(root, ["build", root, "--format", "html"]);
    expect(built.code).toBe(0);
    expect(built.err).toBe(`warning: ${LEFT_OUT} [permission-pending-left-out]\n`);
    expect(fs.readFileSync(path.join(root, "dist", "quoted.html"), "utf8")).not.toContain(QUOTE);
    const kept = cli(root, ["build", root, "--format", "html", "--include-pending"]);
    expect(kept.code).toBe(0);
    expect(kept.err).toBe("");
    expect(fs.readFileSync(path.join(root, "dist", "quoted.html"), "utf8")).toContain(QUOTE);
    const exported = cli(root, ["export", root, "--include-pending"]);
    expect(exported.code).toBe(0);
    expect(fs.readFileSync(path.join(root, "dist", "manuscript.md"), "utf8")).toContain(QUOTE);
    const refused = cli(root, ["build", root, "--format", "shunn", "--include-pending"]);
    expect(refused.code).toBe(2);
    expect(refused.err).toContain("--include-pending applies only to builds that print matter pages");
  });

  test("a print PDF leaves the page out too", () => {
    const root = quotedBook("pending");
    // A --dry-run finds the engine without running it, so any file named
    // after one will do.
    const engine = path.join(makeTempDir(), process.platform === "win32" ? "weasyprint.exe" : "weasyprint");
    fs.writeFileSync(engine, "", { mode: 0o755 });
    const planned = cli(root, ["build", root, "--format", "print", "--pdf", "--pdf-engine", engine, "--dry-run"]);
    expect(planned.code).toBe(0);
    expect(planned.err).toBe(`warning: ${LEFT_OUT} [permission-pending-left-out]\n`);
    expect(cli(root, ["build", root, "--format", "print", "--pdf", "--pdf-engine", engine, "--dry-run", "--include-pending"]).err).toBe("");
    expect(cli(root, ["build", root, "--format", "shunn", "--pdf", "--pdf-engine", engine, "--dry-run", "--include-pending"]).code).toBe(2);
  });

  test("severity can make the build fail instead, and cli-defaults cannot include the page", () => {
    const root = quotedBook("pending");
    addToStory(root, "severity:\n  - warning: permission-pending-left-out\n    level: error");
    expect(validateProject(root).errors).toEqual([]);
    const failed = cli(root, ["build", root, "--format", "html"]);
    expect(failed.code).toBe(1);
    expect(failed.err).toContain(`error: ${LEFT_OUT} [permission-pending-left-out]`);

    const defaulted = quotedBook("pending");
    addToStory(defaulted, "cli-defaults:\n  - command: build\n    include-pending: true\n  - command: export\n    include-pending: true");
    expect(messages(validateProject(defaulted).errors)).toEqual([
      "story.md cli-defaults[0] sets include-pending, which belongs to one run: pass --include-pending on the command line",
      "story.md cli-defaults[1] sets include-pending, which belongs to one run: pass --include-pending on the command line"
    ]);
    expect(cli(defaulted, ["build", defaulted, "--format", "html"]).code).toBe(3);
  });

  test("compare --anchor still maps the labels of a pending page", () => {
    const dir = makeTempDir();
    quotedBook("pending", { cwd: dir, dir: path.join(dir, "old") });
    const root = quotedBook("pending", { cwd: dir, dir: path.join(dir, "book") });
    const result = compareProject(root, { against: "old", cwd: dir, anchors: ["front-epigraph-p1"] });
    expect(result.anchors).toEqual([{ label: "front-epigraph-p1", status: "unchanged", to: "front-epigraph-p1", similarity: 1 }]);
  });
});
