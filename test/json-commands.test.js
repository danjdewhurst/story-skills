import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { BUILD_EXTENSIONS } from "../src/build.js";
import { API_VERSION } from "../src/json.js";
import { PDF_ENGINES } from "../src/pdf.js";
import { createEntity, createStoryProject } from "../src/story.js";
import { shellWord } from "../src/report.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo, whileWriting, writeMarkdown } from "./helpers.js";

// --json on names, compare, passes, diagram, synopsis, export, build, init,
// and import.

const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));
const examplesRoot = path.resolve(import.meta.dir, "..", "examples");
const examples = fs.readdirSync(examplesRoot).sort().filter((name) => fs.existsSync(path.join(examplesRoot, name, "story.md")));

// `stdin`, when given, stands in for text piped to `story <command> -`.
function invoke(cwd, argv, stdin) {
  const io = memoryIo(cwd);
  if (stdin !== undefined) {
    io.readStdin = () => Buffer.from(stdin);
  }
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

// One JSON object on stdout, nothing on stderr, the schema, and ok matching
// the exit code.
function invokeJsonOnce(cwd, argv, stdin) {
  const result = invoke(cwd, argv, stdin);
  expect(result.err).toBe("");
  const envelope = JSON.parse(result.out);
  expect(validateAgainstSchema(envelope, schema)).toEqual([]);
  expect(envelope.apiVersion).toBe(API_VERSION);
  expect(envelope.ok).toBe(result.code === 0);
  return { ...result, envelope };
}

// invokeJsonOnce, then the same command without --json, which must exit
// with the same code.
function invokeJson(cwd, argv) {
  const result = invokeJsonOnce(cwd, argv);
  expect(result.code).toBe(invoke(cwd, argv.filter((arg) => arg !== "--json")).code);
  return result;
}

// A copy of an example in a temp folder, for the commands that write.
function copyExample(name = "the-unraveled-thread") {
  const root = path.join(makeTempDir(), name);
  fs.cpSync(path.join(examplesRoot, name), root, { recursive: true });
  return root;
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
    expect(diagram.data).toEqual({ kind: "arcs", text: invoke(root, ["diagram", "arcs"]).out, nodes: expect.any(Array), edges: expect.any(Array), outFile: null, dryRun: false, changes: [] });
    expect(diagram.data.nodes.filter((node) => node.kind === "arc").map((node) => node.id)).toEqual(["the-ledger-trail"]);
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

describe("--json on export, build, init, and import", () => {
  test("export and build give the file they wrote, its chapters, and the warnings they print", () => {
    const root = copyExample();
    const manuscript = path.join(root, "dist", "manuscript.md");
    const exported = invokeJson(root, ["export", "--json"]).envelope;
    expect(exported).toMatchObject({ command: "export", ok: true, diagnostics: [], writes: [manuscript] });
    expect(exported.data).toEqual({ outFile: manuscript, chapters: 4, dryRun: false, changes: [{ action: "mkdir", path: "dist" }, { action: "create", path: "dist/manuscript.md" }] });

    const book = path.join(root, "dist", "the-unraveled-thread.md");
    const built = invokeJson(root, ["build", "--format", "md", "--json"]).envelope;
    expect(built.data).toEqual({ format: "markdown", outFile: book, chapters: 4, pages: null, pdf: false, engine: null, dryRun: false, changes: [{ action: "create", path: "dist/the-unraveled-thread.md" }] });
    expect(built.writes).toEqual([book]);
    // A rebuild lists the file it rewrote as an update.
    expect(invokeJson(root, ["build", "--json"]).envelope.data.changes).toEqual([{ action: "update", path: "dist/the-unraveled-thread.md" }]);

    const twee = invokeJson(root, ["build", "--format", "twee", "--json"]).envelope;
    expect(twee.data.outFile).toBe(path.join(root, "dist", "the-unraveled-thread.twee"));
    expect(twee.diagnostics).toEqual([expect.objectContaining({ severity: "warning", file: "story.md", code: "derived-ifid", check: "build" })]);
    expect(invoke(root, ["build", "--format", "twee"]).err).toBe(`warning: ${twee.diagnostics[0].message} [derived-ifid]\n`);

    const codex = invokeJson(root, ["build", "--format", "codex", "--json"]).envelope;
    const folder = path.join(root, "dist", "codex");
    expect(codex.data).toMatchObject({ format: "codex", outFile: folder, chapters: 4, pdf: false, engine: null });
    expect(codex.writes).toHaveLength(codex.data.pages);
    expect(codex.writes).toContain(path.join(folder, "index.html"));
    expect(codex.writes.every((file) => file.startsWith(`${folder}${path.sep}`) && file.endsWith(".html"))).toBe(true);
  });

  test("a warning story.md severity promotes fails a build or export, with exit 1", () => {
    const root = copyExample();
    const storyPath = path.join(root, "story.md");
    const text = fs.readFileSync(storyPath, "utf8");
    const end = text.indexOf("\n---\n", 4);
    fs.writeFileSync(storyPath, `${text.slice(0, end)}\nseverity:\n  - warning: derived-ifid\n    level: error\n  - warning: empty-chapter\n    level: error${text.slice(end)}`, "utf8");
    writeMarkdown(path.join(root, "chapters", "chapter-05.md"), "title: Unwritten\nnumber: 5\nstatus: outline", "## Chapter Text\n");
    const twee = invokeJson(root, ["build", "--format", "twee", "--json"]);
    expect(twee.code).toBe(1);
    expect(twee.envelope.diagnostics.map((entry) => [entry.severity, entry.code])).toContainEqual(["error", "derived-ifid"]);
    // The build still wrote its file, so writes lists it.
    expect(twee.envelope.writes).toEqual([path.join(root, "dist", "the-unraveled-thread.twee")]);
    const exported = invokeJson(root, ["export", "--json"]);
    expect(exported.code).toBe(1);
    expect(exported.envelope.diagnostics).toEqual([expect.objectContaining({ severity: "error", file: "chapters/chapter-05.md", code: "empty-chapter", check: "export" })]);
  });

  test("a build named by a substitute story id says so", () => {
    const cwd = makeTempDir();
    const { root: made } = createStoryProject({ cwd, title: "Placeholder", dir: "book" });
    createEntity(made, { kind: "chapter", name: "One", number: 1 });
    const storyPath = path.join(made, "story.md");
    fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace(/^title: .*$/m, "title: 東京物語"), "utf8");
    const root = path.join(cwd, "東京");
    fs.renameSync(made, root);
    const { envelope } = invokeJson(root, ["build", "--format", "epub", "--json"]);
    expect(envelope.data.outFile).toBe(path.join(root, "dist", "story-d209412e.epub"));
    expect(envelope.diagnostics.find((entry) => entry.code === "substitute-story-id")).toMatchObject({ severity: "warning", file: "story.md", check: "build" });
  });

  test("the schema lists every build format and PDF engine", () => {
    expect(schema.$defs["data-build"].properties.format.enum).toEqual(Object.keys(BUILD_EXTENSIONS));
    expect(schema.$defs["data-build"].properties.engine.enum).toEqual([...PDF_ENGINES.map((engine) => engine.name), null]);
  });

  test("init gives the project it made, the books it linked, and the files it wrote", () => {
    const cwd = makeTempDir();
    const first = invokeJsonOnce(cwd, ["init", "Paper Lanterns", "--json"]).envelope;
    const root = path.join(cwd, "paper-lanterns");
    expect(first.data).toMatchObject({ root, storyId: "paper-lanterns", keptStory: false, ignoredOptions: [], gitignore: "created", linkedBooks: [], dryRun: false });
    expect(first.data.changes[0]).toEqual({ action: "mkdir", path: "." });
    expect(first.writes).toContain(path.join(root, "story.md"));
    expect(first.writes).toEqual(first.data.changes.filter((change) => change.action === "create").map((change) => path.join(root, change.path)));
    expect(first.diagnostics).toEqual([]);

    const sequel = invokeJsonOnce(cwd, ["init", "Paper Boats", "--follows", "paper-lanterns", "--json"]).envelope;
    expect(sequel.data.linkedBooks).toEqual([root]);
    expect(sequel.data.changes).toContainEqual({ action: "update", path: "../paper-lanterns/story.md" });
    expect(sequel.writes).toContain(path.join(root, "story.md"));
    expect(fs.readFileSync(path.join(root, "story.md"), "utf8")).toContain("paper-boats");

    // Again with --force: nothing is missing, and the .gitignore init wrote
    // ignores dist/.
    const again = invokeJsonOnce(cwd, ["init", "Paper Lanterns", "--force", "--json"]).envelope;
    expect(again.data).toMatchObject({ root, keptStory: true, ignoredOptions: [], gitignore: "kept", changes: [] });
    expect(again).toMatchObject({ diagnostics: [], writes: [] });
  });

  test("an init that fails after making the book lists the files it wrote", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["init", "Book One"]).code).toBe(0);
    const story = path.join(cwd, "book-one", "story.md");
    const saved = `${fs.readFileSync(story, "utf8")}\nSaved meanwhile.\n`;
    const spy = whileWriting(story, () => fs.writeFileSync(story, saved));
    let result;
    try {
      result = invokeJsonOnce(cwd, ["init", "Book Two", "--follows", "book-one", "--json"]);
    } finally {
      spy.mockRestore();
    }
    expect(result.code).toBe(4);
    const two = path.join(cwd, "book-two");
    expect(result.envelope).toMatchObject({ ok: false, data: null });
    expect(result.envelope.diagnostics).toEqual([expect.objectContaining({ code: "write-refused", message: expect.stringContaining("was made without it") })]);
    expect(result.envelope.writes).toContain(path.join(two, "story.md"));
    expect(result.envelope.writes).not.toContain(story);
    expect(result.envelope.writes.every((file) => fs.existsSync(file))).toBe(true);
    expect(fs.readFileSync(story, "utf8")).toBe(saved);
  });

  test("init --force names the options a kept story.md did not take, and a .gitignore that misses dist/", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Kept Book", force: false });
    fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n", "utf8");
    fs.rmSync(path.join(root, "glossary"), { recursive: true });
    const { envelope } = invokeJsonOnce(cwd, ["init", "Other Title", "--dir", "kept-book", "--force", "--genre", "mystery", "--json"]);
    expect(envelope.data).toMatchObject({ root, storyId: "kept-book", keptStory: true, ignoredOptions: ["title", "--genre"], gitignore: "missing-dist" });
    expect(envelope.data.changes).toContainEqual({ action: "create", path: "glossary/_index.md" });
    expect(envelope.diagnostics).toEqual([{
      severity: "warning",
      file: "story.md",
      chapter: null,
      message: "story.md already exists and was kept, so the title and --genre were not applied. Edit story.md to change them.",
      code: "kept-story-options",
      check: "init"
    }]);
  });

  test("import gives the chapters, their length, the candidates, and the warnings it found", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "draft.md"), "# Chapter One\n\nMira Holt walked. Mira Holt ran. Mira Holt sat.\n\nChapter 2\n\nMore of it.\n", "utf8");
    const { envelope } = invokeJsonOnce(cwd, ["import", "draft.md", "--title", "The Draft", "--json"]);
    const root = path.join(cwd, "the-draft");
    expect(envelope.data).toMatchObject({
      root,
      storyId: "the-draft",
      keptStory: false,
      ignoredOptions: [],
      gitignore: "created",
      chapters: 1,
      unit: "words",
      words: 14,
      characterCount: null,
      candidates: [{ name: "Mira Holt", count: 3 }],
      dryRun: false
    });
    expect(envelope.data.changes).toContainEqual({ action: "create", path: "chapters/chapter-01.md" });
    expect(envelope.writes).toContain(path.join(root, "chapters", "chapter-01.md"));
    // The warning is about the manuscript, so it names no project file and
    // gives the manuscript as its source.
    expect(envelope.diagnostics).toEqual([{
      severity: "warning",
      file: null,
      chapter: null,
      message: expect.stringContaining("draft.md: 1 plain-text chapter line was not used to split chapters"),
      code: "unsplit-chapter-lines",
      check: "import",
      source: path.join(cwd, "draft.md")
    }]);
    // A folder of manuscript files names the file inside it.
    fs.mkdirSync(path.join(cwd, "drafts"));
    fs.copyFileSync(path.join(cwd, "draft.md"), path.join(cwd, "drafts", "one.md"));
    const folder = invokeJsonOnce(cwd, ["import", "drafts", "--title", "Folder Draft", "--json"]).envelope;
    expect(folder.diagnostics.map((entry) => entry.source)).toEqual([path.join(cwd, "drafts", "one.md")]);

    // A book counted in characters gives its character count.
    const zh = invokeJsonOnce(cwd, ["import", "-", "--title", "Zh Book", "--language", "zh", "--json"], "# 第一章\n\n你好，世界！她说。\n").envelope;
    expect(zh.data).toMatchObject({ unit: "characters", chapters: 1, characterCount: 9 });
  });

  test("import --force lists the chapters it deleted, and names the options the kept story.md did not take", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Kept Book", force: false });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "chapter", name: "Two", number: 2 });
    fs.writeFileSync(path.join(cwd, "draft.md"), "# Chapter One\n\nA new start.\n", "utf8");
    const { envelope } = invokeJsonOnce(cwd, ["import", "draft.md", "--title", "Other", "--dir", "kept-book", "--force", "--genre", "mystery", "--json"]);
    expect(envelope.data).toMatchObject({ root, keptStory: true, ignoredOptions: ["title", "--genre"], chapters: 1 });
    expect(envelope.data.changes).toContainEqual({ action: "delete", path: "chapters/chapter-02.md" });
    expect(envelope.data.changes).toContainEqual({ action: "update", path: "chapters/chapter-01.md" });
    expect(envelope.writes).not.toContain(path.join(root, "chapters", "chapter-02.md"));
    expect(envelope.diagnostics).toEqual([expect.objectContaining({ code: "kept-story-options", check: "import", message: expect.stringContaining("--title and --genre were not applied") })]);
  });

  test("an import --force that fails after replacing chapters lists the files it wrote", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Kept Book", force: false });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "chapter", name: "Old Three", number: 3 });
    fs.writeFileSync(path.join(cwd, "draft.md"), "# Chapter One\n\nA new start.\n\n# Chapter Two\n\nA new middle.\n", "utf8");
    // An editor saves chapter-02.md just before the import writes it.
    const second = path.join(root, "chapters", "chapter-02.md");
    const spy = whileWriting(second, () => fs.writeFileSync(second, "Mine.\n"));
    let result;
    try {
      result = invokeJsonOnce(cwd, ["import", "draft.md", "--title", "Kept Book", "--dir", "kept-book", "--force", "--json"]);
    } finally {
      spy.mockRestore();
    }
    expect(result.code).toBe(4);
    expect(result.envelope).toMatchObject({ ok: false, data: null });
    expect(result.envelope.diagnostics).toEqual([expect.objectContaining({ code: "write-refused" })]);
    expect(result.envelope.writes).toEqual([path.join(root, "chapters", "chapter-01.md")]);
    expect(fs.existsSync(path.join(root, "chapters", "chapter-03.md"))).toBe(false);
    expect(fs.readFileSync(second, "utf8")).toBe("Mine.\n");
  });

  test("a failure is the JSON error result, with the text run's exit code", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Taken", force: false });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const cases = [
      [cwd, ["init", "Taken", "--json"], 4, "write-refused", "already exists"],
      [cwd, ["init", "--json"], 2, "usage-error", "A story title is required"],
      [cwd, ["init", "Elsewhere", "--path", ".", "--json"], 2, "usage-error", "init uses --dir for the target directory"],
      [cwd, ["import", "nowhere.md", "--title", "Gone", "--json"], 2, "usage-error", "Import source not found"],
      [cwd, ["import", "nowhere.md", "--title", "Gone", "--dry-run", "--json"], 2, "usage-error", "Import source not found"],
      [cwd, ["export", "--json"], 3, "unusable-project", "is not a story project"],
      [root, ["export", "--out", "../escape.md", "--json"], 4, "write-refused", "outside project root"],
      [root, ["build", "--format", "pdf", "--json"], 2, "usage-error", "Unsupported build format: pdf"],
      [root, ["build", "--format", "epub", "--pdf", "--dry-run", "--json"], 2, "usage-error", "--pdf applies only to --format print and --format shunn"]
    ];
    for (const [where, argv, code, diagnosticCode, message] of cases) {
      const result = invokeJsonOnce(where, argv);
      expect(result.code).toBe(code);
      expect(result.envelope).toMatchObject({ command: argv[0], ok: false, data: null, writes: [] });
      expect(result.envelope.diagnostics).toEqual([expect.objectContaining({ severity: "error", code: diagnosticCode, check: argv[0], message: expect.stringContaining(message) })]);
      expect(invoke(where, argv.filter((arg) => arg !== "--json")).code).toBe(code);
    }
    // Empty input on stdin is refused as JSON too.
    const piped = invokeJsonOnce(cwd, ["import", "-", "--title", "Piped", "--json"], "");
    expect(piped.code).toBe(2);
    expect(piped.envelope).toMatchObject({ command: "import", ok: false, data: null });
    expect(fs.readdirSync(cwd)).toEqual(["taken"]);
  });
});
