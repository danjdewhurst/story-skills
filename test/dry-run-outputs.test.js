import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { planChanges, removeFile, writeFile } from "../src/files.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { CHMOD_IGNORED, makeTempDir, memoryIo, treeDiff, treeSnapshot } from "./helpers.js";

// --dry-run for the commands that write their output (build, export,
// diagram --out, synopsis --out), make a project (init, import), or record
// in story.md or progress.md (passes, progress --log). Each preview must
// list exactly what the real run then changes, and change nothing itself.

const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));
const examplesRoot = path.resolve(import.meta.dir, "..", "examples");

// A copy of an example inside its own temp folder, which the tests
// snapshot whole, so writes beside the project (an --out outside it, a new
// book in a series) are seen too.
function copyExample(name = "the-unraveled-thread") {
  const parent = makeTempDir();
  const root = path.join(parent, name);
  fs.cpSync(path.join(examplesRoot, name), root, { recursive: true });
  return { parent, root };
}

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function invokeJson(cwd, argv) {
  const result = invoke(cwd, argv);
  const envelope = JSON.parse(result.out);
  expect(validateAgainstSchema(envelope, schema)).toEqual([]);
  return { ...result, envelope };
}

// The changes a text preview lists, as { action, path } entries.
function previewChanges(out, command) {
  const lines = out.split("\n");
  const summary = lines.findIndex((line) => line.startsWith(`Dry run: story ${command} would make `));
  expect(summary).toBeGreaterThanOrEqual(0);
  expect(lines[summary]).toEndWith("; nothing was written");
  return lines.slice(0, summary)
    .filter((line) => /^(create|update|delete|mkdir) /.test(line))
    .map((line) => ({ action: line.slice(0, 7).trim(), path: line.slice(8) }));
}

// Changes listed relative to `base`, as paths relative to `parent`, sorted
// as treeDiff sorts them.
function underParent(changes, base, parent) {
  return changes
    .map((change) => ({ action: change.action, path: path.relative(parent, path.resolve(base, change.path)).split(path.sep).join("/") }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// Runs the preview, checks it changed nothing under `parent`, runs the real
// command, and checks the preview listed exactly what it changed. A rebuild
// rewrites a page with the same bytes, which the tree comparison cannot
// see, so `rewrites` lets an update of a file the run left byte-identical
// through. Returns both runs.
function expectTextParity({ parent, cwd, base, argv, command = argv[0], rewrites = false }) {
  const before = treeSnapshot(parent);
  const preview = invoke(cwd, [...argv, "--dry-run"]);
  expect(preview.code).toBe(0);
  expect(treeSnapshot(parent)).toEqual(before);
  const planned = previewChanges(preview.out, command);
  expect(planned.length).toBeGreaterThan(0);

  const real = invoke(cwd, argv);
  expect(real.code).toBe(0);
  const after = treeSnapshot(parent);
  const listed = underParent(planned, base, parent)
    .filter((change) => !(rewrites && change.action === "update" && before[change.path] === after[change.path]));
  expect(listed).toEqual(treeDiff(before, after));
  expect(preview.err).toBe(real.err);
  return { preview, real, planned };
}

const BUILD_FORMATS = ["markdown", "epub", "docx", "shunn", "html", "print", "narration", "metadata", "fountain", "codex"];

describe("--dry-run for builds and exports", () => {
  for (const format of BUILD_FORMATS) {
    test(`build --format ${format} --dry-run lists what the build writes and writes nothing`, () => {
      const { parent, root } = copyExample();
      expectTextParity({ parent, cwd: root, base: root, argv: ["build", "--format", format], command: "build" });
    });
  }

  test("a rebuild previews updates, and the codex the stale pages it deletes", () => {
    const { parent, root } = copyExample();
    expect(invoke(root, ["build", "--format", "epub"]).code).toBe(0);
    expect(invoke(root, ["build", "--format", "codex"]).code).toBe(0);
    const characters = path.join(root, "dist", "codex", "characters");
    const page = fs.readdirSync(characters).find((name) => name.endsWith(".html"));
    fs.copyFileSync(path.join(characters, page), path.join(characters, "ghost.html"));
    // An empty entity folder, and one only a stale page keeps, both go.
    fs.mkdirSync(path.join(root, "dist", "codex", "systems"));
    fs.mkdirSync(path.join(root, "dist", "codex", "factions"));
    fs.copyFileSync(path.join(characters, page), path.join(root, "dist", "codex", "factions", "old-guild.html"));
    // A rebuild of an unchanged book writes the same bytes, which the tree
    // comparison cannot see, so the book changes first.
    fs.appendFileSync(path.join(root, "chapters", "chapter-01.md"), "\nA last line.\n");

    const epub = expectTextParity({ parent, cwd: root, base: root, argv: ["build", "--format", "epub"], command: "build" });
    expect(epub.planned).toEqual([{ action: "update", path: "dist/the-unraveled-thread.epub" }]);
    const codex = expectTextParity({ parent, cwd: root, base: root, argv: ["build", "--format", "codex"], command: "build", rewrites: true });
    expect(codex.planned).toContainEqual({ action: "delete", path: "dist/codex/characters/ghost.html" });
    expect(codex.planned).toContainEqual({ action: "delete", path: "dist/codex/factions" });
    expect(codex.planned).toContainEqual({ action: "delete", path: "dist/codex/systems" });
  });

  test("export --dry-run plans an --out outside the project, folders and all", () => {
    const { parent, root } = copyExample();
    const out = path.join(parent, "outbox", "drafts", "book.md");
    const { planned } = expectTextParity({ parent, cwd: root, base: root, argv: ["export", "--out", out] });
    expect(planned).toEqual([
      { action: "mkdir", path: "../outbox" },
      { action: "mkdir", path: "../outbox/drafts" },
      { action: "create", path: "../outbox/drafts/book.md" }
    ]);
    expectTextParity({ parent, cwd: root, base: root, argv: ["export"] });
  });

  test("a dry run is refused where the build would be", () => {
    const { root } = copyExample();
    const outside = invoke(root, ["export", "--out", "../escape.md", "--dry-run"]);
    expect(outside.code).toBe(invoke(root, ["export", "--out", "../escape.md"]).code);
    expect(outside.code).not.toBe(0);
    expect(outside.err).toContain("outside project root");
    fs.mkdirSync(path.join(root, "dist", "book.md"), { recursive: true });
    expect(invoke(root, ["export", "--out", "dist/book.md", "--dry-run"]).err).toContain("is a directory");
  });

  test.skipIf(CHMOD_IGNORED)("a dry run refuses a folder the build cannot write to", () => {
    const { root } = copyExample();
    const locked = path.join(makeTempDir(), "locked");
    fs.mkdirSync(locked);
    // A writable file in a folder that is not: the write's temporary file
    // cannot be made beside it.
    fs.writeFileSync(path.join(locked, "kept.md"), "old");
    fs.chmodSync(locked, 0o555);
    try {
      for (const out of [path.join(locked, "book.md"), path.join(locked, "drafts", "book.md"), path.join(locked, "kept.md")]) {
        const preview = invoke(root, ["export", "--out", out, "--dry-run"]);
        const real = invoke(root, ["export", "--out", out]);
        expect(preview.code).toBe(real.code);
        expect(preview.code).not.toBe(0);
        expect(preview.err).toBe(real.err);
        expect(fs.readdirSync(locked)).toEqual(["kept.md"]);
      }
    } finally {
      fs.chmodSync(locked, 0o755);
    }
  });

  test("a folder left at an old temporary file's name does not stop a write or its dry run", () => {
    const { root } = copyExample();
    const leftover = path.join(root, "dist", `.book.md.story-${process.pid}.tmp`);
    fs.mkdirSync(leftover, { recursive: true });
    const preview = invoke(root, ["export", "--out", "dist/book.md", "--dry-run"]);
    expect(preview.code).toBe(0);
    expect(preview.err).toBe("");
    const real = invoke(root, ["export", "--out", "dist/book.md"]);
    expect(real.code).toBe(0);
    expect(fs.lstatSync(path.join(root, "dist", "book.md")).isFile()).toBe(true);
    expect(fs.lstatSync(leftover).isDirectory()).toBe(true);
  });

  test("a planned write is refused when a folder holds the target's place", () => {
    const { root } = copyExample();
    const target = path.join(root, "dist", "book.md");
    fs.mkdirSync(target, { recursive: true });
    // A folder's link count can be over one, so the message may name it as
    // hard-linked; the reason is what matters.
    expect(() => planChanges(root, () => writeFile(target, "text", { root }))).toThrow(`${target}: EISDIR`);
  });

  // A stub engine is a script with a shebang, which Windows cannot run.
  test.skipIf(process.platform === "win32")("build --pdf --dry-run names the engine it found and never runs it", () => {
    const { parent, root } = copyExample();
    const bin = makeTempDir();
    const marker = path.join(makeTempDir(), "ran");
    fs.writeFileSync(path.join(bin, "weasyprint"), `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");\nrequire("node:fs").writeFileSync(process.argv[3], "%PDF-1.7\\n");\n`, { mode: 0o755 });
    const before = treeSnapshot(parent);
    const savedPath = process.env.PATH;
    process.env.PATH = bin;
    let preview;
    try {
      preview = invoke(root, ["build", "--format", "print", "--pdf", "--dry-run"]);
    } finally {
      process.env.PATH = savedPath;
    }
    expect(preview.code).toBe(0);
    expect(preview.out).toBe("PDF engine: weasyprint (not run)\nmkdir   dist\ncreate  dist/the-unraveled-thread.pdf\nDry run: story build would make 2 changes; nothing was written\n");
    expect(fs.existsSync(marker)).toBe(false);
    expect(treeSnapshot(parent)).toEqual(before);

    // macOS also finds Chrome in /Applications, whatever PATH says.
    if (process.platform === "linux") {
      process.env.PATH = "";
      try {
        expect(invoke(root, ["build", "--format", "print", "--pdf", "--dry-run"]).err).toContain("No PDF engine found");
      } finally {
        process.env.PATH = savedPath;
      }
    }
  });
});

describe("--dry-run for diagram --out, synopsis --out, passes, and progress --log", () => {
  const CASES = [
    { argv: ["diagram", "relationships", "--out", "diagrams/family.mmd"] },
    { argv: ["synopsis", "--out", "dist/synopsis.md"] },
    { argv: ["passes", "--init"] },
    { argv: ["progress", "--log", "--date", "2026-03-04"] }
  ];
  for (const { argv } of CASES) {
    test(`story ${argv.join(" ")} --dry-run --json reports the real run's data with nothing written`, () => {
      const { parent, root } = copyExample();
      const before = treeSnapshot(parent);
      const preview = invokeJson(root, [...argv, "--dry-run", "--json"]);
      expect(preview.code).toBe(0);
      expect(treeSnapshot(parent)).toEqual(before);
      expect(preview.envelope.data.dryRun).toBe(true);
      expect(preview.envelope.writes).toEqual([]);
      expect(preview.envelope.data.changes.length).toBeGreaterThan(0);

      const real = invokeJson(root, [...argv, "--json"]);
      expect(real.code).toBe(0);
      expect(underParent(real.envelope.data.changes, root, parent)).toEqual(treeDiff(before, treeSnapshot(parent)));
      expect(preview.envelope.data).toEqual({ ...real.envelope.data, dryRun: true });
      expect(preview.envelope.diagnostics).toEqual(real.envelope.diagnostics);
      expect(real.envelope.writes).toEqual(real.envelope.data.changes
        .filter((change) => change.action === "create" || change.action === "update")
        .map((change) => path.join(root, change.path)));
    });
  }

  test("the text previews list the changes in place of the line saying what was written", () => {
    const { root } = copyExample();
    const passes = invoke(root, ["passes", "--init", "--dry-run"]);
    expect(passes.out).toStartWith("update  story.md\nDry run: story passes would make 1 change; nothing was written\n");
    expect(passes.out).not.toContain("Updated revision-passes");
    expect(passes.out).toContain("Next: structure");

    const progress = invoke(root, ["progress", "--log", "--dry-run"]);
    expect(progress.out).toStartWith("create  progress.md\nDry run: story progress would make 1 change; nothing was written\n");
    expect(progress.out).not.toContain("Logged ");

    expect(invoke(root, ["diagram", "arcs", "--out", "arcs.mmd", "--dry-run"]).out).toBe("create  arcs.mmd\nDry run: story diagram would make 1 change; nothing was written\n");
    expect(invoke(root, ["synopsis", "--out", "synopsis.md", "--dry-run"]).out).toBe("create  synopsis.md\nDry run: story synopsis would make 1 change; nothing was written\n");
    expect(fs.existsSync(path.join(root, "arcs.mmd"))).toBe(false);
  });

  test("--dry-run without the flag that writes is a usage error", () => {
    const { root } = copyExample();
    const cases = [
      [["progress", "--dry-run"], "--dry-run previews progress --log: add --log"],
      [["passes", "--dry-run"], "--dry-run previews passes --init, --start, or --done: add one"],
      [["diagram", "arcs", "--dry-run"], "--dry-run previews diagram --out: add --out"],
      [["synopsis", "--dry-run"], "--dry-run previews synopsis --out: add --out"]
    ];
    for (const [argv, message] of cases) {
      const result = invoke(root, argv);
      expect(result.code).toBe(2);
      expect(result.err).toContain(message);
    }
  });
});

describe("--dry-run for init and import", () => {
  test("init --dry-run lists the new project's files and folders and makes none", () => {
    const parent = makeTempDir();
    const { planned } = expectTextParity({ parent, cwd: parent, base: path.join(parent, "paper-lanterns"), argv: ["init", "Paper Lanterns"], command: "init" });
    expect(planned[0]).toEqual({ action: "mkdir", path: "." });
    expect(planned).toContainEqual({ action: "create", path: "story.md" });
  });

  test("init --dry-run in a series lists the backlink it would add to the linked book", () => {
    const { parent, root } = copyExample();
    const { planned } = expectTextParity({ parent, cwd: parent, base: path.join(parent, "the-sequel"), argv: ["init", "The Sequel", "--follows", "the-unraveled-thread"], command: "init" });
    expect(planned).toContainEqual({ action: "update", path: "../the-unraveled-thread/story.md" });
    expect(fs.readFileSync(path.join(root, "story.md"), "utf8")).toContain("the-sequel");
  });

  test("init --force --dry-run lists only the starter files a project is missing", () => {
    const { parent, root } = copyExample();
    fs.rmSync(path.join(root, "glossary"), { recursive: true });
    fs.rmSync(path.join(root, ".gitignore"), { force: true });
    const { planned } = expectTextParity({ parent, cwd: parent, base: root, argv: ["init", "Ignored", "--dir", "the-unraveled-thread", "--force"], command: "init" });
    expect(planned).toContainEqual({ action: "create", path: "glossary/_index.md" });
    expect(planned.some((change) => change.path === "story.md")).toBe(false);
  });

  test("init --dry-run is refused as the real run is", () => {
    const { root } = copyExample();
    const preview = invoke(path.dirname(root), ["init", "Taken", "--dir", "the-unraveled-thread", "--dry-run"]);
    expect(preview.code).toBe(4);
    expect(preview.err).toContain("already exists");
    const inside = invoke(root, ["init", "Nested Book", "--dry-run"]);
    expect(inside.code).toBe(4);
    expect(inside.err).toContain("inside another story project");
  });

  test("import --dry-run lists a new project's files, chapters, and registries", () => {
    const parent = makeTempDir();
    fs.writeFileSync(path.join(parent, "draft.md"), "# Chapter One\n\nMira Holt walked in.\n\n# Chapter Two\n\nMira Holt walked out.\n");
    const { planned, preview } = expectTextParity({ parent, cwd: parent, base: path.join(parent, "the-draft"), argv: ["import", "draft.md", "--title", "The Draft"], command: "import" });
    expect(planned).toContainEqual({ action: "create", path: "chapters/chapter-02.md" });
    expect(`${preview.out}${preview.err}`).not.toContain("story-dry-run-");
  });

  test("import --force --dry-run into a project lists the chapters it replaces and the registries it updates", () => {
    const { parent, root } = copyExample();
    fs.writeFileSync(path.join(parent, "draft.md"), "# Chapter One\n\nA new start.\n");
    const { planned, preview } = expectTextParity({ parent, cwd: parent, base: root, argv: ["import", "draft.md", "--title", "The Unraveled Thread", "--dir", "the-unraveled-thread", "--force"], command: "import" });
    expect(planned).toContainEqual({ action: "update", path: "chapters/chapter-01.md" });
    expect(planned).toContainEqual({ action: "delete", path: "chapters/chapter-02.md" });
    expect(planned).toContainEqual({ action: "update", path: "chapters/_index.md" });
    expect(preview.err).toContain("the old chapter files were replaced");
  });

  test("import --dry-run reads a manuscript from stdin and is refused as the real run is", () => {
    const parent = makeTempDir();
    const io = memoryIo(parent);
    io.readStdin = () => Buffer.from("# One\n\nText.\n");
    expect(runCli(["import", "-", "--title", "Piped", "--dry-run"], io)).toBe(0);
    expect(io.output()).toContain("create  chapters/chapter-01.md\n");
    expect(fs.readdirSync(parent)).toEqual([]);

    const missing = invoke(parent, ["import", "nowhere.md", "--title", "Gone", "--dry-run"]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("Import source not found");
  });

  test("import --dry-run lists the missing folders above a new project", () => {
    const parent = makeTempDir();
    fs.writeFileSync(path.join(parent, "draft.md"), "# One\n\nText.\n");
    const base = path.join(parent, "books", "drafts", "new");
    const { planned } = expectTextParity({ parent, cwd: parent, base, argv: ["import", "draft.md", "--title", "New", "--dir", "books/drafts/new"], command: "import" });
    expect(planned.slice(0, 3)).toEqual([
      { action: "mkdir", path: "." },
      { action: "mkdir", path: ".." },
      { action: "mkdir", path: "../.." }
    ].sort((a, b) => (a.path < b.path ? -1 : 1)));
  });

  test.skipIf(CHMOD_IGNORED)("import --dry-run is refused in a folder the import cannot write to", () => {
    const parent = makeTempDir();
    fs.writeFileSync(path.join(parent, "draft.md"), "# One\n\nText.\n");
    const locked = path.join(parent, "locked");
    fs.mkdirSync(locked, { mode: 0o555 });
    try {
      for (const dir of ["locked/new", "locked/deeper/new"]) {
        const preview = invoke(parent, ["import", "draft.md", "--title", "New", "--dir", dir, "--dry-run"]);
        const real = invoke(parent, ["import", "draft.md", "--title", "New", "--dir", dir]);
        expect(preview.code).not.toBe(0);
        expect(preview.code).toBe(real.code);
        expect(preview.err).toBe(real.err);
      }
    } finally {
      fs.chmodSync(locked, 0o755);
    }
  });

  // Windows makes symlinks only with extra privileges.
  test.skipIf(process.platform === "win32")("import --dry-run treats a symlinked story.md above it as the real import does", () => {
    const { parent, root } = copyExample();
    const shelf = path.join(parent, "shelf");
    fs.mkdirSync(shelf);
    fs.symlinkSync(path.join(root, "story.md"), path.join(shelf, "story.md"));
    fs.writeFileSync(path.join(parent, "draft.md"), "# One\n\nText.\n");
    expectTextParity({ parent, cwd: shelf, base: path.join(shelf, "new"), argv: ["import", "../draft.md", "--title", "New"], command: "import" });

    // A dangling symlink where a parent folder would be.
    fs.symlinkSync(path.join(parent, "nowhere"), path.join(parent, "dangling"));
    const argv = ["import", "draft.md", "--title", "New", "--dir", "dangling/new"];
    const preview = invoke(parent, [...argv, "--dry-run"]);
    const real = invoke(parent, argv);
    expect(preview.code).not.toBe(0);
    expect(preview.code).toBe(real.code);
    expect(preview.err).toBe(real.err);
  });

  test("import --dry-run is refused where the real import is, and writes nothing", () => {
    const { parent, root } = copyExample();
    fs.writeFileSync(path.join(parent, "draft.md"), "# One\n\nText.\n");
    fs.writeFileSync(path.join(parent, "a-file"), "not a folder");
    if (process.platform !== "win32") {
      fs.symlinkSync(root, path.join(parent, "linked"));
    }
    const before = treeSnapshot(parent);
    const cases = [
      [parent, ["import", "draft.md"]],
      [root, ["import", "../draft.md", "--title", "Nested Book"]],
      [parent, ["import", "draft.md", "--title", "File", "--dir", "a-file", "--force"]],
      [parent, ["import", "draft.md", "--title", "Root", "--dir", path.parse(parent).root, "--force"]],
      ...(process.platform === "win32" ? [] : [[parent, ["import", "draft.md", "--title", "Linked", "--dir", "linked", "--force"]]])
    ];
    for (const [cwd, argv] of cases) {
      const preview = invoke(cwd, [...argv, "--dry-run"]);
      expect(preview.code).not.toBe(0);
      expect(`${preview.out}${preview.err}`).not.toContain("story-dry-run-");
      expect(treeSnapshot(parent)).toEqual(before);
      if (argv.includes(path.parse(parent).root)) {
        expect(preview.err).toContain("--dry-run cannot preview a project made at");
        continue;
      }
      const real = invoke(cwd, argv);
      expect(preview.code).toBe(real.code);
      expect(preview.err).toBe(real.err);
      expect(treeSnapshot(parent)).toEqual(before);
    }
  });
});

describe("--dry-run --json for builds, exports, init, and import", () => {
  // The preview changes nothing and reports the real run's data and
  // diagnostics, with dryRun true and writes empty. The real run's changes
  // are what it changed, and its writes are the files it created or updated.
  function expectJsonParity({ parent, cwd, base, argv }) {
    const before = treeSnapshot(parent);
    const preview = invokeJson(cwd, [...argv, "--dry-run", "--json"]);
    expect(preview.code).toBe(0);
    expect(preview.err).toBe("");
    expect(treeSnapshot(parent)).toEqual(before);
    expect(preview.envelope).toMatchObject({ command: argv[0], ok: true, writes: [] });
    expect(preview.envelope.data.dryRun).toBe(true);
    expect(preview.envelope.data.changes.length).toBeGreaterThan(0);

    const real = invokeJson(cwd, [...argv, "--json"]);
    expect(real.code).toBe(0);
    expect(underParent(real.envelope.data.changes, base, parent)).toEqual(treeDiff(before, treeSnapshot(parent)));
    expect(preview.envelope.data).toEqual({ ...real.envelope.data, dryRun: true });
    expect(preview.envelope.diagnostics).toEqual(real.envelope.diagnostics);
    expect(real.envelope.writes).toEqual(real.envelope.data.changes
      .filter((change) => change.action === "create" || change.action === "update")
      .map((change) => path.resolve(base, change.path)));
    return real.envelope;
  }

  for (const format of ["epub", "twee", "codex"]) {
    test(`build --format ${format}`, () => {
      const { parent, root } = copyExample();
      const { data, diagnostics } = expectJsonParity({ parent, cwd: root, base: root, argv: ["build", "--format", format] });
      expect(data.format).toBe(format);
      expect(diagnostics.map((entry) => entry.code)).toEqual(format === "twee" ? ["derived-ifid"] : []);
    });
  }

  test("export, to an --out outside the project", () => {
    const { parent, root } = copyExample();
    const out = path.join(parent, "outbox", "book.md");
    const { data } = expectJsonParity({ parent, cwd: root, base: root, argv: ["export", "--out", out] });
    expect(data.outFile).toBe(out);
    expect(data.changes).toEqual([{ action: "mkdir", path: "../outbox" }, { action: "create", path: "../outbox/book.md" }]);
  });

  test("init, alone and in a series", () => {
    const { parent, root } = copyExample();
    expectJsonParity({ parent, cwd: parent, base: path.join(parent, "paper-lanterns"), argv: ["init", "Paper Lanterns"] });
    const sequel = expectJsonParity({ parent, cwd: parent, base: path.join(parent, "the-sequel"), argv: ["init", "The Sequel", "--follows", "the-unraveled-thread"] });
    expect(sequel.data.linkedBooks).toEqual([root]);
  });

  test("import, into a new project and with --force into an existing one", () => {
    const { parent, root } = copyExample();
    fs.writeFileSync(path.join(parent, "draft.md"), "# Chapter One\n\nMira Holt walked in.\n\n# Chapter Two\n\nMira Holt walked out.\n");
    expectJsonParity({ parent, cwd: parent, base: path.join(parent, "the-draft"), argv: ["import", "draft.md", "--title", "The Draft"] });
    const forced = expectJsonParity({ parent, cwd: parent, base: root, argv: ["import", "draft.md", "--title", "The Unraveled Thread", "--dir", "the-unraveled-thread", "--force"] });
    expect(forced.data).toMatchObject({ root, keptStory: true, chapters: 2 });
    expect(forced.data.changes).toContainEqual({ action: "delete", path: "chapters/chapter-03.md" });
  });
});

test("planChanges checks and records writes without making them", () => {
  const root = makeTempDir();
  fs.writeFileSync(path.join(root, "kept.md"), "old");
  const { changes } = planChanges(root, () => {
    writeFile(path.join(root, "kept.md"), "new", { root });
    writeFile(path.join(root, "a", "b", "new.md"), "text", { root });
  });
  expect(changes).toEqual([
    { action: "mkdir", path: "a" },
    { action: "mkdir", path: "a/b" },
    { action: "create", path: "a/b/new.md" },
    { action: "update", path: "kept.md" }
  ]);
  expect(fs.readdirSync(root)).toEqual(["kept.md"]);
  expect(fs.readFileSync(path.join(root, "kept.md"), "utf8")).toBe("old");
  expect(() => planChanges(root, () => writeFile(path.join(root, "..", "out.md"), "x", { root }))).toThrow("outside project root");
});

test("planChanges refuses what the real write would refuse", () => {
  const root = makeTempDir();
  fs.writeFileSync(path.join(root, "kept.md"), "old");
  fs.mkdirSync(path.join(root, "folder"));
  const refusals = [
    [() => removeFile(path.join(root, "gone.md")), "ENOENT"],
    [() => writeFile(path.join(root, "folder"), "x", { root }), "EISDIR"],
    [() => writeFile(path.join(root, "kept.md"), "x", { root, unchangedFrom: "older" }), "kept.md changed on disk"],
    [() => writeFile(path.join(root, "kept.md", "inside.md"), "x", {}), "ENOTDIR"],
    [() => writeFile(path.join(root, "kept.md", "sub", "inside.md"), "x", {}), /ENOTDIR|ENOENT/]
  ];
  for (const [run, message] of refusals) {
    const planned = (() => {
      try {
        planChanges(root, run);
      } catch (error) {
        return error.message;
      }
      return null;
    })();
    expect(planned).toMatch(message);
  }
  expect(planChanges(root, () => removeFile(path.join(root, "gone.md"), { force: true })).changes).toEqual([]);
  expect(planChanges(root, () => removeFile(path.join(root, "kept.md"))).changes).toEqual([{ action: "delete", path: "kept.md" }]);
  expect(fs.readdirSync(root).sort()).toEqual(["folder", "kept.md"]);
});
