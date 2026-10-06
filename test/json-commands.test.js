import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { API_VERSION } from "../src/json.js";
import { createEntity, createStoryProject } from "../src/story.js";
import { shellWord } from "../src/report.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

// --json on names, compare, passes, diagram, and synopsis.

const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));
const examplesRoot = path.resolve(import.meta.dir, "..", "examples");
const examples = fs.readdirSync(examplesRoot).sort().filter((name) => fs.existsSync(path.join(examplesRoot, name, "story.md")));

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

// One JSON object on stdout, nothing on stderr, the schema, and ok matching
// the exit code, which is the text mode's.
function invokeJson(cwd, argv) {
  const result = invoke(cwd, argv);
  expect(result.err).toBe("");
  const envelope = JSON.parse(result.out);
  expect(validateAgainstSchema(envelope, schema)).toEqual([]);
  expect(envelope.apiVersion).toBe(API_VERSION);
  expect(envelope.ok).toBe(result.code === 0);
  expect(result.code).toBe(invoke(cwd, argv.filter((arg) => arg !== "--json")).code);
  return { ...result, envelope };
}

function writeChapter(root, number, body) {
  writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `title: Chapter ${number}\nnumber: ${number}\nstatus: draft`, `## Chapter Text\n\n${body}\n`);
}

describe("--json on names, compare, passes, diagram, and synopsis", () => {
  test("every example matches the result schema", () => {
    for (const name of examples) {
      const root = path.join(examplesRoot, name);
      for (const argv of [["names", "Zebulon"], ["passes"], ["grid"], ["list", "chapters"], ["list", "scenes", "--where", "status"], ["synopsis"], ["synopsis", "--pages", "3"], ...["relationships", "locations", "timeline", "clues", "arcs"].map((kind) => ["diagram", kind])]) {
        const { envelope } = invokeJson(root, [...argv, "--json"]);
        expect(envelope.command).toBe(argv[0]);
        expect(envelope.writes).toEqual([]);
      }
    }
  });

  test("names lists each candidate's status and the names it matched, and exits 1 on a clash", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Names Json", force: false });
    createEntity(root, { kind: "character", name: "Mara Quill", role: "protagonist" });
    createEntity(root, { kind: "location", name: "Saltmarsh" });
    const { code, envelope } = invokeJson(root, ["names", "Mara", "Saltmarch", "Milo", "Bo", "--json"]);
    expect(code).toBe(1);
    const mara = { kind: "character", id: "mara-quill", name: "Mara", full: "Mara Quill", file: "characters/mara-quill.md" };
    expect(envelope.data.names).toEqual([
      { name: "Mara", status: "taken", clashes: [mara], lookalikes: [], initials: [] },
      { name: "Saltmarch", status: "check", clashes: [], lookalikes: [{ kind: "location", id: "saltmarsh", name: "Saltmarsh", full: "Saltmarsh", file: "worldbuilding/locations/saltmarsh.md" }], initials: [] },
      { name: "Milo", status: "check", clashes: [], lookalikes: [], initials: [mara] },
      { name: "Bo", status: "clear", clashes: [], lookalikes: [], initials: [] }
    ]);
    expect(envelope.diagnostics.map((entry) => [entry.severity, entry.code])).toEqual([
      ["error", "name-clash"], ["warning", "name-look-alike"], ["warning", "name-shared-initial"]
    ]);
    expect(invokeJson(root, ["names", "Bo", "--json"]).code).toBe(0);
    // A missing name is a JSON usage error.
    const missing = invokeJson(root, ["names", "--json"]);
    expect(missing.code).toBe(2);
    expect(missing.envelope).toMatchObject({ command: "names", ok: false, data: null });
  });

  test("compare lists each chapter's change and the totals", () => {
    const dir = makeTempDir();
    const { root: old } = createStoryProject({ cwd: dir, title: "Compare Json", dir: path.join(dir, "old") });
    writeChapter(old, 1, "The bell rang.\n\nShe dived.");
    writeChapter(old, 2, "Dock Six was quiet.");
    const { root } = createStoryProject({ cwd: dir, title: "Compare Json", dir: path.join(dir, "book") });
    writeChapter(root, 1, "The bell rang.\n\nShe dived deep, past the reef.");
    writeChapter(root, 3, "A new morning came.");
    const { code, envelope } = invokeJson(dir, ["compare", root, "--against", "old", "--json"]);
    expect(code).toBe(0);
    expect(envelope.data).toMatchObject({ mode: "chapters", label: old, beforeChapters: 2, afterChapters: 2, anchors: null });
    expect(envelope.data.chapters.map((chapter) => [chapter.id, chapter.status, chapter.movedFrom])).toEqual([
      ["chapter-01", "changed", null], ["chapter-02", "removed", null], ["chapter-03", "added", null]
    ]);

    const mapped = invokeJson(dir, ["compare", root, "--against", "old", "--anchor", "ch01-p1", "--anchor", "ch09-p1", "--json"]).envelope;
    expect(mapped.data).toMatchObject({ mode: "anchors", chapters: null, beforeWords: null });
    expect(mapped.data.anchors).toEqual([
      { label: "ch01-p1", status: "unchanged", to: "ch01-p1", similarity: 1, excerpt: null },
      { label: "ch09-p1", status: "unknown", to: null, similarity: null, excerpt: null }
    ]);

    const usage = invokeJson(dir, ["compare", root, "--json"]);
    expect(usage.code).toBe(2);
    expect(usage.envelope.diagnostics[0].code).toBe("usage-error");
  });

  test("passes lists each pass and reports story.md when it changes it", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Passes Json", force: false });
    const init = invokeJson(cwd, ["passes", root, "--init", "--start", "structure", "--done", "polishh", "--json"]).envelope;
    expect(init.writes).toEqual([path.join(root, "story.md")]);
    expect(init.data).toMatchObject({ changed: true, done: 1, next: "structure" });
    expect(init.data.passes[0]).toEqual({ pass: "structure", status: "in-progress", focus: expect.any(String), checks: [`story timeline ${shellWord(root)}`, `story pacing ${shellWord(root)}`, `story diagram arcs --path ${shellWord(root)}`] });
    expect(init.data.passes.at(-1)).toEqual({ pass: "polishh", status: "done", focus: null, checks: null });
    expect(init.data.notes).toEqual(["Added custom pass polishh, which is not in the default ladder"]);

    const again = invokeJson(root, ["passes", "--json"]).envelope;
    expect(again.writes).toEqual([]);
    expect(again.data).toMatchObject({ changed: false, notes: [] });
    expect(again.data.passes[0].checks).toEqual(["story timeline", "story pacing", "story diagram arcs"]);
  });

  test("diagram and synopsis give their text and the file --out wrote", () => {
    const root = path.join(examplesRoot, "the-unraveled-thread");
    const diagram = invokeJson(root, ["diagram", "arcs", "--json"]).envelope;
    expect(diagram.data).toEqual({ kind: "arcs", text: invoke(root, ["diagram", "arcs"]).out, outFile: null, dryRun: false, changes: [] });
    const synopsis = invokeJson(root, ["synopsis", "--json"]).envelope;
    expect(synopsis.data.text).toBe(invoke(root, ["synopsis"]).out);
    expect(synopsis.data).toMatchObject({ title: "The Unraveled Thread", pages: 1, budget: 500, outFile: null });
    expect(synopsis.data.sections.map((section) => section.arc)).toEqual(["the-ledger-trail"]);

    const cwd = makeTempDir();
    const { root: book } = createStoryProject({ cwd, title: "Out Json", force: false });
    createEntity(book, { kind: "arc", name: "Main Arc" });
    const written = invokeJson(book, ["diagram", "arcs", "--out", "dist/arcs.mmd", "--json"]).envelope;
    expect(written.data.outFile).toBe(path.join(book, "dist", "arcs.mmd"));
    expect(written.writes).toEqual([written.data.outFile]);
    const synopsisOut = invokeJson(book, ["synopsis", "--out", "dist/synopsis.md", "--json"]).envelope;
    expect(synopsisOut.writes).toEqual([path.join(book, "dist", "synopsis.md")]);
    expect(fs.readFileSync(synopsisOut.writes[0], "utf8")).toBe(synopsisOut.data.text);
    expect(synopsisOut.data.sections).toEqual([{ arc: "main-arc", name: "Main Arc", text: expect.any(String) }]);

    const unknown = invokeJson(root, ["diagram", "maps", "--json"]);
    expect(unknown.code).toBe(2);
    expect(unknown.envelope.data).toBeNull();
  });
});
