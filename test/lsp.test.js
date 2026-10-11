import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runCli } from "../src/cli.js";
import { readFileBytes, withOpenDocuments } from "../src/files.js";
import { findingMessage, findingRange } from "../src/finding-locations.js";
import { CHECK_DELAY_MS, ERROR_CODES, createLanguageServer, projectRootOf, projectsIn, uriPath } from "../src/language-server.js";
import { frontmatterEnd, idAt, itemField, keyAt, lineKey, lineRange, linkTargetAt, listItemAt, minimalEdit, range, textLines, tokenColumns } from "../src/lsp-text.js";
import { encodeMessage, messageReader } from "../src/lsp-transport.js";
import { SYMLINKS_SUPPORTED, makeTempDir, memoryIo } from "./helpers.js";

const EXAMPLE = path.join(import.meta.dir, "..", "examples", "the-unraveled-thread");
const SEVERITY_ERROR = 1;
const SEVERITY_WARNING = 2;
const LOG_ERROR = 1;
const COMPLETION_REFERENCE = 18;
const SMALL_READ_LIMIT = 4;
const PROJECT_CAP = 50;

// A copy of the-unraveled-thread to edit: Jonas learns of the ledger page
// in chapter 1, and changes whereabouts in chapter 2, so hover has state to show.
function storyProject() {
  const root = path.join(makeTempDir("story-lsp-"), "the-unraveled-thread");
  fs.cpSync(EXAMPLE, root, { recursive: true });
  edit(root, "continuity/state.md", (text) => text.replace("learned-in: chapter-05", "learned-in: chapter-01"));
  edit(root, "characters/jonas-reed.md", (text) => text.replace('arc: ""\n', 'arc: ""\nprogressions:\n  - from: chapter-02\n    field: whereabouts\n    value: "The *millpond* bank"\n'));
  return root;
}

function edit(root, file, change) {
  const target = path.join(root, file);
  fs.writeFileSync(target, change(fs.readFileSync(target, "utf8")));
}

// `text` with an LSP edit applied.
function applyEdit(text, { range: { start, end }, newText }) {
  const offset = ({ line, character }) => text.split("\n").slice(0, line).reduce((sum, lineText) => sum + lineText.length + 1, 0) + character;
  return text.slice(0, offset(start)) + newText + text.slice(offset(end));
}

function uri(root, file) {
  return pathToFileURL(path.join(root, file)).href;
}

// The position of the `occurrence`th `needle` in `text`, `offset` characters in.
function at(text, needle, offset = 0, occurrence = 0) {
  let index = -1;
  for (let count = 0; count <= occurrence; count += 1) {
    index = text.indexOf(needle, index + 1);
  }
  expect(index).toBeGreaterThan(-1);
  const before = text.slice(0, index + offset).split("\n");
  return { line: before.length - 1, character: before[before.length - 1].length };
}

// A server driven in memory: `request` returns the reply, `notify` sends a
// notification, and `sent` holds every message the server wrote.
function startServer({ capabilities = {}, folders = [], ...options } = {}) {
  const sent = [];
  const exits = [];
  const timers = [];
  const cancelled = [];
  const server = createLanguageServer({
    send: (message) => sent.push(message),
    exit: (code) => exits.push(code),
    schedule: (run, delay) => {
      timers.push({ run, delay });
      return timers.length;
    },
    cancel: (timer) => cancelled.push(timer),
    ...options
  });
  let id = 0;
  const client = {
    sent,
    exits,
    timers,
    cancelled,
    server,
    request(method, params) {
      id += 1;
      server.handle({ jsonrpc: "2.0", id, method, params });
      return sent.find((message) => message.id === id && message.method === undefined);
    },
    result(method, params) {
      const reply = client.request(method, params);
      expect(reply.error).toBeUndefined();
      return reply.result;
    },
    notify(method, params) {
      server.handle({ jsonrpc: "2.0", method, params });
    },
    open(root, file, text = fs.readFileSync(path.join(root, file), "utf8")) {
      client.notify("textDocument/didOpen", { textDocument: { uri: uri(root, file), languageId: "markdown", version: 1, text } });
      return text;
    },
    diagnostics(root, file) {
      const target = uri(root, file);
      return sent.filter((message) => message.method === "textDocument/publishDiagnostics" && message.params.uri === target).at(-1)?.params.diagnostics;
    }
  };
  client.result("initialize", { capabilities, workspaceFolders: folders.map((folder) => ({ uri: pathToFileURL(folder).href, name: path.basename(folder) })) });
  client.notify("initialized", {});
  return client;
}

const FULL_EDITS = { workspace: { workspaceEdit: { documentChanges: true, resourceOperations: ["create", "rename", "delete"] } } };

describe("lsp text positions", () => {
  test("frontmatterEnd finds the closing fence, after a byte order mark too", () => {
    expect(frontmatterEnd(textLines("\uFEFF---\na: 1\n---\nbody"))).toBe(2);
    expect(frontmatterEnd(textLines("# No frontmatter"))).toBe(-1);
    expect(frontmatterEnd(textLines("---\na: 1"))).toBe(-1);
  });

  test("keyAt names the key a value belongs to", () => {
    const lines = textLines("---\npov: sera\ncharacters:\n  - sera\n  - character: kael\n    type: sibling\n---");
    expect(keyAt(lines, 1, 6)).toBe("pov");
    expect(keyAt(lines, 1, 1)).toBeNull();
    expect(keyAt(lines, 3, 5)).toBe("characters");
    expect(keyAt(lines, 4, 18)).toBe("character");
    expect(keyAt(lines, 6, 1)).toBeNull();
    expect(keyAt(textLines("---\n  - orphan\n---"), 1, 5)).toBeNull();
  });

  test("idAt reads a kebab-case id, and nothing else", () => {
    expect(idAt("pov: sera-voss", 7)).toEqual({ text: "sera-voss", start: 5, end: 14 });
    expect(idAt("[Sera](../characters/sera-voss.md)", 25)).toEqual({ text: "sera-voss", start: 21, end: 30 });
    expect(idAt("Sera Voss", 2)).toBeNull();
    expect(idAt("", 0)).toBeNull();
  });

  test("tokenColumns finds a token only where it stands alone", () => {
    expect(tokenColumns("sera, sera-voss, sera", "sera")).toEqual([0, 17]);
    expect(tokenColumns("nothing here", "sera")).toEqual([]);
  });

  test("lineKey, lineRange, and range", () => {
    expect(lineKey("  - character: sera")).toBe("character");
    expect(lineKey("plain text")).toBeNull();
    expect(lineRange(["a", "  indented"], 5)).toEqual(range(1, 2, 1, 10));
    expect(lineRange(["first"], -3)).toEqual(range(0, 0, 0, 5));
  });
});

describe("lsp list items, links, and edits", () => {
  const lines = textLines([
    "---",
    "title: x",
    "progressions:",
    "  - from: chapter-02",
    "    field: arc",
    '    value: "the-arc"',
    "  - from: chapter-03",
    "characters:",
    "  - sera",
    "nested:",
    "  inner: x",
    "---"
  ].join("\n"));
  const end = frontmatterEnd(lines);

  test("listItemAt finds the item a line is in, and the list it is under", () => {
    const item = listItemAt(lines, 4, end);
    expect(item).toEqual({ listKey: "progressions", lines: [3, 4, 5] });
    expect(listItemAt(lines, 6, end)).toEqual({ listKey: "progressions", lines: [6] });
    expect(listItemAt(lines, 8, end)).toEqual({ listKey: "characters", lines: [8] });
    expect(listItemAt(lines, 10, end)).toBeNull();
    expect(listItemAt(lines, 1, end)).toBeNull();
    expect(listItemAt(textLines("---\n- loose\n---"), 1, 2)).toEqual({ listKey: null, lines: [1] });
    expect(itemField(lines, item, "value")).toBe("the-arc");
    expect(itemField(lines, item, "missing")).toBeNull();
  });

  test("linkTargetAt reads inline links and link definitions", () => {
    const line = "See [a](../x/sera.md) and [b](z.md)";
    expect(linkTargetAt(line, line.indexOf("sera"))).toBe("../x/sera.md");
    expect(linkTargetAt(line, line.indexOf("z.md"))).toBe("z.md");
    expect(linkTargetAt(line, 1)).toBeNull();
    expect(linkTargetAt("[sera]: ../characters/sera.md", 12)).toBe("../characters/sera.md");
  });

  test("minimalEdit changes only what differs, splitting no pair or line end", () => {
    const cases = [["abc", "abXc"], ["a\r\nb", "a\rc"], ["\uD83D\uDE00a", "\uD83D\uDE01a"], ["\uD83D\uDE00", "\uD83E\uDE00"], ["a\r\n", "b\n"], ["same", "same"]];
    for (const [before, after] of cases) {
      expect(applyEdit(before, minimalEdit(before, after))).toBe(after);
    }
    expect(minimalEdit("abc", "abXc")).toEqual({ range: range(0, 2, 0, 2), newText: "X" });
    expect(minimalEdit("a\r\nb", "a\rc").range.start).toEqual({ line: 0, character: 1 });
    expect(minimalEdit("\uD83D\uDE00a", "\uD83D\uDE01a").range).toEqual(range(0, 0, 0, 2));
    expect(minimalEdit("\uD83D\uDE00", "\uD83E\uDE00").range).toEqual(range(0, 0, 0, 2));
    expect(minimalEdit("a\r\n", "b\n")).toEqual({ range: range(0, 0, 1, 0), newText: "b\n" });
  });
});

describe("finding locations", () => {
  const text = [
    "---",
    "pov: jonas-reed",
    "characters:",
    "  - jonas-reed",
    "knowledge-state:",
    "  - character: jonas-reed",
    "    knows: the page",
    "    learned-in: chapter-05",
    "  - character: nessa-thorn",
    "    status: active",
    "status: draft",
    "---",
    "",
    "See [Edran](../characters/edran-vale.md) at chapter-09."
  ].join("\n");
  const at = (message) => findingRange(text, { code: "x", message: `chapters/a.md ${message}`, file: "chapters/a.md", chapter: null });

  test("a parse error points at the line it names", () => {
    expect(at("has invalid frontmatter (line 3): bad")).toEqual(range(2, 0, 2, 11));
  });

  test("an id points where it is written, frontmatter before body", () => {
    expect(at("lists jonas-reed, who died")).toEqual(range(1, 5, 1, 15));
    expect(at("links to edran-vale")).toEqual(range(13, 26, 13, 36));
  });

  test("a plain word counts only as a key", () => {
    expect(at("has no status")).toEqual(range(9, 4, 9, 10));
    expect(at("knows nothing of the page")).toEqual(range(6, 4, 6, 9));
  });

  test("a field path points inside its list item", () => {
    expect(at("knowledge-state[0] references missing chapter chapter-05")).toEqual(range(7, 16, 7, 26));
    expect(at("knowledge-state[1] status active conflicts")).toEqual(range(9, 4, 9, 10));
    expect(at("knowledge-state[1] says nothing findable")).toEqual(range(8, 2, 8, 26));
    expect(at("knowledge-state[7] is out of range")).toEqual(range(0, 0, 0, 3));
    expect(at("missing-key[0] then pov")).toEqual(range(1, 0, 1, 3));
  });

  test("a backslash link points at the whole target", () => {
    const linked = "---\ntitle: x\n---\n\nSee [Sera](..\\characters\\sera-voss.md).";
    const finding = { code: "link-backslash", message: "chapters/a.md links to ..\\characters\\sera-voss.md with a backslash; write ../characters/sera-voss.md so the link works on every system", file: "chapters/a.md", chapter: null };
    expect(findingRange(linked, finding)).toEqual(range(4, 11, 4, 37));
  });

  test("a command hint names no place, and an unplaceable finding is the first line", () => {
    expect(at("is stale: run story reindex")).toEqual(range(0, 0, 0, 3));
    expect(at("has 12 problems")).toEqual(range(0, 0, 0, 3));
  });

  test("findingMessage drops the file label the editor already shows", () => {
    expect(findingMessage({ message: "story.md: Unclosed frontmatter", file: "story.md" })).toBe("Unclosed frontmatter");
    expect(findingMessage({ message: "chapters/a.md lists x", file: "chapters/a.md" })).toBe("lists x");
    expect(findingMessage({ message: "chapters/a.md", file: "chapters/a.md" })).toBe("chapters/a.md");
    expect(findingMessage({ message: "Project problem", file: null })).toBe("Project problem");
    expect(findingMessage({ message: "Other wording", file: "chapters/a.md" })).toBe("Other wording");
  });
});

describe("lsp transport", () => {
  test("reads messages however the input is split", () => {
    const received = [];
    const problems = [];
    const read = messageReader((message) => received.push(message), (problem) => problems.push(problem));
    const bytes = Buffer.concat([encodeMessage({ id: 1, text: "Séra" }), encodeMessage({ id: 2 })]);
    for (let index = 0; index < bytes.length; index += 7) {
      read(bytes.subarray(index, index + 7));
    }
    expect(received).toEqual([{ id: 1, text: "Séra" }, { id: 2 }]);
    expect(problems).toEqual([]);
  });

  test("skips a header with no length and a body that is not JSON", () => {
    const received = [];
    const problems = [];
    const read = messageReader((message) => received.push(message), (problem) => problems.push(problem));
    read(Buffer.from("X-Other: 1\r\n\r\nContent-Length: 3\r\n\r\n{x}", "ascii"));
    read(encodeMessage({ ok: true }));
    expect(received).toEqual([{ ok: true }]);
    expect(problems[0]).toBe('Skipped a message header with no Content-Length: "X-Other: 1"');
    expect(problems[1]).toStartWith("Skipped a message that is not JSON: ");
  });
});

describe("open documents", () => {
  test("stand in for the file on disk, within the read limit", () => {
    const file = path.join(makeTempDir(), "a.md");
    fs.writeFileSync(file, "disk");
    expect(withOpenDocuments(new Map([[file, "open"]]), () => readFileBytes(file).toString())).toBe("open");
    expect(readFileBytes(file).toString()).toBe("disk");
    expect(() => withOpenDocuments(new Map([[file, "longer than four"]]), () => readFileBytes(file, SMALL_READ_LIMIT))).toThrow("Refusing to read oversized file: 16 bytes exceeds the 4 byte limit");
  });
});

describe("project discovery", () => {
  test("uriPath reads file uris only", () => {
    expect(uriPath(pathToFileURL("/tmp/a.md").href)).toBe(path.resolve("/tmp/a.md"));
    expect(uriPath("untitled:Untitled-1")).toBeNull();
    expect(uriPath(undefined)).toBeNull();
  });

  test("projectRootOf finds the nearest story.md", () => {
    const root = storyProject();
    expect(projectRootOf(path.join(root, "chapters", "chapter-01.md"))).toBe(root);
    expect(projectRootOf(path.join(path.dirname(root), "loose.md"))).toBeNull();
  });

  test("projectsIn finds the enclosing project, or the projects below", () => {
    const root = storyProject();
    expect(projectsIn(path.join(root, "chapters"))).toEqual([root]);
    const workspace = makeTempDir("story-lsp-workspace-");
    for (const folder of ["books/one", "books/two", ".hidden/three", "node_modules/four", "a/b/c/d/too-deep"]) {
      fs.mkdirSync(path.join(workspace, folder), { recursive: true });
      fs.writeFileSync(path.join(workspace, folder, "story.md"), "---\ntitle: x\n---\n");
    }
    fs.writeFileSync(path.join(workspace, "notes.md"), "");
    expect(projectsIn(workspace)).toEqual([path.join(workspace, "books", "one"), path.join(workspace, "books", "two")]);
    expect(projectsIn(path.join(workspace, "missing"))).toEqual([]);
  });

  test("projectsIn stops at its cap", () => {
    const workspace = makeTempDir("story-lsp-many-");
    for (let index = 0; index <= PROJECT_CAP; index += 1) {
      const folder = path.join(workspace, `book-${String(index).padStart(2, "0")}`);
      fs.mkdirSync(folder);
      fs.writeFileSync(path.join(folder, "story.md"), "");
    }
    expect(projectsIn(workspace)).toHaveLength(PROJECT_CAP);
  });
});

describe("language server diagnostics", () => {
  test("checks each workspace project when the editor starts", () => {
    const root = storyProject();
    const client = startServer({ folders: [path.dirname(root)] });
    const chapter = client.diagnostics(root, "chapters/chapter-04.md");
    const text = fs.readFileSync(path.join(root, "chapters/chapter-04.md"), "utf8");
    expect(chapter).toContainEqual({
      range: { start: at(text, "edran-vale"), end: at(text, "edran-vale", "edran-vale".length) },
      severity: SEVERITY_ERROR,
      code: "posthumous-appearance",
      source: "story",
      message: "lists edran-vale, who died in chapter-02; move posthumous appearances to mentions"
    });
    expect(client.diagnostics(root, "chapters/chapter-03.md").map((diagnostic) => [diagnostic.code, diagnostic.severity])).toEqual([["pov-not-in-cast", SEVERITY_WARNING]]);
  });

  test("checks unsaved text, at once on open and after a pause while typing", () => {
    const root = storyProject();
    const client = startServer({ folders: [root] });
    const file = "chapters/chapter-03.md";
    const text = client.open(root, file);
    expect(client.diagnostics(root, file)).toHaveLength(1);
    const fixed = text.replace("characters:\n", "characters:\n  - nessa-thorn\n");
    const change = (newText, version) => client.notify("textDocument/didChange", { textDocument: { uri: uri(root, file), version }, contentChanges: [{ text: newText }] });
    change(fixed, 2);
    change(fixed, 3);
    expect(client.timers.map((timer) => timer.delay)).toEqual([CHECK_DELAY_MS, CHECK_DELAY_MS]);
    expect(client.cancelled).toContain(1);
    expect(client.diagnostics(root, file)).toHaveLength(1);
    client.timers.at(-1).run();
    expect(client.diagnostics(root, file)).toEqual([]);
    client.notify("textDocument/didChange", { textDocument: { uri: uri(root, file), version: 4 }, contentChanges: [] });
    client.notify("textDocument/didChange", { textDocument: { uri: uri(root, "chapters/unopened.md"), version: 1 }, contentChanges: [{ text: "" }] });
    expect(client.timers).toHaveLength(2);
    client.notify("textDocument/didClose", { textDocument: { uri: uri(root, file) } });
    expect(client.diagnostics(root, file)).toHaveLength(1);
  });

  test("checks again on save and on file changes, and clears a project that is gone", () => {
    const root = storyProject();
    const client = startServer({ folders: [root] });
    const file = "chapters/chapter-03.md";
    edit(root, file, (text) => text.replace("characters:\n", "characters:\n  - nessa-thorn\n"));
    client.notify("textDocument/didSave", { textDocument: { uri: uri(root, file) } });
    expect(client.diagnostics(root, file)).toEqual([]);
    edit(root, file, (text) => text.replace("  - nessa-thorn\n", ""));
    client.notify("workspace/didChangeWatchedFiles", { changes: [{ uri: uri(root, file), type: 2 }, { uri: "untitled:x", type: 1 }, { uri: pathToFileURL("/outside-any-story/a.md").href, type: 1 }] });
    expect(client.diagnostics(root, file)).toHaveLength(1);
    fs.rmSync(path.join(root, "story.md"));
    client.notify("workspace/didChangeWatchedFiles", { changes: [{ uri: uri(root, "story.md"), type: 3 }] });
    expect(client.diagnostics(root, file)).toEqual([]);
    expect(client.diagnostics(root, "chapters/chapter-04.md")).toEqual([]);
  });

  test("follows workspace folders as they are added and removed", () => {
    const root = storyProject();
    const client = startServer();
    const file = "chapters/chapter-03.md";
    expect(client.diagnostics(root, file)).toBeUndefined();
    const folder = { uri: pathToFileURL(path.dirname(root)).href, name: "books" };
    client.notify("workspace/didChangeWorkspaceFolders", { event: { added: [folder, { uri: "untitled:x" }], removed: [] } });
    expect(client.diagnostics(root, file)).toHaveLength(1);
    client.notify("workspace/didChangeWorkspaceFolders", { event: { added: [], removed: [{ uri: "untitled:x" }, folder] } });
    expect(client.diagnostics(root, file)).toEqual([]);
  });

  test("checks a new file before it is saved", () => {
    const root = storyProject();
    const client = startServer({ folders: [root] });
    const file = "characters/mara-quill.md";
    const text = client.open(root, file, "---\nname: Mara Quill\nrole: supporting\nstatus: alive\nlocations:\n  - nowhere-at-all\n---\n\n# Mara Quill\n");
    const missing = client.diagnostics(root, file).find((diagnostic) => diagnostic.message.includes("nowhere-at-all"));
    expect(missing.range.start).toEqual(at(text, "nowhere-at-all"));
    expect(client.diagnostics(root, "characters/_index.md").map((diagnostic) => diagnostic.code)).toContain("stale-registry");
    expect(fs.existsSync(path.join(root, file))).toBe(false);
  });

  test("keeps a removed folder's project that another folder or an open document holds", () => {
    const root = storyProject();
    const chapters = path.join(root, "chapters");
    const folder = (dir) => ({ uri: pathToFileURL(dir).href, name: path.basename(dir) });
    const changeFolders = (client, added, removed) => client.notify("workspace/didChangeWorkspaceFolders", { event: { added: added.map(folder), removed: removed.map(folder) } });
    const file = "chapters/chapter-03.md";
    const client = startServer({ folders: [path.dirname(root), root] });
    changeFolders(client, [], [path.dirname(root)]);
    expect(client.diagnostics(root, file)).toHaveLength(1);
    changeFolders(client, [chapters], [root]);
    expect(client.diagnostics(root, file)).toHaveLength(1);
    client.open(root, "chapters/chapter-01.md");
    changeFolders(client, [], [chapters]);
    expect(client.diagnostics(root, file)).toHaveLength(1);

    const inside = startServer({ folders: [chapters] });
    expect(inside.diagnostics(root, file)).toHaveLength(1);
    changeFolders(inside, [], [chapters, path.join(root, "never-added")]);
    expect(inside.diagnostics(root, file)).toEqual([]);
  });

  test("applies story.md severity settings, and reports invalid ones", () => {
    const root = storyProject();
    edit(root, "story.md", (text) => text.replace("form: novel\n", "form: novel\nseverity:\n  - warning: pov-not-in-cast\n    level: error\n"));
    const client = startServer({ folders: [root] });
    expect(client.diagnostics(root, "chapters/chapter-03.md")[0].severity).toBe(SEVERITY_ERROR);
    edit(root, "story.md", (text) => text.replace("level: error", "level: loud"));
    client.notify("textDocument/didSave", { textDocument: { uri: uri(root, "story.md") } });
    expect(client.diagnostics(root, "chapters/chapter-03.md")[0].severity).toBe(SEVERITY_WARNING);
    expect(client.diagnostics(root, "story.md").some((diagnostic) => diagnostic.severity === SEVERITY_ERROR)).toBe(true);
  });

  test.skipIf(!SYMLINKS_SUPPORTED)("reports a project it cannot check on story.md", () => {
    const root = storyProject();
    const elsewhere = path.join(makeTempDir(), "characters");
    fs.renameSync(path.join(root, "characters"), elsewhere);
    fs.symlinkSync(elsewhere, path.join(root, "characters"), "dir");
    const client = startServer({ folders: [root] });
    const [diagnostic] = client.diagnostics(root, "story.md");
    expect(diagnostic.range).toEqual(range(0, 0));
    expect(diagnostic.message).toContain("symlink");
  });
});

describe("language server navigation", () => {
  test("goes to the file of the entity an id names", () => {
    const root = storyProject();
    const client = startServer();
    const text = client.open(root, "chapters/chapter-02.md");
    expect(client.result("textDocument/definition", { textDocument: { uri: uri(root, "chapters/chapter-02.md") }, position: at(text, "jonas-reed", 2) })).toEqual([{ uri: uri(root, "characters/jonas-reed.md"), range: range(0, 0) }]);
    expect(client.result("textDocument/definition", { textDocument: { uri: uri(root, "chapters/chapter-02.md") }, position: at(text, "draft", 1) })).toBeNull();
    expect(client.result("textDocument/definition", { textDocument: { uri: uri(root, "chapters/chapter-02.md") }, position: at(text, "Edran Vale", 1) })).toBeNull();
    expect(client.result("textDocument/definition", { textDocument: { uri: "untitled:x" }, position: { line: 0, character: 0 } })).toBeNull();
    expect(client.result("textDocument/definition", { textDocument: { uri: uri(root, "chapters/missing.md") }, position: { line: 0, character: 0 } })).toBeNull();
  });

  test("finds the fields and links that name an entity", () => {
    const root = storyProject();
    const client = startServer();
    edit(root, "chapters/chapter-01.md", (text) => `${text}\nSee [Edran](../characters/edran-vale.md); edran-vale in prose is not a reference.\n`);
    const text = client.open(root, "chapters/chapter-02.md");
    const params = { textDocument: { uri: uri(root, "chapters/chapter-02.md") }, position: at(text, "edran-vale", 1) };
    const found = client.result("textDocument/references", params);
    const chapterOne = found.filter((location) => location.uri === uri(root, "chapters/chapter-01.md"));
    expect(chapterOne.length).toBeGreaterThan(0);
    const chapterOneText = fs.readFileSync(path.join(root, "chapters/chapter-01.md"), "utf8");
    expect(chapterOne.at(-1).range.start).toEqual(at(chapterOneText, "edran-vale.md"));
    expect(found).toContainEqual({ uri: uri(root, "chapters/chapter-02.md"), range: { start: at(text, "edran-vale"), end: at(text, "edran-vale", "edran-vale".length) } });
    expect(found.some((location) => location.uri === uri(root, "characters/edran-vale.md"))).toBe(false);
    const withDeclaration = client.result("textDocument/references", { ...params, context: { includeDeclaration: true } });
    expect(withDeclaration[0]).toEqual({ uri: uri(root, "characters/edran-vale.md"), range: range(0, 0) });
    expect(client.result("textDocument/references", { ...params, position: { line: 0, character: 0 } })).toBeNull();
  });

  test("hover shows the entity, and its state at the document's chapter", () => {
    const root = storyProject();
    const client = startServer();
    const chapterTwo = client.open(root, "chapters/chapter-02.md");
    const hover = client.result("textDocument/hover", { textDocument: { uri: uri(root, "chapters/chapter-02.md") }, position: at(chapterTwo, "jonas-reed", 1) });
    expect(hover.range).toEqual({ start: at(chapterTwo, "jonas-reed"), end: at(chapterTwo, "jonas-reed", "jonas-reed".length) });
    expect(hover.contents.kind).toBe("markdown");
    expect(hover.contents.value).toStartWith("**Jonas Reed** · character · `characters/jonas-reed.md`\n\nStatus: alive\n\nAt chapter-02:\n");
    expect(hover.contents.value).toContain("- Knows: which ledger page names the firestarter");
    expect(hover.contents.value).toContain("- whereabouts: The \\*millpond\\* bank (from chapter-02)");

    const scene = client.open(root, "scenes/chapter-01-scene-01.md");
    const sceneHover = client.result("textDocument/hover", { textDocument: { uri: uri(root, "scenes/chapter-01-scene-01.md") }, position: at(scene, "jonas-reed", 1) });
    expect(sceneHover.contents.value).toContain("At chapter-01:");
    expect(sceneHover.contents.value).not.toContain("whereabouts");

    const arcs = client.result("textDocument/hover", { textDocument: { uri: uri(root, "chapters/chapter-02.md") }, position: at(chapterTwo, "the-ledger-trail", 1) });
    expect(arcs.contents.value).not.toContain("At chapter-02");

    const state = client.open(root, "continuity/state.md");
    const stateHover = client.result("textDocument/hover", { textDocument: { uri: uri(root, "continuity/state.md") }, position: at(state, "jonas-reed", 1) });
    expect(stateHover.contents.value).not.toContain("At ");
    expect(client.result("textDocument/hover", { textDocument: { uri: uri(root, "continuity/state.md") }, position: { line: 0, character: 0 } })).toBeNull();
  });

  test("hover leaves out state the project cannot work out", () => {
    const root = storyProject();
    edit(root, "characters/edran-vale.md", (text) => text.replace(/^status: .*$/m, 'status: ""'));
    const client = startServer();
    const text = client.open(root, "chapters/chapter-02.md");
    const edran = client.result("textDocument/hover", { textDocument: { uri: uri(root, "chapters/chapter-02.md") }, position: at(text, "edran-vale", 1) });
    expect(edran.contents.value).toBe("**Edran Vale** · character · `characters/edran-vale.md`");
    client.open(root, "chapters/chapter-01.md", "---\ntitle: [unclosed\n---\n");
    const jonas = client.result("textDocument/hover", { textDocument: { uri: uri(root, "chapters/chapter-02.md") }, position: at(text, "jonas-reed", 1) });
    expect(jonas.contents.value).toBe("**Jonas Reed** · character · `characters/jonas-reed.md`\n\nStatus: alive");
  });

  test("reads an id in a list item by the list it is in", () => {
    const root = storyProject();
    edit(root, "characters/jonas-reed.md", (text) => text.replace("progressions:\n", "progressions:\n  - from: chapter-03\n    field: status\n    value: missing\n  - from: chapter-03\n    field: arc\n    value: the-ledger-trail\n"));
    const client = startServer();
    const jonasFile = "characters/jonas-reed.md";
    const jonas = client.open(root, jonasFile);
    const jonasDocument = { textDocument: { uri: uri(root, jonasFile) } };
    expect(client.result("textDocument/definition", { ...jonasDocument, position: at(jonas, "value: the-ledger-trail", 10) })).toEqual([{ uri: uri(root, "plot/arcs/the-ledger-trail.md"), range: range(0, 0) }]);
    expect(client.result("textDocument/completion", { ...jonasDocument, position: at(jonas, "from: chapter-03", 10) }).map((item) => item.label)).toEqual(["chapter-01", "chapter-02", "chapter-03", "chapter-04"]);
    expect(client.result("textDocument/completion", { ...jonasDocument, position: at(jonas, "value: missing", 10) })).toEqual([]);

    const chapterThree = client.open(root, "chapters/chapter-03.md");
    const hover = client.result("textDocument/hover", { textDocument: { uri: uri(root, "chapters/chapter-03.md") }, position: at(chapterThree, "jonas-reed", 1) });
    expect(hover.contents.value).toContain("Status: missing\n");
    expect(hover.contents.value).toContain("- status: missing (from chapter-03)");

    const arc = client.open(root, "plot/arcs/the-ledger-trail.md");
    const found = client.result("textDocument/references", { textDocument: { uri: uri(root, "chapters/chapter-03.md") }, position: at(chapterThree, "the-ledger-trail", 1) });
    expect(found).toContainEqual({ uri: uri(root, jonasFile), range: { start: at(jonas, "the-ledger-trail"), end: at(jonas, "the-ledger-trail", "the-ledger-trail".length) } });
    expect(arc).toBeDefined();

    const millFile = "worldbuilding/locations/the-mill-row.md";
    const mill = client.open(root, millFile, fs.readFileSync(path.join(root, millFile), "utf8").replace("tags: []\n", "tags: []\nroutes:\n  - to: the-\nto: the-\n"));
    expect(client.result("textDocument/completion", { textDocument: { uri: uri(root, millFile) }, position: at(mill, "  - to: the-", 12) }).map((item) => item.label)).toEqual(["the-mill-row"]);
    expect(client.result("textDocument/completion", { textDocument: { uri: uri(root, millFile) }, position: at(mill, "\nto: the-", 9) })).toEqual([]);

    const chapterTwoFile = "chapters/chapter-02.md";
    const chapterTwo = client.open(root, chapterTwoFile, fs.readFileSync(path.join(root, chapterTwoFile), "utf8").replace("status: draft\n", "status: draft\nchoices:\n  - text: Run\n    to: chapter-03\n"));
    expect(client.result("textDocument/definition", { textDocument: { uri: uri(root, chapterTwoFile) }, position: at(chapterTwo, "to: chapter-03", 6) })).toEqual([{ uri: uri(root, "chapters/chapter-03.md"), range: range(0, 0) }]);
  });

  test("counts a link only when it resolves to the entity's file", () => {
    const root = storyProject();
    fs.mkdirSync(path.join(root, "notes"));
    fs.writeFileSync(path.join(root, "notes", "edran-vale.md"), "# Notes on Edran\n");
    edit(root, "chapters/chapter-01.md", (text) => `${text}\n[Notes](../notes/edran-vale.md), [Edran][e], [web](https://example.com/edran-vale.md)\n\n[e]: ../characters/edran-vale.md\n`);
    const client = startServer();
    const chapterOneFile = "chapters/chapter-01.md";
    const chapterOne = client.open(root, chapterOneFile);
    const chapterOneDocument = { textDocument: { uri: uri(root, chapterOneFile) } };
    const chapterTwo = client.open(root, "chapters/chapter-02.md");
    const found = client.result("textDocument/references", { textDocument: { uri: uri(root, "chapters/chapter-02.md") }, position: at(chapterTwo, "edran-vale", 1) })
      .filter((location) => location.uri === uri(root, chapterOneFile)).map((location) => location.range.start);
    expect(found).toContainEqual(at(chapterOne, "characters/edran-vale.md", "characters/".length));
    expect(found).not.toContainEqual(at(chapterOne, "notes/edran-vale.md", "notes/".length));
    expect(found).not.toContainEqual(at(chapterOne, "example.com/edran-vale.md", "example.com/".length));
    expect(client.result("textDocument/definition", { ...chapterOneDocument, position: at(chapterOne, "notes/edran-vale.md", 7) })).toBeNull();
    expect(client.result("textDocument/definition", { ...chapterOneDocument, position: at(chapterOne, "[e]: ../characters/edran-vale.md", 20) })).toEqual([{ uri: uri(root, "characters/edran-vale.md"), range: range(0, 0) }]);
    expect(client.result("textDocument/prepareRename", { ...chapterOneDocument, position: at(chapterOne, "[e]: ../characters/edran-vale.md", 20) }).placeholder).toBe("edran-vale");
    expect(client.result("textDocument/prepareRename", { ...chapterOneDocument, position: at(chapterOne, "example.com/edran-vale.md", 14) })).toBeNull();
  });

  test("completes ids of the kinds a field takes", () => {
    const root = storyProject();
    const client = startServer();
    const text = client.open(root, "chapters/chapter-02.md");
    const position = at(text, "jonas-reed", 3);
    const items = client.result("textDocument/completion", { textDocument: { uri: uri(root, "chapters/chapter-02.md") }, position });
    expect(items.map((item) => item.label)).toEqual(["edran-vale", "jonas-reed", "nessa-thorn"]);
    expect(items[1]).toEqual({ label: "jonas-reed", kind: COMPLETION_REFERENCE, detail: "character: Jonas Reed", textEdit: { range: { start: at(text, "jonas-reed"), end: position }, newText: "jonas-reed" } });
    expect(client.result("textDocument/completion", { textDocument: { uri: uri(root, "chapters/chapter-02.md") }, position: at(text, "draft", 2) })).toEqual([]);
    expect(client.result("textDocument/completion", { textDocument: { uri: "untitled:x" }, position: { line: 0, character: 0 } })).toEqual([]);
    expect(client.result("textDocument/completion", { textDocument: { uri: uri(root, "chapters/chapter-02.md") }, position: { line: 99, character: 0 } })).toEqual([]);
  });
});

describe("language server edits", () => {
  test("renames an entity's name, and its id and file with it", () => {
    const root = storyProject();
    const client = startServer({ capabilities: FULL_EDITS });
    const text = client.open(root, "chapters/chapter-02.md");
    const params = { textDocument: { uri: uri(root, "chapters/chapter-02.md") }, position: at(text, "edran-vale", 1) };
    expect(client.result("textDocument/prepareRename", params)).toEqual({ range: { start: at(text, "edran-vale"), end: at(text, "edran-vale", "edran-vale".length) }, placeholder: "edran-vale" });
    const { documentChanges } = client.result("textDocument/rename", { ...params, newName: "Edran Vane" });
    expect(documentChanges).toContainEqual({ kind: "delete", uri: uri(root, "characters/edran-vale.md"), options: { ignoreIfNotExists: true } });
    expect(documentChanges).toContainEqual({ kind: "create", uri: uri(root, "characters/edran-vane.md"), options: { ignoreIfExists: true } });
    const chapterEdit = documentChanges.find((change) => change.textDocument?.uri === uri(root, "chapters/chapter-02.md"));
    expect(chapterEdit.textDocument.version).toBe(1);
    expect(applyEdit(text, chapterEdit.edits[0])).toBe(text.replace("  - edran-vale\n", "  - edran-vane\n"));
    const unopened = documentChanges.find((change) => change.textDocument?.uri === uri(root, "chapters/chapter-04.md"));
    expect(unopened.textDocument.version).toBeNull();
    const created = documentChanges.find((change) => change.textDocument?.uri === uri(root, "characters/edran-vane.md"));
    expect(created.edits[0]).toEqual({ range: range(0, 0), newText: expect.stringContaining("name: Edran Vane\n") });
    expect(fs.existsSync(path.join(root, "characters/edran-vale.md"))).toBe(true);
  });

  test("a kebab-case new name is the new id, and the name stays", () => {
    const root = storyProject();
    const client = startServer({ capabilities: FULL_EDITS });
    const text = client.open(root, "chapters/chapter-02.md");
    const { documentChanges } = client.result("textDocument/rename", { textDocument: { uri: uri(root, "chapters/chapter-02.md") }, position: at(text, "edran-vale", 1), newName: "edran-the-elder" });
    const created = documentChanges.find((change) => change.textDocument?.uri === uri(root, "characters/edran-the-elder.md"));
    expect(created.edits[0].newText).toContain("name: Edran Vale");
  });

  test("refuses a rename it cannot make", () => {
    const root = storyProject();
    fs.writeFileSync(path.join(root, "worldbuilding/artifacts/jonas-reed.md"), "---\nname: Jonas Reed's Ledger\ntype: document\nstatus: active\n---\n\n# Ledger\n");
    const client = startServer();
    const text = client.open(root, "chapters/chapter-02.md");
    const failure = (position, method = "textDocument/rename") => client.request(method, { textDocument: { uri: uri(root, "chapters/chapter-02.md") }, position, newName: "x" }).error;
    expect(failure(at(text, "draft", 1))).toEqual({ code: ERROR_CODES.requestFailed, message: "Rename works on the id of a story entity in a frontmatter field or a link to its file" });
    expect(client.result("textDocument/prepareRename", { textDocument: { uri: uri(root, "chapters/chapter-02.md") }, position: at(text, "draft", 1) })).toBeNull();
    const state = client.open(root, "continuity/state.md");
    const prose = { textDocument: { uri: uri(root, "continuity/state.md") }, position: at(state, "| jonas-reed", 3) };
    expect(client.result("textDocument/prepareRename", prose)).toBeNull();
    expect(client.result("textDocument/hover", prose).contents.value).toContain("**Jonas Reed's Ledger**");
    const mentions = client.open(root, "chapters/chapter-01.md", fs.readFileSync(path.join(root, "chapters/chapter-01.md"), "utf8").replace("status:", "mentions:\n  - jonas-reed\nstatus:"));
    expect(client.request("textDocument/rename", { textDocument: { uri: uri(root, "chapters/chapter-01.md") }, position: at(mentions, "mentions:\n  - jonas-reed", 16), newName: "x" }).error.message).toBe("jonas-reed is the id of more than one entity (character, artifact): rename it from a field that takes one kind, or with story rename");
    const scene = client.open(root, "scenes/chapter-02-scene-01.md");
    expect(client.request("textDocument/rename", { textDocument: { uri: uri(root, "scenes/chapter-02-scene-01.md") }, position: at(scene, "chapter-02", 1), newName: "x" }).error.message).toBe("A chapter id follows its number: renumber it with story move");
    expect(client.request("textDocument/rename", { textDocument: { uri: "untitled:x" }, position: { line: 0, character: 0 }, newName: "x" }).error.code).toBe(ERROR_CODES.requestFailed);
  });

  test("a rename that moves files needs an editor that can", () => {
    const root = storyProject();
    const client = startServer();
    const text = client.open(root, "chapters/chapter-02.md");
    expect(client.request("textDocument/rename", { textDocument: { uri: uri(root, "chapters/chapter-02.md") }, position: at(text, "edran-vale", 1), newName: "Edran Vane" }).error.message).toBe("This change needs to delete and create files, which this editor cannot do in an edit: run the story command in a terminal instead");
  });

  test("offers quick fixes for stale word counts and registries", () => {
    const root = storyProject();
    fs.writeFileSync(path.join(root, "characters/mara-quill.md"), "---\nname: Mara Quill\nrole: supporting\nstatus: alive\n---\n\n# Mara Quill\n");
    const client = startServer({ folders: [root] });
    const chapter = "chapters/chapter-02.md";
    const text = client.open(root, chapter, fs.readFileSync(path.join(root, chapter), "utf8").replace("said nothing", "said nothing at all, not one word,"));
    const wordCount = client.diagnostics(root, chapter).find((diagnostic) => diagnostic.code === "stale-word-count");
    expect(wordCount).toBeDefined();
    const registry = client.diagnostics(root, "characters/_index.md").find((diagnostic) => diagnostic.code === "stale-registry");
    expect(registry).toBeDefined();

    const [fix] = client.result("textDocument/codeAction", { textDocument: { uri: uri(root, chapter) }, range: wordCount.range, context: { diagnostics: [wordCount, { ...wordCount, source: "other" }] } });
    expect(fix.title).toBe("Update word counts (story wordcount --write)");
    expect(fix.kind).toBe("quickfix");
    expect(fix.diagnostics).toEqual([wordCount]);
    const edited = applyEdit(text, fix.edit.changes[uri(root, chapter)][0]);
    expect(edited).toBe(text.replace(/^word-count: 31$/m, edited.match(/^word-count: \d+$/m)[0]));
    expect(edited).not.toContain("word-count: 31\n");

    const [rebuild] = client.result("textDocument/codeAction", { textDocument: { uri: uri(root, "characters/_index.md") }, range: registry.range, context: { diagnostics: [registry] } });
    expect(applyEdit(fs.readFileSync(path.join(root, "characters/_index.md"), "utf8"), rebuild.edit.changes[uri(root, "characters/_index.md")][0])).toContain("mara-quill");
    expect(client.result("textDocument/codeAction", { textDocument: { uri: uri(root, chapter) }, range: range(0, 0) })).toEqual([]);
    expect(client.result("textDocument/codeAction", { textDocument: { uri: "untitled:x" }, range: range(0, 0), context: { diagnostics: [registry] } })).toEqual([]);
  });

  test("shows a fix the editor cannot apply as disabled, and still answers", () => {
    const root = storyProject();
    fs.rmSync(path.join(root, "characters/_index.md"));
    const client = startServer();
    const chapter = "chapters/chapter-02.md";
    const diagnostic = (code) => ({ range: range(0, 0), severity: SEVERITY_WARNING, code, source: "story", message: code });
    const actions = client.result("textDocument/codeAction", { textDocument: { uri: uri(root, chapter) }, range: range(0, 0), context: { diagnostics: [diagnostic("stale-registry"), diagnostic("stale-word-count")] } });
    const reason = "This change needs to create files, which this editor cannot do in an edit: run the story command in a terminal instead";
    expect(actions.map((action) => [action.title, action.disabled?.reason])).toEqual([
      ["Rebuild registries (story reindex)", reason],
      ["Update word counts (story wordcount --write)", reason]
    ]);
    expect(actions.every((action) => action.edit === undefined)).toBe(true);
  });

  test("leaves the edit for the editor to resolve when it can", () => {
    const root = storyProject();
    const client = startServer({ capabilities: { ...FULL_EDITS, textDocument: { codeAction: { resolveSupport: { properties: ["edit"] } } } } });
    const chapter = "chapters/chapter-02.md";
    client.open(root, chapter, fs.readFileSync(path.join(root, chapter), "utf8").replace("said nothing", "said nothing at all"));
    const diagnostic = { range: range(0, 0), severity: SEVERITY_WARNING, code: "stale-word-count", source: "story", message: "stale" };
    const [action] = client.result("textDocument/codeAction", { textDocument: { uri: uri(root, chapter) }, range: range(0, 0), context: { diagnostics: [diagnostic] } });
    expect(action.edit).toBeUndefined();
    expect(action.data).toEqual({ root, code: "stale-word-count" });
    const resolved = client.result("codeAction/resolve", action);
    expect(resolved.edit.documentChanges.map((change) => change.textDocument)).toContainEqual({ uri: uri(root, chapter), version: 1 });
    expect(client.request("codeAction/resolve", { ...action, data: { root, code: "toString" } }).error.message).toBe("Not a story quick fix");
    expect(client.request("codeAction/resolve", { title: "x" }).error.message).toBe("Not a story quick fix");
  });
});

describe("language server protocol", () => {
  test("initializes from rootUri, or from nothing", () => {
    const root = storyProject();
    const sent = [];
    const server = createLanguageServer({ send: (message) => sent.push(message), exit() {} });
    server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { capabilities: {}, rootUri: pathToFileURL(root).href } });
    expect(sent[0].result.capabilities.renameProvider).toEqual({ prepareProvider: true });
    expect(sent[0].result.serverInfo.name).toBe("story");
    server.handle({ jsonrpc: "2.0", method: "initialized" });
    expect(sent.some((message) => message.method === "textDocument/publishDiagnostics")).toBe(true);
    const bare = createLanguageServer({ send: (message) => sent.push(message), exit() {} });
    bare.handle({ jsonrpc: "2.0", id: 2, method: "initialize" });
    bare.handle({ jsonrpc: "2.0", id: 3, method: "initialize", params: { workspaceFolders: [{ uri: "untitled:x" }] } });
    expect(sent.filter((message) => message.id === 2 || message.id === 3).every((message) => message.result.capabilities !== undefined)).toBe(true);
  });

  test("watches markdown files when the editor lets it register", () => {
    const client = startServer({ capabilities: { workspace: { didChangeWatchedFiles: { dynamicRegistration: true } } } });
    const registration = client.sent.find((message) => message.method === "client/registerCapability");
    expect(registration.id).toBe("story-register-1");
    expect(registration.params.registrations[0].registerOptions).toEqual({ watchers: [{ globPattern: "**/*.md" }] });
    const before = client.sent.length;
    client.server.handle({ jsonrpc: "2.0", id: "story-register-1", result: null });
    expect(client.sent).toHaveLength(before);
  });

  test("answers unknown methods and failed handlers with errors, and logs failed notifications", () => {
    const client = startServer();
    expect(client.request("textDocument/formatting", {}).error).toEqual({ code: ERROR_CODES.methodNotFound, message: "story lsp does not handle textDocument/formatting" });
    expect(client.request("textDocument/hover", {}).error.code).toBe(ERROR_CODES.requestFailed);
    client.notify("textDocument/didChange", {});
    expect(client.sent.at(-1)).toEqual({ jsonrpc: "2.0", method: "window/logMessage", params: { type: LOG_ERROR, message: expect.stringMatching(/^story lsp: textDocument\/didChange failed: /) } });
    const before = client.sent.length;
    client.notify("$/cancelRequest", { id: 1 });
    client.notify("textDocument/didOpen", { textDocument: { uri: "untitled:x", text: "" } });
    client.notify("textDocument/didSave", { textDocument: { uri: "untitled:x" } });
    expect(client.sent).toHaveLength(before);
  });

  test("shuts down, then exits 0; exits 1 without a shutdown", () => {
    const root = storyProject();
    const client = startServer({ folders: [root] });
    const file = "chapters/chapter-03.md";
    const text = client.open(root, file);
    client.notify("textDocument/didChange", { textDocument: { uri: uri(root, file), version: 2 }, contentChanges: [{ text: `${text} ` }] });
    expect(client.result("shutdown")).toBeNull();
    expect(client.cancelled).toContain(client.timers.length);
    expect(client.request("textDocument/hover", {}).error).toEqual({ code: ERROR_CODES.invalidRequest, message: "story lsp is shutting down" });
    const before = client.sent.length;
    client.notify("textDocument/didSave", { textDocument: { uri: uri(root, file) } });
    expect(client.sent).toHaveLength(before);
    client.notify("exit");
    expect(client.exits).toEqual([0]);
    const abrupt = startServer();
    abrupt.notify("exit");
    expect(abrupt.exits).toEqual([1]);
  });
});

describe("story lsp", () => {
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const frames = (output) => {
    const messages = [];
    messageReader((message) => messages.push(message), () => {})(Buffer.from(output, "utf8"));
    return messages;
  };

  test("speaks the protocol on stdin and stdout until exit", async () => {
    const io = memoryIo(makeTempDir());
    const exits = [];
    io.exit = (code) => exits.push(code);
    expect(runCli(["lsp", "--stdio"], io)).toBe(0);
    io.stdin.write(encodeMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { capabilities: {} } }));
    io.stdin.write("Content-Length: 1\r\n\r\n{");
    io.stdin.write(encodeMessage({ jsonrpc: "2.0", id: 2, method: "shutdown" }));
    io.stdin.write(encodeMessage({ jsonrpc: "2.0", method: "exit" }));
    await settle();
    const messages = frames(io.output());
    expect(messages[0].result.serverInfo.name).toBe("story");
    expect(messages[1].params.message).toStartWith("story lsp: Skipped a message that is not JSON");
    expect(messages[2]).toEqual({ jsonrpc: "2.0", id: 2, result: null });
    expect(exits).toEqual([0]);
    expect(io.error()).toBe("");
  });

  test("exits 1 when the editor closes stdin without a shutdown", async () => {
    const io = memoryIo(makeTempDir());
    const exits = [];
    io.exit = (code) => exits.push(code);
    runCli(["lsp"], io);
    io.stdin.end();
    await settle();
    expect(exits).toEqual([1]);
  });

  test("takes no --path", () => {
    const io = memoryIo(makeTempDir());
    expect(runCli(["lsp", "--path", "."], io)).not.toBe(0);
    expect(io.error()).toContain("lsp takes no --path");
  });
});
