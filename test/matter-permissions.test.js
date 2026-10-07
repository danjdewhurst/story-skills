import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { BUILD_EXTENSIONS } from "../src/build.js";
import { buildBook, compareProject, createEntity, createStoryProject, exportManuscript, validateProject } from "../src/story.js";
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

function sweepProject(title = "Sweep") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
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
const LYRIC = "A chorus sung twice.";
const DEDICATION = "For everyone who waited.";
const MATTER_BUILDS = ["markdown", "epub", "docx", "html", "print", "narration"];

// The warnings for the two quoted pages, the front epigraph and the back
// lyrics, left out for `reason`.
function leftOut(reason = "permission is still pending") {
  return ["epigraph", "lyrics"].map((id) => `matter/${id}.md ${reason}, so it is left out; pass --include-pending to include it`);
}

// Both quoted pages with the same permission `fields`.
function writeQuoted(root, fields) {
  writeEpigraph(root, fields);
  writeMarkdown(path.join(root, "matter", "lyrics.md"), `title: Lyrics\nplacement: back\n${fields}`, `\n${LYRIC}\n`);
}

// A drafted book with one chapter, a dedication that records no permission,
// and two quoted pages at `permission`: an epigraph in the front matter and
// lyrics in the back.
function quotedBook(permission, options) {
  const root = project("drafting", options);
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: Opening\nnumber: 1\nstatus: draft\nword-count: 2", "\n## Chapter Text\n\nChapter prose.\n");
  writeMarkdown(path.join(root, "matter", "dedication.md"), "title: Dedication\nplacement: front\nheading: false", `\n${DEDICATION}\n`);
  writeQuoted(root, `permission: ${permission}`);
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

function stderrLines(messagesList, level = "warning") {
  return messagesList.map((message) => `${level}: ${message} [permission-pending-left-out]\n`).join("");
}

function addToStory(root, lines) {
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("tense: past\n", `tense: past\n${lines}\n`), "utf8");
}

// The quoted pages are both out of `text`, and the rest of the book is in.
function expectLeftOut(text, label) {
  expect(text, label).toContain("Chapter prose.");
  expect(text, label).toContain(DEDICATION);
  expect(text, label).not.toContain(QUOTE);
  expect(text, label).not.toContain(LYRIC);
}

describe("pending permissions in export and build (#558)", () => {
  test("export and every build that prints matter leave both pending pages out, with a warning each", () => {
    const root = quotedBook("pending");
    const exported = exportManuscript(root);
    expectLeftOut(fs.readFileSync(exported.outFile, "utf8"), "export");
    expect(exported.warnings).toEqual(leftOut().map((message, index) => ({ code: "permission-pending-left-out", message, file: `matter/${["epigraph", "lyrics"][index]}.md`, chapter: null })));
    for (const format of MATTER_BUILDS) {
      const result = buildBook(root, { format });
      expectLeftOut(builtText(result.outFile), format);
      expect(messages(result.warnings), format).toEqual(leftOut());
    }
  });

  test("--include-pending keeps both pages, and cleared pages need no flag", () => {
    const root = quotedBook("pending");
    const exported = exportManuscript(root, { includePending: true });
    expect(fs.readFileSync(exported.outFile, "utf8")).toContain(QUOTE);
    expect(fs.readFileSync(exported.outFile, "utf8")).toContain(LYRIC);
    expect(exported.warnings).toEqual([]);
    for (const format of MATTER_BUILDS) {
      const result = buildBook(root, { format, includePending: true });
      expect(builtText(result.outFile), format).toContain(QUOTE);
      expect(builtText(result.outFile), format).toContain(LYRIC);
      expect(result.warnings, format).toEqual([]);
    }
    for (const permission of ["granted\nrights-holder: Tide Music Ltd", "not-needed", "public-domain"]) {
      writeQuoted(root, `permission: ${permission}`);
      const result = buildBook(root, { format: "html" });
      expect(fs.readFileSync(result.outFile, "utf8")).toContain(QUOTE);
      expect(fs.readFileSync(result.outFile, "utf8")).toContain(LYRIC);
      expect(result.warnings).toEqual([]);
    }
  });

  test("an unwritten page is never printed, so it is not reported as left out", () => {
    const root = quotedBook("granted\nrights-holder: Tide Music Ltd");
    writeMarkdown(path.join(root, "matter", "poem.md"), "title: Poem\nplacement: back\npermission: pending", "\n# Poem\n\n");
    expect(exportManuscript(root).warnings).toEqual([]);
    for (const format of MATTER_BUILDS) {
      expect(buildBook(root, { format }).warnings, format).toEqual([]);
    }
    // So a promoted warning cannot fail the review copy over it.
    addToStory(root, "severity:\n  - warning: permission-pending-left-out\n    level: error");
    expect(cli(root, ["build", root, "--format", "html"])).toMatchObject({ code: 0, err: "" });
  });

  test("builds without matter pages say nothing about it and refuse --include-pending", () => {
    const root = quotedBook("pending");
    for (const options of [{ format: "shunn" }, { format: "docx", shunn: true }, { format: "metadata" }, { format: "twee" }, { format: "ink" }, { format: "fountain" }, { format: "codex" }]) {
      const label = JSON.stringify(options);
      expect(buildBook(root, options).warnings.map((finding) => finding.code), label).not.toContain("permission-pending-left-out");
      expect(() => buildBook(root, { ...options, includePending: true }), label).toThrow(`--include-pending applies only to builds that print matter pages; --format ${options.format}${options.shunn ? " --shunn" : ""} prints none`);
    }
    // The metadata checklist still names the pages, as before.
    expect(fs.readFileSync(buildBook(root, { format: "metadata" }).outFile, "utf8")).toContain("pending: epigraph, lyrics)");
  });

  test("every build format either leaves the pages out with a warning or refuses --include-pending", () => {
    const root = quotedBook("pending");
    for (const format of Object.keys(BUILD_EXTENSIONS)) {
      const warned = buildBook(root, { format }).warnings.filter((finding) => finding.code === "permission-pending-left-out").length;
      let refused = false;
      try {
        buildBook(root, { format, includePending: true });
      } catch (error) {
        refused = error.message.startsWith("--include-pending applies only");
      }
      expect({ format, warned, refused }).toEqual({ format, warned: MATTER_BUILDS.includes(format) ? 2 : 0, refused: !MATTER_BUILDS.includes(format) });
    }
  });

  test("a misspelt permission key or a value that is not a cleared one leaves the page out too", () => {
    const root = quotedBook("pending");
    const cases = [
      ["permissions: pending", "has permissions rather than permission"],
      ["Permission: pending", "has Permission rather than permission"],
      ["permisson: granted", "has permisson rather than permission"],
      ["permission: granted\nrights-holder: Tide Music Ltd\nPermissions: pending", "has Permissions rather than permission"],
      ["permission: Pending", "permission is not one of not-needed, granted, or public-domain"],
      ["permission: \"pending \"", "permission is not one of not-needed, granted, or public-domain"],
      ["permission: [pending]", "permission is not one of not-needed, granted, or public-domain"],
      ["permission: |\n  pending", "permission is not one of not-needed, granted, or public-domain"],
      ["permission:", "permission is not one of not-needed, granted, or public-domain"]
    ];
    for (const [fields, reason] of cases) {
      writeQuoted(root, fields);
      for (const format of ["markdown", "html"]) {
        const result = buildBook(root, { format });
        expectLeftOut(builtText(result.outFile), `${fields} ${format}`);
        expect(messages(result.warnings), fields).toEqual(leftOut(reason));
      }
      expect(fs.readFileSync(buildBook(root, { format: "metadata" }).outFile, "utf8"), fields).toContain("pending: epigraph, lyrics)");
      expect(builtText(buildBook(root, { format: "html", includePending: true }).outFile), fields).toContain(QUOTE);
    }
    // A page that records no permission quotes nothing to clear.
    writeQuoted(root, "credit: Traditional");
    expect(buildBook(root, { format: "html" }).warnings).toEqual([]);
  });

  test("the metadata sheet reads the book as the builds print it", () => {
    const root = quotedBook("pending");
    const sheet = () => fs.readFileSync(buildBook(root, { format: "metadata" }).outFile, "utf8");
    const pages = (text) => /\| Estimated print pages \| (.*) \|/.exec(text)[1];
    writeMarkdown(path.join(root, "matter", "copyright.md"), "title: Copyright\nplacement: front\nheading: false\npermission: pending", "\nCopyright 2026 A. Writer.\n");
    writeMarkdown(path.join(root, "matter", "permissions.md"), "title: Permissions\nplacement: back\npermission: pending", `\n${Array.from({ length: 400 }, () => "Lines quoted by kind permission of the estate.").join("\n\n")}\n`);
    const pending = sheet();
    expect(pending).toContain("- [ ] Copyright line (`copyright`) or copyright matter page (pending permission: copyright)");
    expect(pending).toContain("- [ ] Permissions cleared for quoted matter (`permission`; pending: copyright, epigraph, lyrics, permissions)");
    fs.rmSync(path.join(root, "matter", "permissions.md"));
    expect(pages(pending)).toBe(pages(sheet()));
    // With a copyright line in story.md, the builds print the generated page.
    addToStory(root, "copyright: Copyright 2026 A. Writer");
    expect(sheet()).toContain("- [x] Copyright line (`copyright`) or copyright matter page (pending permission: copyright)");
    writeMarkdown(path.join(root, "matter", "copyright.md"), "title: Copyright\nplacement: front\nheading: false\npermission: not-needed", "\nCopyright 2026 A. Writer.\n");
    expect(sheet()).toContain("- [x] Copyright line (`copyright`) or copyright matter page\n");
  });

  test("a page left out needs no title, but one that prints does", () => {
    const root = quotedBook("pending");
    writeMarkdown(path.join(root, "matter", "epigraph.md"), "title: \"\"\nplacement: front\nheading: false\npermission: pending", `\n${QUOTE}\n`);
    expect(messages(exportManuscript(root).warnings)).toEqual(leftOut());
    expect(messages(buildBook(root, { format: "epub" }).warnings)).toEqual(leftOut());
    expect(() => buildBook(root, { format: "epub", includePending: true })).toThrow("matter/epigraph.md: a matter page needs a title to build");
    expect(() => exportManuscript(root, { includePending: true })).toThrow("matter/epigraph.md: a matter page needs a title to build");
    writeMarkdown(path.join(root, "matter", "epigraph.md"), "title: \"\"\nplacement: front\nheading: false\npermission: granted\nrights-holder: Tide Music Ltd", `\n${QUOTE}\n`);
    expect(() => buildBook(root, { format: "epub" })).toThrow("matter/epigraph.md: a matter page needs a title to build");
  });

  test("story build and export print the warnings, and --include-pending keeps the pages", () => {
    const root = quotedBook("pending");
    const built = cli(root, ["build", root, "--format", "html"]);
    expect(built.code).toBe(0);
    expect(built.err).toBe(stderrLines(leftOut()));
    expectLeftOut(fs.readFileSync(path.join(root, "dist", "quoted.html"), "utf8"), "build");
    const kept = cli(root, ["build", root, "--format", "html", "--include-pending"]);
    expect(kept.code).toBe(0);
    expect(kept.err).toBe("");
    expect(fs.readFileSync(path.join(root, "dist", "quoted.html"), "utf8")).toContain(LYRIC);

    const exported = cli(root, ["export", root]);
    expect(exported.code).toBe(0);
    expect(exported.err).toBe(stderrLines(leftOut()));
    expectLeftOut(fs.readFileSync(path.join(root, "dist", "manuscript.md"), "utf8"), "export");
    const exportedAll = cli(root, ["export", root, "--include-pending"]);
    expect(exportedAll.code).toBe(0);
    expect(exportedAll.err).toBe("");
    expect(fs.readFileSync(path.join(root, "dist", "manuscript.md"), "utf8")).toContain(QUOTE);
    expect(fs.readFileSync(path.join(root, "dist", "manuscript.md"), "utf8")).toContain(LYRIC);

    const refused = cli(root, ["build", root, "--format", "shunn", "--include-pending"]);
    expect(refused.code).toBe(2);
    expect(refused.err).toContain("--include-pending applies only to builds that print matter pages; --format shunn prints none");
  });

  test("a print PDF leaves the pages out too", () => {
    const root = quotedBook("pending");
    // A --dry-run finds the engine without running it, so any file named
    // after one will do.
    const engine = path.join(makeTempDir(), process.platform === "win32" ? "weasyprint.exe" : "weasyprint");
    fs.writeFileSync(engine, "", { mode: 0o755 });
    const planned = cli(root, ["build", root, "--format", "print", "--pdf", "--pdf-engine", engine, "--dry-run"]);
    expect(planned.code).toBe(0);
    expect(planned.err).toBe(stderrLines(leftOut()));
    expect(cli(root, ["build", root, "--format", "print", "--pdf", "--pdf-engine", engine, "--dry-run", "--include-pending"]).err).toBe("");
    expect(cli(root, ["build", root, "--format", "shunn", "--pdf", "--pdf-engine", engine, "--dry-run", "--include-pending"]).code).toBe(2);
  });

  test("severity can make the build fail instead, and cli-defaults cannot include the pages", () => {
    const root = quotedBook("pending");
    addToStory(root, "severity:\n  - warning: permission-pending-left-out\n    level: error");
    expect(validateProject(root).errors).toEqual([]);
    const failed = cli(root, ["build", root, "--format", "html"]);
    expect(failed.code).toBe(1);
    expect(failed.err).toContain(stderrLines(leftOut(), "error"));

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
    const result = compareProject(root, { against: "old", cwd: dir, anchors: ["front-epigraph-p1", "back-lyrics-p1"] });
    expect(result.anchors).toEqual([
      { label: "front-epigraph-p1", status: "unchanged", to: "front-epigraph-p1", similarity: 1 },
      { label: "back-lyrics-p1", status: "unchanged", to: "back-lyrics-p1", similarity: 1 }
    ]);
  });
});

describe("sweep fixes", () => {
  test("the metadata checklist lists pending permissions", () => {
    const root = sweepProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "matter", name: "Epigraph" });
    const epigraph = path.join(root, "matter", "epigraph.md");
    fs.writeFileSync(epigraph, fs.readFileSync(epigraph, "utf8").replace("heading: true", "heading: true\npermission: pending") + "A quoted line.\n");
    const sheet = fs.readFileSync(buildBook(root, { format: "metadata" }).outFile, "utf8");
    expect(sheet).toContain("Permissions cleared for quoted matter (`permission`; pending: epigraph)");
  });
});
