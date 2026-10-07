import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { createStoryProject, projectActions, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, messages } from "./helpers.js";

const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));
const examplesRoot = path.resolve(import.meta.dir, "..", "examples");

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

// A project with no errors: a drafted chapter and a character.
function newProject() {
  const cwd = makeTempDir();
  expect(invoke(cwd, ["init", "Doctor Fix", "--dir", "book"]).code).toBe(0);
  const root = path.join(cwd, "book");
  expect(invoke(root, ["add", "chapter", "One"]).code).toBe(0);
  expect(invoke(root, ["add", "character", "Mara Quill", "--role", "protagonist"]).code).toBe(0);
  const chapter = path.join(root, "chapters", "chapter-01.md");
  fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace("## Chapter Text\n", "## Chapter Text\n\nMara walked to the harbour in the rain.\n"));
  expect(invoke(root, ["wordcount", "--write"]).code).toBe(0);
  return root;
}

// Breaks the project in the ways doctor --fix repairs: a stale word count,
// a registry that does not list a character, and a missing registry.
function breakMechanically(root) {
  const chapter = path.join(root, "chapters", "chapter-01.md");
  fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace(/^word-count: \d+$/m, "word-count: 99"));
  fs.writeFileSync(path.join(root, "characters", "tobin-reed.md"), "---\ntype: character\nid: tobin-reed\nname: Tobin Reed\nstory: doctor-fix\nrole: supporting\nstatus: alive\n---\n# Tobin Reed\n");
  fs.rmSync(path.join(root, "glossary", "_index.md"));
}

function readAll(root) {
  const files = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        files[path.relative(root, full)] = fs.readFileSync(full, "utf8");
      }
    }
  };
  walk(root);
  return files;
}

function sweepProject(title = "Sweep") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title }).root;
}

describe("story doctor --fix", () => {
  test("applies migrate, wordcount --write, and reindex, then reports a healthy project and exits 0", () => {
    const root = newProject();
    breakMechanically(root);
    const prose = fs.readFileSync(path.join(root, "chapters", "chapter-01.md"), "utf8").split("---\n").slice(2).join("---\n");
    expect(invoke(root, ["validate"]).code).toBe(1);

    const result = invoke(root, ["doctor", "--fix"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("- story migrate (missing-required-path): ");
    expect(result.out).toContain("  create  glossary/_index.md\n");
    expect(result.out).toContain("- story wordcount --write (stale-word-count): ");
    expect(result.out).toContain("  update  chapters/chapter-01.md\n");
    // migrate reindexed, so the character registry was rebuilt with it and
    // reindex did not run again.
    expect(result.out).toContain("  update  characters/_index.md\n");
    expect(result.out).not.toContain("- story reindex");
    expect(result.out).toContain("# Story Doctor: Doctor Fix");
    expect(result.out).toContain("- Validate: ok (0 errors");

    expect(invoke(root, ["validate"]).code).toBe(0);
    expect(fs.readFileSync(path.join(root, "characters", "_index.md"), "utf8")).toContain("tobin-reed");
    const chapter = fs.readFileSync(path.join(root, "chapters", "chapter-01.md"), "utf8");
    expect(chapter).toMatch(/^word-count: 8$/m);
    expect(chapter.split("---\n").slice(2).join("---\n")).toBe(prose);

    // A second run has nothing to do and changes nothing.
    const before = readAll(root);
    const again = invoke(root, ["doctor", "--fix"]);
    expect(again.code).toBe(0);
    expect(again.out).toStartWith("Repairs:\n- No safe repairs needed\n\n# Story Doctor: Doctor Fix\n");
    expect(readAll(root)).toEqual(before);
  });

  test("runs reindex alone for a stale registry", () => {
    const root = newProject();
    fs.writeFileSync(path.join(root, "characters", "tobin-reed.md"), "---\ntype: character\nid: tobin-reed\nname: Tobin Reed\nstory: doctor-fix\nrole: supporting\nstatus: alive\n---\n# Tobin Reed\n");
    const result = invoke(root, ["doctor", "--fix"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("- story reindex (stale-registry): 1 change\n  update  characters/_index.md\n");
  });

  test("--dry-run lists the repairs and the checks that would remain, and changes nothing", () => {
    const root = newProject();
    breakMechanically(root);
    const before = readAll(root);
    const result = invoke(root, ["doctor", "--fix", "--dry-run"]);
    expect(result.code).toBe(0);
    expect(result.out).toStartWith("Repairs (dry run; nothing was written):\n");
    expect(result.out).toContain("  create  glossary/_index.md\n");
    expect(result.out).toMatch(/Dry run: story doctor --fix would make \d+ changes; the checks below are what would remain\n/);
    expect(result.out).toContain(`Root: ${root}\n`);
    expect(result.out).toContain("- Validate: ok (0 errors");
    expect(readAll(root)).toEqual(before);
  });

  test("exits 1 while a check still reports an error the repairs cannot fix", () => {
    const root = path.join(makeTempDir(), "the-unraveled-thread");
    fs.cpSync(path.join(examplesRoot, "the-unraveled-thread"), root, { recursive: true });
    const result = invoke(root, ["doctor", "--fix"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("- No safe repairs needed");
    expect(result.out).toContain("[P0] Fix continuity contradictions");
    // Plain doctor is still a report and exits 0.
    expect(invoke(root, ["doctor"]).code).toBe(0);
  });

  test("--json reports the repairs and the files written, and ok follows the exit code", () => {
    const root = newProject();
    breakMechanically(root);
    const preview = invokeJson(root, ["doctor", "--fix", "--dry-run", "--json"]);
    expect(preview.code).toBe(0);
    expect(preview.envelope.ok).toBe(true);
    expect(preview.envelope.writes).toEqual([]);
    expect(preview.envelope.data.fix.dryRun).toBe(true);

    const { code, envelope } = invokeJson(root, ["doctor", "--fix", "--json"]);
    expect(code).toBe(0);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.root).toBe(root);
    expect(envelope.data.fix.dryRun).toBe(false);
    expect(envelope.data.fix.stopped).toBeNull();
    expect(envelope.data.fix.repairs.map((repair) => repair.command)).toEqual(["migrate", "wordcount --write"]);
    expect(envelope.data.fix.repairs[1].codes).toEqual(["stale-word-count"]);
    expect(envelope.data.fix.changes).toEqual(preview.envelope.data.fix.changes);
    expect(envelope.data.fix.changes).toContainEqual({ action: "create", path: "glossary/_index.md" });
    expect(envelope.writes).toContain(path.join(root, "chapters", "chapter-01.md"));
    expect(envelope.diagnostics.filter((entry) => entry.code === "stale-word-count")).toEqual([]);

    const failing = path.join(makeTempDir(), "the-unraveled-thread");
    fs.cpSync(path.join(examplesRoot, "the-unraveled-thread"), failing, { recursive: true });
    const failed = invokeJson(failing, ["doctor", "--fix", "--json"]);
    expect(failed.code).toBe(1);
    expect(failed.envelope.ok).toBe(false);
    expect(failed.envelope.data.fix.repairs).toEqual([]);
  });

  test("leaves a warning story.md severity turned off alone", () => {
    const root = newProject();
    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace(/^---\n/, "---\nseverity:\n  - warning: stale-word-count\n    level: off\n"));
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace(/^word-count: \d+$/m, "word-count: 99"));
    const result = invoke(root, ["doctor", "--fix"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("- No safe repairs needed");
    expect(fs.readFileSync(chapter, "utf8")).toMatch(/^word-count: 99$/m);
  });

  test("stops before writing when a file does not parse, and says why", () => {
    const root = newProject();
    breakMechanically(root);
    fs.writeFileSync(path.join(root, "characters", "broken.md"), "---\nname: A\nname: B\n---\n");
    const before = readAll(root);
    const result = invoke(root, ["doctor", "--fix"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("- Stopped: Cannot fix: fix this file first");
    expect(result.out).not.toContain("- story wordcount");
    expect(readAll(root)).toEqual(before);
  });

  test("stops before writing when plot/_index.md does not parse", () => {
    const root = newProject();
    breakMechanically(root);
    fs.writeFileSync(path.join(root, "plot", "_index.md"), "---\ntype: plot-index\ntype: again\n---\n");
    const before = readAll(root);
    const result = invoke(root, ["doctor", "--fix"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("- Stopped: Cannot fix: fix this file first (story validate reports it):\n- plot/_index.md: Duplicate frontmatter key: type");
    expect(result.out).not.toContain("- story ");
    expect(readAll(root)).toEqual(before);

    fs.writeFileSync(path.join(root, "plot", "_index.md"), "---\ntype: plot-index\n");
    expect(invoke(root, ["doctor", "--fix"]).out).toContain("- Stopped: Cannot fix: fix this file first (story validate reports it):\n- plot/_index.md has unclosed YAML frontmatter");
    expect(readAll(root)).toEqual({ ...before, [path.join("plot", "_index.md")]: "---\ntype: plot-index\n" });
  });

  test("lists the files a repair wrote before it stopped", () => {
    const root = newProject();
    breakMechanically(root);
    // A symlinked registry stops migrate's reindex after it has created
    // glossary/_index.md.
    const registry = path.join(root, "characters", "_index.md");
    fs.renameSync(registry, path.join(root, "..", "characters-index.md"));
    fs.symlinkSync(path.join(root, "..", "characters-index.md"), registry);
    const result = invoke(root, ["doctor", "--fix"]);
    expect(result.out).toContain("- story migrate (missing-required-path): 1 change\n  create  glossary/_index.md\n- Stopped: ");
    expect(result.out).not.toContain("- story wordcount");
    expect(result.code).toBe(1);
  });

  test.skipIf(process.getuid?.() === 0)("a refused write stops the run with exit 4", () => {
    const root = newProject();
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace(/^word-count: \d+$/m, "word-count: 99"));
    fs.chmodSync(chapter, 0o444);
    try {
      const result = invoke(root, ["doctor", "--fix"]);
      expect(result.code).toBe(4);
      expect(result.err).toContain("chapters/chapter-01.md");
    } finally {
      fs.chmodSync(chapter, 0o644);
    }
  });

  test.skipIf(process.getuid?.() === 0)("a refused write keeps the repair that wrote before it in the report (#725)", () => {
    const root = newProject();
    // migrate makes the missing glossary registry, then its reindex is
    // refused by the read-only characters registry, which is stale.
    fs.rmSync(path.join(root, "glossary", "_index.md"));
    const registry = path.join(root, "characters", "_index.md");
    fs.writeFileSync(registry, fs.readFileSync(registry, "utf8").replace("| Mara Quill |", "| Stale Name |"));
    fs.chmodSync(registry, 0o444);
    try {
      const preview = invoke(root, ["doctor", "--fix", "--dry-run"]);
      expect(preview.code).toBe(4);
      expect(preview.out).toBe("Repairs (dry run; nothing was written):\n- story migrate (missing-required-path): 1 change\n  create  glossary/_index.md\nDry run: story doctor --fix would make 1 change\n");
      expect(fs.existsSync(path.join(root, "glossary", "_index.md"))).toBe(false);

      const result = invoke(root, ["doctor", "--fix"]);
      expect(result.code).toBe(4);
      expect(result.out).toBe("Repairs:\n- story migrate (missing-required-path): 1 change\n  create  glossary/_index.md\n");
      expect(result.err).toContain("characters/_index.md");
      expect(fs.existsSync(path.join(root, "glossary", "_index.md"))).toBe(true);
    } finally {
      fs.chmodSync(registry, 0o644);
    }
  });

  test("--dry-run without --fix is a usage error", () => {
    const root = newProject();
    const result = invoke(root, ["doctor", "--dry-run"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("--dry-run previews doctor --fix: add --fix");
  });
});

describe("project structure", () => {
  test("validate and doctor report the same errors on a partial project", () => {
    const root = sweepProject();
    fs.rmSync(path.join(root, "scenes"), { recursive: true });
    expect(messages(projectActions(root).validation.errors)).toEqual(messages(validateProject(root).errors));
  });
});
