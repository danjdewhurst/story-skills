import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { createEntity, createStoryProject } from "../src/story.js";
import { listSnapshots, snapshotId, snapshotProject } from "../src/snapshots.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function writeChapter(root, number, body) {
  writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `title: Chapter ${number}\nnumber: ${number}\nstatus: draft`, `## Chapter Text\n\n${body}\n`);
}

function project() {
  const cwd = makeTempDir();
  const root = path.join(cwd, "book");
  createStoryProject({ cwd, title: "Snapshot Story", dir: root });
  createEntity(root, { kind: "character", name: "Ada Quill" });
  writeChapter(root, 1, "First paragraph.\n\nSecond paragraph.");
  writeChapter(root, 2, "Cut me later.");
  invoke(cwd, ["reindex", root]);
  invoke(cwd, ["wordcount", root, "--write"]);
  return { cwd, root };
}

// The --json result, checked against the result schema.
function json(result) {
  const envelope = JSON.parse(result.out);
  expect(validateAgainstSchema(envelope, schema)).toEqual([]);
  return envelope;
}

describe("story snapshot", () => {
  test("copies the project's markdown to .snapshots/<id>/ with a manifest", () => {
    const { cwd, root } = project();
    fs.mkdirSync(path.join(root, "dist"));
    fs.writeFileSync(path.join(root, "dist", "book.md"), "built\n");
    const result = invoke(cwd, ["snapshot", "Before Line Edit", "--path", root]);
    expect(result.code).toBe(0);
    expect(result.out).toBe("Saved snapshot before-line-edit in .snapshots/before-line-edit/ (2 chapters, 7 words; 16 files)\nCompare with it later: story compare --snapshot before-line-edit\n");
    const dir = path.join(root, ".snapshots", "before-line-edit");
    expect(fs.readFileSync(path.join(dir, "chapters", "chapter-01.md"), "utf8")).toBe(fs.readFileSync(path.join(root, "chapters", "chapter-01.md"), "utf8"));
    expect(fs.existsSync(path.join(dir, "story.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "characters", "ada-quill.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "dist"))).toBe(false);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "snapshot.json"), "utf8"));
    expect(manifest).toMatchObject({ name: "Before Line Edit", id: "before-line-edit", chapters: 2, words: 7, files: 16 });
    expect(Number.isNaN(Date.parse(manifest.created))).toBe(false);
  });

  test("refuses to overwrite a snapshot without --force, and --force replaces it whole", () => {
    const { cwd, root } = project();
    expect(invoke(cwd, ["snapshot", "draft", "--path", root]).code).toBe(0);
    const refused = invoke(cwd, ["snapshot", "Draft", "--path", root]);
    expect(refused.code).toBe(4);
    expect(refused.err).toContain("Snapshot draft already exists in .snapshots/draft: choose another name, or add --force to replace it");

    fs.rmSync(path.join(root, "chapters", "chapter-02.md"));
    invoke(cwd, ["reindex", root]);
    const preview = invoke(cwd, ["snapshot", "draft", "--force", "--dry-run", "--path", root]);
    expect(preview.code).toBe(0);
    expect(preview.out).toContain("delete  .snapshots/draft/chapters/chapter-02.md\n");
    expect(preview.out).toContain("update  .snapshots/draft/chapters/chapter-01.md\n");
    expect(fs.existsSync(path.join(root, ".snapshots", "draft", "chapters", "chapter-02.md"))).toBe(true);

    const replaced = invoke(cwd, ["snapshot", "draft", "--force", "--path", root]);
    expect(replaced.code).toBe(0);
    expect(replaced.out).toStartWith("Replaced snapshot draft");
    expect(fs.existsSync(path.join(root, ".snapshots", "draft", "chapters", "chapter-02.md"))).toBe(false);
  });

  test("--dry-run writes nothing and refuses a taken name as the real run does", () => {
    const { cwd, root } = project();
    const preview = invoke(cwd, ["snapshot", "one", "--dry-run", "--json", "--path", root]);
    expect(preview.code).toBe(0);
    const data = json(preview).data;
    expect(data.dryRun).toBe(true);
    expect(data.changes).toContainEqual({ action: "create", path: ".snapshots/one/snapshot.json" });
    expect(fs.existsSync(path.join(root, ".snapshots"))).toBe(false);

    invoke(cwd, ["snapshot", "one", "--path", root]);
    expect(invoke(cwd, ["snapshot", "one", "--dry-run", "--path", root]).code).toBe(4);
  });

  test("--list shows every snapshot, oldest first, as text and JSON", () => {
    const { cwd, root } = project();
    expect(invoke(cwd, ["snapshot", "--list", "--path", root]).out).toBe("No snapshots yet: story snapshot <name> takes one\n");
    snapshotProject(root, { name: "Second Draft", now: new Date("2026-02-01T09:30:00Z") });
    snapshotProject(root, { name: "first", now: new Date("2026-01-01T08:00:00Z") });
    const listed = invoke(cwd, ["snapshot", "--list", "--path", root]);
    expect(listed.code).toBe(0);
    expect(listed.out).toBe("Snapshots: 2\n\n- first: 2026-01-01 08:00 UTC, 2 chapters, 7 words\n- second-draft (Second Draft): 2026-02-01 09:30 UTC, 2 chapters, 7 words\n");
    const data = json(invoke(cwd, ["snapshot", "--list", "--json", "--path", root])).data;
    expect(data.snapshots.map((snapshot) => snapshot.id)).toEqual(["first", "second-draft"]);
    // A folder without a manifest is listed by name.
    fs.mkdirSync(path.join(root, ".snapshots", "by-hand"));
    expect(listSnapshots(root).snapshots.at(-1)).toEqual({ name: "by-hand", id: "by-hand", created: null, chapters: null, words: null });
  });

  test("a project counted in characters records its characters too, and --force drops emptied folders", () => {
    const { cwd, root } = project();
    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace(/^---\n/, "---\ncount-unit: characters\n"), "utf8");
    writeMarkdown(path.join(root, "notes", "deep", "idea.md"), "title: Idea");
    const taken = json(invoke(cwd, ["snapshot", "chars", "--json", "--path", root])).data;
    expect(taken.characters).toBeGreaterThan(0);
    fs.rmSync(path.join(root, "notes"), { recursive: true });
    const replaced = invoke(cwd, ["snapshot", "chars", "--force", "--path", root]);
    expect(replaced.out).toContain(` characters; `);
    expect(fs.existsSync(path.join(root, ".snapshots", "chars", "notes"))).toBe(false);
    expect(listSnapshots(root).snapshots[0].characters).toBe(taken.characters);
  });

  test("a failed --force leaves the old snapshot as it was, and a failed first snapshot leaves nothing", () => {
    const { cwd, root } = project();
    expect(invoke(cwd, ["snapshot", "draft", "--path", root]).code).toBe(0);
    const dir = path.join(root, ".snapshots", "draft");
    const manifest = fs.readFileSync(path.join(dir, "snapshot.json"), "utf8");
    fs.rmSync(path.join(root, "chapters", "chapter-02.md"));
    invoke(cwd, ["reindex", root]);
    writeChapter(root, 1, "Rewritten.");
    // Sorted after chapters/, so the copy fails part way through.
    fs.mkdirSync(path.join(root, "notes"));
    fs.writeFileSync(path.join(root, "notes", "latin1.md"), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
    const failed = invoke(cwd, ["snapshot", "draft", "--force", "--path", root]);
    expect(failed.code).toBe(3);
    expect(failed.err).toContain("is not valid UTF-8");
    expect(fs.readFileSync(path.join(dir, "snapshot.json"), "utf8")).toBe(manifest);
    expect(fs.existsSync(path.join(dir, "chapters", "chapter-02.md"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, "chapters", "chapter-01.md"), "utf8")).toContain("First paragraph.");
    expect(fs.readdirSync(path.join(root, ".snapshots"))).toEqual(["draft"]);

    expect(invoke(cwd, ["snapshot", "fresh", "--path", root]).code).toBe(3);
    expect(fs.readdirSync(path.join(root, ".snapshots"))).toEqual(["draft"]);
  });

  test("a name in a script with no folder spelling needs --id, and compare finds it by name or id", () => {
    const { cwd, root } = project();
    const refused = invoke(cwd, ["snapshot", "初稿 v2", "--path", root]);
    expect(refused.code).toBe(2);
    expect(refused.err).toContain("Snapshot name 初稿 v2 has letters a folder name cannot spell (初稿): add --id <kebab-id>");
    expect(invoke(cwd, ["snapshot", "初稿", "--id", "Bad Id", "--path", root]).err).toContain("Snapshot --id must be kebab-case");
    expect(invoke(cwd, ["snapshot", "初稿 v2", "--id", "first-draft", "--path", root]).code).toBe(0);
    expect(listSnapshots(root).snapshots[0]).toMatchObject({ name: "初稿 v2", id: "first-draft" });
    // Cyrillic is transliterated, and the Ukrainian apostrophe is dropped.
    expect(snapshotId("Мʼята")).toBe("myata");
    expect(invoke(cwd, ["compare", root, "--snapshot", "初稿 v2"]).out).toContain("Compared with snapshot first-draft\n");
    expect(invoke(cwd, ["compare", root, "--snapshot", "first-draft"]).code).toBe(0);
    expect(invoke(cwd, ["compare", root, "--snapshot", "改稿"]).err).toContain("No snapshot named 改稿: story snapshot --list shows them: first-draft");
    expect(invoke(cwd, ["snapshot", "--list", "--id", "x", "--path", root]).err).toContain("--id does not apply to story snapshot --list");
  });

  test("rejects a missing or unusable name and misplaced flags", () => {
    const { cwd, root } = project();
    expect(invoke(cwd, ["snapshot", "--path", root]).code).toBe(2);
    expect(invoke(cwd, ["snapshot", " ", "--path", root]).err).toContain("story snapshot needs a name");
    expect(() => snapshotId("!!!")).toThrow("has no letters or digits");
    expect(invoke(cwd, ["snapshot", "x", "--list", "--path", root]).err).toContain("--list takes no name");
    expect(invoke(cwd, ["snapshot", "--list", "--force", "--path", root]).err).toContain("--force does not apply to story snapshot --list");
  });
});

describe("a project with snapshots", () => {
  test("checks, registries, word counts, and builds ignore .snapshots/", () => {
    const { cwd, root } = project();
    const before = {
      check: invoke(cwd, ["check", root, "--json"]),
      wordcount: json(invoke(cwd, ["wordcount", root, "--json"])).data,
      export: invoke(cwd, ["export", root, "--out", "dist/before.md"])
    };
    expect(json(before.check).ok).toBe(true);
    snapshotProject(root, { name: "draft" });
    // A snapshot of a later draft holds a chapter the project lacks.
    writeChapter(path.join(root, ".snapshots", "draft"), 3, "Only in the snapshot.");

    const check = json(invoke(cwd, ["check", root, "--json"]));
    expect(check.ok).toBe(true);
    expect(check.diagnostics).toEqual(json(before.check).diagnostics);
    expect(json(invoke(cwd, ["wordcount", root, "--json"])).data).toEqual(before.wordcount);
    const reindex = json(invoke(cwd, ["reindex", root, "--json"]));
    expect(reindex.data.changes).toEqual([]);
    invoke(cwd, ["export", root, "--out", "dist/after.md"]);
    expect(fs.readFileSync(path.join(root, "dist", "after.md"), "utf8")).toBe(fs.readFileSync(path.join(root, "dist", "before.md"), "utf8"));
    // Taking a snapshot never copies an earlier snapshot.
    snapshotProject(root, { name: "later" });
    expect(fs.existsSync(path.join(root, ".snapshots", "later", ".snapshots"))).toBe(false);
  });
});

describe("story compare --snapshot", () => {
  test("compares with a saved snapshot by name", () => {
    const { cwd, root } = project();
    invoke(cwd, ["snapshot", "Draft One", "--path", root]);
    writeChapter(root, 1, "First paragraph.\n\nSecond paragraph, revised and longer.");
    const result = invoke(cwd, ["compare", root, "--snapshot", "draft one"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Compared with snapshot draft-one\n");
    expect(result.out).toContain("- chapter-01 Chapter 1: 4 -> 7 words (+3), 50% of paragraphs unchanged");
    const mapped = invoke(cwd, ["compare", root, "--snapshot", "draft-one", "--anchor", "ch01-p1"]);
    expect(mapped.out).toContain("ch01-p1 -> ch01-p1 (text unchanged)");
  });

  test("names the snapshots there are when one is missing, and needs exactly one source", () => {
    const { cwd, root } = project();
    expect(invoke(cwd, ["compare", root, "--snapshot", "nope"]).err).toContain("No snapshot named nope: this project has none yet");
    invoke(cwd, ["snapshot", "kept", "--path", root]);
    const missing = invoke(cwd, ["compare", root, "--snapshot", "nope"]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("story snapshot --list shows them: kept");
    expect(invoke(cwd, ["compare", root, "--snapshot", "kept", "--ref", "HEAD"]).err).toContain("exactly one of --ref <git-ref>, --against <project-path>, or --snapshot <name>");
  });

  test("--ref stays a git ref when a snapshot has the same name", () => {
    const { cwd, root } = project();
    const git = (...args) => execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" });
    git("init", "-q");
    git("add", "-A");
    git("commit", "-qm", "one");
    git("tag", "draft");
    writeChapter(root, 2, "Cut me later, then grow.");
    invoke(cwd, ["snapshot", "draft", "--path", root]);
    writeChapter(root, 2, "Cut me later, then grow again.");
    expect(invoke(cwd, ["compare", root, "--ref", "draft"]).out).toContain("chapter-02 Chapter 2: 3 -> 6 words");
    expect(invoke(cwd, ["compare", root, "--snapshot", "draft"]).out).toContain("chapter-02 Chapter 2: 5 -> 6 words");
  });
});
