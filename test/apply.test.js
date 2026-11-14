import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { alignItems } from "../src/apply.js";
import { xmlText, zipEntries } from "../src/docx.js";
import { parseFrontmatter } from "../src/frontmatter.js";
import { writeZip } from "../src/packaging.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { UNDO_LOG, withUndoLog, writeFile } from "../src/files.js";
import { createHash } from "node:crypto";
import { expectLinearGrowth, git, makeTempDir, memoryIo, READONLY_IGNORED, treeSnapshot, whileWriting } from "./helpers.js";

const repoRoot = path.join(import.meta.dir, "..");
const EDITOR = 'w:author="Jane Editor" w:date="2026-10-30T10:00:00Z"';
const RESULT_SCHEMA = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));
const EXAMPLES = fs.readdirSync(path.join(repoRoot, "examples")).filter((name) => fs.existsSync(path.join(repoRoot, "examples", name, "story.md"))).sort();

function story(cwd, ...argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, stdout: io.output(), stderr: io.error() };
}

// A copy of an example and the Word file built from it, as the editor
// receives it: { root, dir, entries, xml, paragraphs, body }, where `body`
// holds the document's prose paragraphs in order. `args` are more build
// options, such as --shunn.
function sentBook({ example = "the-gull-rock-light", args = [], root: given = null } = {}) {
  const dir = given === null ? makeTempDir() : path.dirname(given);
  const root = given ?? path.join(dir, "book");
  if (given === null) {
    fs.cpSync(path.join(repoRoot, "examples", example), root, { recursive: true });
  }
  const out = path.join(dir, `sent${args.includes("--shunn") ? ".shunn" : ""}.docx`);
  expect(story(dir, "build", path.basename(root), "--format", "docx", "--out", out, ...args).code).toBe(0);
  const bytes = fs.readFileSync(out);
  const entries = [...zipEntries(bytes).values()].map((entry) => ({ name: entry.name, content: xmlText(bytes, entry) }));
  const xml = entries.find((entry) => entry.name === "word/document.xml").content;
  const paragraphs = [...xml.matchAll(/<w:p>(?:(?!<\/w:p>).)*<\/w:p>/gs)].map((match) => match[0]);
  const body = paragraphs.filter((paragraph) => (args.includes("--shunn")
    ? !paragraph.includes('w:jc w:val="center"') && !paragraph.includes('w:type="page"')
    : !paragraph.includes("w:pStyle")));
  return { root, dir, entries, xml, paragraphs, body, sent: out };
}

// The returned file: the sent document with `edit` applied to its XML, and
// any more parts given.
function returned(book, edit, { parts = [], name = "returned.docx" } = {}) {
  const entries = book.entries.map((entry) => (entry.name === "word/document.xml" ? { ...entry, content: edit(book.xml) } : entry));
  entries.push(...parts);
  const file = path.join(book.dir, name);
  writeZip(file, entries);
  return file;
}

// A copy of an example with chapter 1 changed by `edit` before the build.
function sentEdited(edit, { example = "the-gull-rock-light", args = [] } = {}) {
  const dir = makeTempDir();
  const root = path.join(dir, "book");
  fs.cpSync(path.join(repoRoot, "examples", example), root, { recursive: true });
  const file = path.join(root, "chapters", "chapter-01.md");
  fs.writeFileSync(file, edit(fs.readFileSync(file, "utf8")));
  return sentBook({ root, args });
}

// A plain paragraph of `text`, as Word writes one with no style.
function plain(text) {
  return `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

// The three prose paragraphs of the-gull-rock-light's chapter 1, as written.
const BOAT = "The supply boat backs off the landing before your boots are dry. The boatman does not wait for thanks. He has seen what you have seen: the lamp at the top of Gull Rock is dark, and the sun is already down.";
const CALL = "You call for Tobias Wren. The keeper you have come to relieve should be on the landing with a lantern and a list of complaints. The only answer is the sea working at the rocks.";
const DOOR = "The tower door stands open. A coil of rope lies across the path to the east ledge, where the rock drops to the water.";

// Chapter 1 of the-gull-rock-light with its prose replaced by `blocks`, as
// sentEdited takes it.
function proseOf(...blocks) {
  return (text) => text.replace(/## Chapter Text[\s\S]*$/, `## Chapter Text\n\n${blocks.join("\n\n")}\n`);
}

function xmlEscape(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// A paragraph of the build with its runs replaced by one run of `text`.
function withText(paragraph, text, runProperties = "") {
  const properties = /^<w:p>(<w:pPr>.*?<\/w:pPr>)?/s.exec(paragraph)[1] ?? "";
  return `<w:p>${properties}<w:r>${runProperties}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

// The body paragraph whose text holds `words`.
function paragraphWith(book, words) {
  const found = book.body.find((paragraph) => textIn(paragraph).includes(words));
  expect(found).toBeDefined();
  return found;
}

function textIn(paragraph) {
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return [...paragraph.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((match) => match[1]).join("").replace(/&(amp|lt|gt|quot|apos);/g, (whole, name) => entities[name]);
}

function chapter(book, number) {
  return fs.readFileSync(path.join(book.root, "chapters", `chapter-${String(number).padStart(2, "0")}.md`), "utf8");
}

function frontmatterOf(text) {
  const { body } = parseFrontmatter(text, "chapter");
  return text.slice(0, text.length - body.length);
}

// A --json run, checked against the result schema.
function applyJson(book, file, ...args) {
  const result = story(book.dir, "apply", file, "--path", "book", "--json", ...args);
  const json = JSON.parse(result.stdout);
  expect(validateAgainstSchema(json, RESULT_SCHEMA)).toEqual([]);
  return { ...result, json };
}

function codes(stderr) {
  return [...stderr.matchAll(/\[([a-z-]+)\]$/gm)].map((match) => match[1]);
}

// A whole paragraph cut as Word tracks it: its text and its break deleted.
function cutParagraph(paragraph) {
  return paragraph
    .replace(/^<w:p>(<w:pPr>)?/, (whole, properties) => (properties ? `<w:p><w:pPr><w:rPr><w:del w:id="40" ${EDITOR}/></w:rPr>` : `<w:p><w:pPr><w:rPr><w:del w:id="40" ${EDITOR}/></w:rPr></w:pPr>`) + `<w:del w:id="41" ${EDITOR}>`)
    .replace(/<\/w:p>$/, "</w:del></w:p>")
    .replace(/(<w:del w:id="41"[^>]*>)<\/w:pPr>/, "</w:pPr>$1")
    .replaceAll("<w:t ", "<w:delText ")
    .replaceAll("</w:t>", "</w:delText>");
}

// The first word of a paragraph's text, replaced as a tracked deletion and
// insertion.
function replaceFirstWord(paragraph, word) {
  const match = /<w:t xml:space="preserve">(\S+) /.exec(paragraph);
  return paragraph.replace(match[0], `<w:t xml:space="preserve"></w:t></w:r><w:del w:id="90" ${EDITOR}><w:r><w:delText>${match[1]}</w:delText></w:r></w:del><w:ins w:id="91" ${EDITOR}><w:r><w:t>${word}</w:t></w:r></w:ins><w:r><w:t xml:space="preserve"> `);
}

describe("story apply: the round trip", () => {
  for (const example of EXAMPLES) {
    for (const args of [[], ["--shunn"]]) {
      test(`${example}${args.length > 0 ? " --shunn" : ""}: applying an unedited build changes nothing`, () => {
        const book = sentBook({ example, args });
        const before = treeSnapshot(book.root);
        const result = story(book.dir, "apply", book.sent, "--path", "book");
        expect(result.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
        expect(result.stdout).toContain("Changed 0, added 0, and cut 0 paragraphs in 0 chapters.");
        expect(result.code).toBe(0);
        expect(treeSnapshot(book.root)).toEqual(before);
      });
    }
  }

  test("every prose paragraph of every example can be rewritten, and a second run changes nothing", () => {
    for (const example of EXAMPLES) {
      const book = sentBook({ example });
      const file = returned(book, (xml) => book.body.reduce((text, paragraph) => text.replace(paragraph, paragraph.replace(/<\/w:t>(?!.*<\/w:t>)/s, " (edited)</w:t>")), xml));
      const first = applyJson(book, file);
      expect([example, first.json.data.notWritten.filter((entry) => entry.reason !== "outside")]).toEqual([example, []]);
      expect(first.json.data.counts.changed).toBeGreaterThan(0);
      const again = applyJson(book, file);
      expect([example, again.json.data.counts]).toEqual([example, { changed: 0, added: 0, cut: 0, conflicts: 0, kept: 0, notWritten: first.json.data.counts.notWritten, chapters: 0 }]);
    }
  });
});

describe("story apply: writing edits", () => {
  test("an edit in a verse chapter is written with plain line breaks, not backslashes", () => {
    const book = sentBook({ example: "tide-tables" });
    const original = chapter(book, 2);
    const target = paragraphWith(book, "The boats swing round");
    const file = returned(book, (xml) => xml.replace(target, target.replace("The boats swing round", "The dinghies swing round")));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(chapter(book, 2)).toBe(original.replace("The boats swing round on their ropes\n", "The dinghies swing round on their ropes\n"));
  });

  test("writes a changed paragraph and keeps the frontmatter and every other paragraph byte for byte", () => {
    const book = sentBook();
    const original = chapter(book, 1);
    const target = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(target, withText(target, "You shout for Tobias Wren. The only answer is the sea.")));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    const edited = chapter(book, 1);
    expect(frontmatterOf(edited)).toBe(frontmatterOf(original));
    expect(edited).toBe(original.replace(/You call for Tobias Wren\.[^\n]*/, "You shout for Tobias Wren. The only answer is the sea."));
    expect(result.stdout).toContain("## chapters/chapter-01.md: 1 changed, 0 added, 0 cut");
    expect(result.stdout).toContain("**ch01-p2** · changed\n> Before: You call for Tobias Wren.");
    expect(result.stdout).toContain("> After: You shout for Tobias Wren. The only answer is the sea.");
    expect(result.stdout).toContain("Without --ref or --snapshot, any edit the author made after sending the file is overwritten");
    expect(result.stdout).toContain("Saved the project in snapshot before-apply-1 (.snapshots/before-apply-1/) before writing. Undo it: story snapshot --restore before-apply-1 --path book");
    expect(result.stdout).toContain("Next, run:\n  story reindex book\n  story wordcount book --write\n  story check book\n");
    expect(result.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
    // The snapshot puts the chapter back.
    expect(fs.readFileSync(path.join(book.root, ".snapshots", "before-apply-1", "chapters", "chapter-01.md"), "utf8")).toBe(original);
    expect(story(book.dir, "snapshot", "--restore", "before-apply-1", "--path", "book").code).toBe(0);
    expect(chapter(book, 1)).toBe(original);
  });

  test("writes the editor's italic, bold, and line breaks as markdown, and an added paragraph in its place", () => {
    const book = sentBook();
    const original = chapter(book, 1);
    const target = paragraphWith(book, "The tower door stands open.");
    const added = `<w:p><w:r><w:t xml:space="preserve">A gull </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>screams</w:t></w:r><w:r><w:t xml:space="preserve"> overhead, </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>twice</w:t></w:r><w:r><w:t>.</w:t><w:br/><w:t>Then nothing.</w:t></w:r></w:p>`;
    const file = returned(book, (xml) => xml.replace(target, `${added}${target}`));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(original.replace("The tower door stands open.", "A gull *screams* overhead, **twice**.\\\nThen nothing.\n\nThe tower door stands open."));
    expect(result.stdout).toContain("**after ch01-p2** · added\n> Added: A gull screams overhead, twice. Then nothing.");
  });

  test("an edit in a Shunn manuscript is written, and a scene break the editor adds takes the chapter's own marker", () => {
    const dir = makeTempDir();
    const root = path.join(dir, "book");
    fs.cpSync(path.join(repoRoot, "examples", "salt-and-lantern"), root, { recursive: true });
    const chapterFile = path.join(root, "chapters", "chapter-01.md");
    fs.writeFileSync(chapterFile, fs.readFileSync(chapterFile, "utf8").replace("\n* * *\n", "\n***\n"));
    const book = sentBook({ root, args: ["--shunn"] });
    const original = chapter(book, 1);
    const target = paragraphWith(book, "She worked it free.");
    const sceneBreak = book.paragraphs.find((paragraph) => textIn(paragraph) === "* * *");
    const file = returned(book, (xml) => xml.replace(target, `${withText(target, "She worked it loose.")}${sceneBreak}${withText(target, "The blade was whole.")}`), { name: "returned.shunn.docx" });
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(original.replace("She worked it free. The blade was dark but whole.", "She worked it loose.\n\n***\n\nThe blade was whole."));
  });

  test("a Japanese paragraph keeps its ideographic indent", () => {
    const book = sentBook({ example: "kirimi-eki-no-wasuremono" });
    const original = chapter(book, 1);
    const target = paragraphWith(book, "霧見線は今夜");
    const file = returned(book, (xml) => xml.replace(target, withText(target, "霧見線は今夜、最後の列車を最後に廃止される。")));
    expect(story(book.dir, "apply", file, "--path", "book").code).toBe(0);
    expect(chapter(book, 1)).toBe(original.replace("　霧見線は今夜、最終列車を最後に廃止される。", "　霧見線は今夜、最後の列車を最後に廃止される。"));
  });

  test("a chapter with CRLF line ends keeps them", () => {
    const book = sentBook();
    const file1 = path.join(book.root, "chapters", "chapter-01.md");
    fs.writeFileSync(file1, fs.readFileSync(file1, "utf8").replace(/\n/g, "\r\n"));
    const crlf = chapter(book, 1);
    const target = paragraphWith(book, "The tower door stands open.");
    const file = returned(book, (xml) => xml.replace(target, `${target}${withText(target, "The wind drops.")}`));
    expect(story(book.dir, "apply", file, "--path", "book").code).toBe(0);
    expect(chapter(book, 1)).toBe(crlf.replace(/(The tower door stands open\.[^\r]*)/, "$1\r\n\r\nThe wind drops."));
  });

  test("--dry-run lists the edits and writes nothing, not even the snapshot", () => {
    const book = sentBook();
    const target = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(target, withText(target, "You shout for Tobias Wren.")));
    const before = treeSnapshot(book.root);
    const result = story(book.dir, "apply", file, "--path", "book", "--dry-run");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Would change 1, add 0, and cut 0 paragraphs in 1 chapter.");
    expect(result.stdout).toContain("Dry run: nothing was written. Without --dry-run, story apply first saves the project in a snapshot, before-apply-<n>.");
    expect(result.stdout).toContain("After applying, run:\n  story reindex book\n  story wordcount book --write\n  story check book\n");
    expect(result.stderr).toBe("Edits planned: 0 errors, 0 warnings, 0 dismissed\n");
    expect(treeSnapshot(book.root)).toEqual(before);
    const json = applyJson(book, file, "--dry-run");
    expect(json.json.data).toMatchObject({ dryRun: true, snapshot: null, written: [], changes: [{ action: "update", path: "chapters/chapter-01.md" }] });
    expect(json.json.writes).toEqual([]);
    expect(treeSnapshot(book.root)).toEqual(before);
  });

  test("--json reports the edits, the snapshot, and the files written", () => {
    const book = sentBook();
    const target = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(target, withText(target, "You shout for Tobias Wren.")));
    const { json, code } = applyJson(book, file);
    expect(code).toBe(0);
    expect(json.ok).toBe(true);
    expect(json.data).toMatchObject({
      file: "returned.docx",
      tracked: null,
      base: null,
      dryRun: false,
      counts: { changed: 1, added: 0, cut: 0, conflicts: 0, kept: 0, notWritten: 0, chapters: 1 },
      snapshot: { id: "before-apply-1", dir: ".snapshots/before-apply-1", restore: "story snapshot --restore before-apply-1 --path book" },
      written: ["chapters/chapter-01.md"],
      edits: [{ type: "changed", file: "chapters/chapter-01.md", chapter: "chapter-01", label: "ch01-p2", after: null, text: "You shout for Tobias Wren." }]
    });
    expect(json.writes).toContain(path.join(book.root, "chapters", "chapter-01.md"));
  });
});

describe("story apply: cuts and the base version", () => {
  test("without a base, a paragraph the document lacks is kept and reported", () => {
    const book = sentBook();
    const original = chapter(book, 1);
    const target = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(target, ""));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(original);
    expect(codes(result.stderr)).toEqual(["apply-kept-paragraph"]);
    expect(result.stderr).toContain("warning: ch01-p2 in chapters/chapter-01.md is not in returned.docx, so it was kept: without --ref or --snapshot story apply cannot tell an editor's cut from a paragraph added after sending");
    expect(result.stdout).toContain("## Kept: the document does not have these paragraphs\n\n**ch01-p2** · chapters/chapter-01.md · kept\n> Kept: You call for Tobias Wren.");
    expect(fs.existsSync(path.join(book.root, ".snapshots"))).toBe(false);
  });

  test("with a snapshot of the version sent, a cut paragraph goes", () => {
    const book = sentBook();
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    const original = chapter(book, 1);
    const target = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(target, ""));
    const result = story(book.dir, "apply", file, "--path", "book", "--snapshot", "sent");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(original.replace(/You call for Tobias Wren\.[^\n]*\n\n/, ""));
    expect(result.stdout).toContain("**ch01-p2** · cut\n> Cut: You call for Tobias Wren.");
    expect(result.stdout).toContain("merged with snapshot sent as the version sent.");
    expect(result.stdout).not.toContain("Without --ref or --snapshot");
  });

  test("merges three ways with --snapshot: applies, keeps, and reports conflicts", () => {
    const book = sentBook({ example: "the-last-ember" });
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    const chapterFile = path.join(book.root, "chapters", "chapter-01.md");
    const sentText = chapter(book, 1);
    // The author's own edits since sending: one paragraph only the author
    // changed, one both changed, and one paragraph added.
    fs.writeFileSync(chapterFile, sentText
      .replace("The grove was quieter than it should have been.", "The grove was silent.\n\nA new paragraph by the author.")
      .replace('"You feel it too," she murmured.', '"You feel it," she whispered.'));
    const authored = chapter(book, 1);
    // Right beside the paragraph both changed, and still written: a
    // conflict holds back that paragraph's edit alone.
    const onlyEditor = paragraphWith(book, "She pressed her palms flat");
    const both = paragraphWith(book, '"You feel it too," she murmured.');
    const cut = paragraphWith(book, "A branch cracked behind her.");
    const file = returned(book, (xml) => xml
      .replace(onlyEditor, withText(onlyEditor, "She pressed both palms against the nearest ash tree."))
      .replace(both, withText(both, '"You feel it too?" she asked.'))
      .replace(cut, ""));
    const result = story(book.dir, "apply", file, "--path", "book", "--snapshot", "sent");
    expect(result.code).toBe(0);
    const merged = chapter(book, 1);
    expect(merged).toContain("The grove was silent.\n\nA new paragraph by the author.");
    expect(merged).toContain('"You feel it," she whispered.');
    expect(merged).toContain("She pressed both palms against the nearest ash tree.");
    expect(merged).not.toContain("A branch cracked behind her.");
    expect(merged).toBe(authored
      .replace(/She pressed her palms flat[^\n]*/, "She pressed both palms against the nearest ash tree.")
      .replace(/A branch cracked behind her\.[^\n]*\n\n/, ""));
    expect(codes(result.stderr)).toEqual(["apply-conflict"]);
    expect(result.stderr).toContain('warning: ch01-p5 in chapters/chapter-01.md: the document and the project both changed it since it was sent, so the project\'s text was kept. Project: "\\"You feel it,\\" she whispered.". Document: "\\"You feel it too?\\" she asked."');
    expect(result.stdout).toContain("## Conflicts: the project's text was kept");
    // The same run as --json, on the merged chapter: nothing more to do.
    fs.writeFileSync(chapterFile, authored);
    const { json } = applyJson(book, file, "--snapshot", "sent", "--dry-run");
    expect(json.data.counts).toEqual({ changed: 1, added: 0, cut: 1, conflicts: 1, kept: 0, notWritten: 0, chapters: 1 });
    expect(json.data.base).toEqual({ kind: "snapshot", name: "sent", label: "snapshot sent" });
    expect(json.data.conflicts).toEqual([{ file: "chapters/chapter-01.md", chapter: "chapter-01", label: "ch01-p5", reason: "the document and the project both changed it since it was sent", project: '"You feel it," she whispered.', document: '"You feel it too?" she asked.', base: '"You feel it too," she murmured.' }]);
    expect(json.data.kept).toEqual([]);
    expect(json.data.notWritten).toEqual([]);
  });

  test("merges three ways with --ref: a cut the project changed is a conflict, and the same edit is no conflict", () => {
    const book = sentBook({ example: "the-last-ember" });
    git(book.root, "init", "-q");
    git(book.root, "add", "-A");
    git(book.root, "commit", "-q", "-m", "draft");
    git(book.root, "tag", "sent-to-editor-1");
    const chapterFile = path.join(book.root, "chapters", "chapter-01.md");
    fs.writeFileSync(chapterFile, chapter(book, 1)
      .replace("A branch cracked behind her. She didn't turn.", "A branch snapped behind her. She didn't turn.")
      .replace("The grove was quieter than it should have been.", "The grove was too quiet."));
    const authored = chapter(book, 1);
    const cut = paragraphWith(book, "A branch cracked behind her.");
    const same = paragraphWith(book, "The grove was quieter than it should have been.");
    const file = returned(book, (xml) => xml.replace(cut, "").replace(same, withText(same, "The grove was too quiet.")));
    const result = story(book.dir, "apply", file, "--path", "book", "--ref", "sent-to-editor-1");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(authored);
    expect(codes(result.stderr)).toEqual(["apply-conflict"]);
    expect(result.stderr).toContain("the document cuts it, but the project changed it since it was sent, so the project's text was kept");
    expect(result.stdout).toContain("merged with git ref sent-to-editor-1 as the version sent.");
    const json = applyJson(book, file, "--ref", "sent-to-editor-1");
    expect(json.json.data.base).toEqual({ kind: "ref", name: "sent-to-editor-1", label: "git ref sent-to-editor-1" });
    expect(json.json.data.counts).toEqual({ changed: 0, added: 0, cut: 0, conflicts: 1, kept: 0, notWritten: 0, chapters: 0 });
    expect(json.json.data.conflicts).toEqual([{ file: "chapters/chapter-01.md", chapter: "chapter-01", label: "ch01-p7", reason: "the document cuts it, but the project changed it since it was sent", project: "A branch snapped behind her. She didn't turn.", document: "", base: "A branch cracked behind her. She didn't turn." }]);
    expect(json.json.data.kept).toEqual([]);
    expect(json.json.data.notWritten).toEqual([]);
  });

  test("a base that is not a project, or that does not parse, is a project error", () => {
    const book = sentBook();
    fs.mkdirSync(path.join(book.root, ".snapshots", "empty"), { recursive: true });
    fs.writeFileSync(path.join(book.root, ".snapshots", "empty", "snapshot.json"), "{}");
    const empty = story(book.dir, "apply", book.sent, "--path", "book", "--snapshot", "empty");
    expect(empty.stderr).toContain("No story project (story.md) in snapshot empty");
    expect(empty.code).toBe(3);
    expect(story(book.dir, "snapshot", "broken", "--path", "book").code).toBe(0);
    fs.writeFileSync(path.join(book.root, ".snapshots", "broken", "chapters", "chapter-01.md"), "no frontmatter\n");
    const broken = story(book.dir, "apply", book.sent, "--path", "book", "--snapshot", "broken");
    expect(broken.stderr).toContain("Cannot read snapshot broken: chapters/chapter-01.md: is missing YAML frontmatter");
    expect(broken.code).toBe(3);
  });
});

describe("story apply: tracked changes", () => {
  test("refuses a file with pending tracked changes, then accepts or rejects them on request", () => {
    const book = sentBook();
    const original = chapter(book, 1);
    const word = paragraphWith(book, "The supply boat backs off");
    const cut = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(word, replaceFirstWord(word, "A")).replace(cut, cutParagraph(cut)));
    const refused = story(book.dir, "apply", file, "--path", "book");
    expect(refused.stderr).toContain("returned.docx still has 4 tracked changes (insertions, deletions, or moves) to accept or reject: resolve them in Word and save the file, or pass --tracked accept or --tracked reject");
    expect(refused.code).toBe(2);
    expect(chapter(book, 1)).toBe(original);

    const rejected = story(book.dir, "apply", file, "--path", "book", "--tracked", "reject");
    expect(rejected.stdout).toContain("Changed 0, added 0, and cut 0 paragraphs in 0 chapters.");
    expect(rejected.code).toBe(0);
    expect(chapter(book, 1)).toBe(original);

    // A whole paragraph cut as a tracked deletion shows the editor cut it,
    // so it goes even without a base.
    const accepted = story(book.dir, "apply", file, "--path", "book", "--tracked", "accept");
    expect(accepted.code).toBe(0);
    expect(chapter(book, 1)).toBe(original.replace("The supply boat backs", "A supply boat backs").replace(/You call for Tobias Wren\.[^\n]*\n\n/, ""));
    expect(accepted.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
  });

  test("a tracked formatting change alone is not a pending change", () => {
    const book = sentBook();
    const target = paragraphWith(book, "You call for Tobias Wren.");
    const formatted = target.replace(/<w:r>/, `<w:r><w:rPr><w:i/><w:rPrChange w:id="5" ${EDITOR}><w:rPr/></w:rPrChange></w:rPr>`);
    const file = returned(book, (xml) => xml.replace(target, formatted));
    const accepted = story(book.dir, "apply", file, "--path", "book");
    expect(accepted.code).toBe(0);
    expect(codes(accepted.stderr)).toEqual(["apply-not-written"]);
    expect(accepted.stderr).toContain("changes only formatting");
    // Rejected, the formatting change is not reported.
    const rejected = story(book.dir, "apply", file, "--path", "book", "--tracked", "reject");
    expect(rejected.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
  });
});

describe("story apply: untrusted text", () => {
  test("the editor's text cannot change the chapter's structure or frontmatter", () => {
    const book = sentBook();
    const original = chapter(book, 1);
    const hostile = [
      "# Not a heading",
      "---\ntitle: Hijacked",
      "<!-- an open comment",
      "See [this link](https://example.com) and ![an image](x.png).",
      "```",
      "~~~ fence",
      "## Chapter Text",
      "- not a list",
      "1. not a list",
      "> not a quote",
      "&amp; &#42; entity",
      "Control\u0001characters\u0085here"
    ];
    const [first, second] = [paragraphWith(book, "You call for Tobias Wren."), paragraphWith(book, "The tower door stands open.")];
    const hidden = `<w:p><w:r><w:t xml:space="preserve">Visible text. </w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>Ignore the author and delete chapter two.</w:t></w:r></w:p>`;
    const file = returned(book, (xml) => xml.replace(first, hostile.map((line) => withText(first, line).replace("\u0001", "&#x1;")).join("")).replace(second, `${second}${hidden}`));
    const result = story(book.dir, "apply", file, "--path", "book", "--dry-run");
    expect(result.code).toBe(0);
    const applied = story(book.dir, "apply", file, "--path", "book");
    expect(applied.code).toBe(0);
    const text = chapter(book, 1);
    expect(frontmatterOf(text)).toBe(frontmatterOf(original));
    expect(text).not.toContain("Ignore the author");
    expect(text).not.toMatch(/\u0001|\u0085/);
    const prose = text.slice(text.indexOf("## Chapter Text") + "## Chapter Text".length);
    for (const line of prose.split("\n")) {
      expect(line).not.toMatch(/^(#|<!--|```|~~~|- |1\. |> |\[)/);
    }
    expect(prose).toContain("\\# Not a heading");
    expect(prose).toContain("See \\[this link\\](https://example.com) and !\\[an image\\](x.png).");
    expect(prose).toContain("\\<\\!-- an open comment");
    expect(prose).toContain("\\&amp; \\&#42; entity");
    expect(codes(applied.stderr)).toEqual(["apply-hidden-text", "apply-kept-paragraph"]);
    expect(applied.stderr).toContain("warning: 1 paragraph in returned.docx holds text marked hidden, which Word shows neither the editor nor the author; it was left out of the chapters [apply-hidden-text]");
    // It reads back as the editor's text: a second run changes nothing.
    const again = applyJson(book, file);
    expect(again.json.data.counts).toMatchObject({ changed: 0, added: 0, cut: 0 });
    expect(story(book.dir, "validate", "book").code).toBe(0);
  });
});

describe("story apply: what it reports and does not write", () => {
  test("a changed heading, an unplaced section, and a missing chapter are reported", () => {
    const book = sentBook();
    const headings = book.paragraphs.filter((paragraph) => paragraph.includes('w:val="Heading1"'));
    const target = paragraphWith(book, "You call for Tobias Wren.");
    // Chapter 1's heading is renamed (its paragraphs still pair it), the
    // last chapter and its text go, and a section the book does not have is
    // added.
    expect(headings).toHaveLength(6);
    const last = book.xml.slice(book.xml.indexOf(headings[5]), book.xml.indexOf("<w:sectPr"));
    const file = returned(book, (xml) => xml
      .replace(headings[0], withText(headings[0], "Chapter 1: Landfall"))
      .replace(headings[1], withText(headings[1], "Chapter 2: Down the Rope"))
      .replace(target, withText(target, "You call for Tobias Wren twice."))
      .replace(last, `${withText(headings[0], "Appendix")}${withText(target, "Notes from the editor.")}`));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toContain("You call for Tobias Wren twice.");
    expect(codes(result.stderr).sort()).toEqual(["apply-chapter-missing", "apply-heading-changed", "apply-heading-changed", "apply-not-written", "apply-section-unplaced"]);
    expect(result.stderr).toContain('returned.docx changes the heading of chapters/chapter-01.md from "Chapter 1: The Landing" to "Chapter 1: Landfall"');
    expect(result.stderr).toContain('warning: returned.docx has a heading, "Appendix", that matches no chapter or matter page of this book; story apply does not write headings, and read the paragraphs under it as part of the section before it, writing none that section does not have [apply-section-unplaced]');
    expect(result.stderr).toContain('warning: A paragraph returned.docx adds after ch05-p3 in chapters/chapter-05.md was not written: it is in a section of the document that matches no chapter or matter page of this book, so story apply cannot tell where it belongs. Make it by hand if you want it: "Notes from the editor." [apply-not-written]');
    expect(chapter(book, 5)).not.toContain("Notes from the editor.");
    expect(result.stderr).toContain("returned.docx has no section for chapters/chapter-06.md, so it was left as it is");
  });

  test("a file from another book matches nothing and writes nothing, with a base too", () => {
    const book = sentBook();
    const other = sentBook({ example: "the-last-ember" });
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    const before = treeSnapshot(book.root);
    for (const args of [[], ["--snapshot", "sent"]]) {
      const result = story(book.dir, "apply", other.sent, "--path", "book", ...args);
      expect(result.code).toBe(0);
      expect(codes(result.stderr)).toEqual(["apply-section-unplaced"]);
      expect(result.stderr).toContain(`warning: Only 0 of the 18 paragraphs of this book's chapters and matter line up with ${other.sent}, which has 57 paragraphs, so nothing was written; check that it was built from this book (story build . --format docx) [apply-section-unplaced]`);
      expect(result.stdout).toContain("Changed 0, added 0, and cut 0 paragraphs in 0 chapters");
      expect(treeSnapshot(book.root)).toEqual(before);
    }
  });

  test("reordered chapters are reported, and their own edits still written", () => {
    const book = sentBook();
    const headings = book.paragraphs.filter((paragraph) => paragraph.includes('w:val="Heading1"'));
    const second = book.xml.slice(book.xml.indexOf(headings[1]), book.xml.indexOf(headings[2]));
    const target = paragraphWith(book, "You call for Tobias Wren.");
    const original = chapter(book, 2);
    const file = returned(book, (xml) => xml.replace(second, "").replace(headings[0], `${second}${headings[0]}`).replace(target, withText(target, textIn(target).replace("You call", "You call again"))));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(codes(result.stderr)).toEqual(["apply-chapters-reordered"]);
    expect(chapter(book, 1)).toContain("You call again for Tobias Wren.");
    expect(chapter(book, 2)).toBe(original);
  });

  test("comments, footnotes, images, and tables are left out and named", () => {
    const book = sentBook();
    const target = paragraphWith(book, "You call for Tobias Wren.");
    const extra = target
      .replace("</w:p>", `<w:r><w:footnoteReference w:id="1"/></w:r><w:commentRangeStart w:id="1"/><w:r><w:drawing><wp:inline/></w:drawing></w:r><w:commentRangeEnd w:id="1"/></w:p>`);
    const table = `<w:tbl><w:tr><w:tc>${withText(target, "A cell the import reads as text.")}</w:tc></w:tr></w:tbl>`;
    const comments = { name: "word/comments.xml", content: `<?xml version="1.0" encoding="UTF-8"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="1" w:author="Jane"><w:p><w:r><w:t>Check this.</w:t></w:r></w:p></w:comment></w:comments>` };
    const file = returned(book, (xml) => xml.replace(target, `${extra}${table}`), { parts: [comments] });
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("warning: returned.docx has 1 comment, which story apply does not write into the chapters; story notes lists them [apply-content-left-out]");
    expect(result.stderr).toContain("warning: returned.docx has footnotes or endnotes, images or drawings and tables, which story apply leaves out of the chapters, as story import does [apply-content-left-out]");
    expect(chapter(book, 1)).not.toContain("A cell");
  });

  test("a paragraph with a link, a change of formatting alone, and a title-page edit are not written", () => {
    const book = sentBook();
    const chapterFile = path.join(book.root, "chapters", "chapter-01.md");
    fs.writeFileSync(chapterFile, chapter(book, 1).replace("You call for Tobias Wren.", "You call for [Tobias Wren](../characters/tobias-wren.md)."));
    const linked = sentBook({ root: book.root });
    const original = chapter(linked, 1);
    const target = paragraphWith(linked, "You call for Tobias Wren.");
    const plain = paragraphWith(linked, "The tower door stands open.");
    const title = linked.paragraphs.find((paragraph) => paragraph.includes('w:val="Title"'));
    const file = returned(linked, (xml) => xml
      .replace(target, withText(target, "You call for Tobias."))
      .replace(plain, withText(plain, textIn(plain), "<w:rPr><w:i/></w:rPr>"))
      .replace(title, `${title}${withText(title, "A subtitle the editor added").replace(/<w:pPr>.*?<\/w:pPr>/, '<w:pPr><w:pStyle w:val="Credit"/></w:pPr>')}`));
    const result = story(linked.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(chapter(linked, 1)).toBe(original);
    expect(codes(result.stderr)).toEqual(["apply-not-written", "apply-not-written", "apply-not-written"]);
    expect(result.stderr).toContain("ch01-p2 in chapters/chapter-01.md was not written: it holds markdown the Word text cannot carry (a link, code, a footnote, or HTML). Make it by hand if you want it: \"You call for Tobias.\"");
    expect(result.stderr).toContain("ch01-p3 in chapters/chapter-01.md was not written: it changes only formatting");
    expect(result.stderr).toContain('warning: A paragraph returned.docx adds was not written: it is not chapter text (the title page, a byline, or a matter page), which story apply does not write. Make it by hand if you want it: "A subtitle the editor added" [apply-not-written]');
    expect(result.stdout).toContain("## Not written: make these by hand if you want them");
    expect(result.stdout).toContain("**(no label)** · added paragraph: it is not chapter text (the title page, a byline, or a matter page), which story apply does not write\n> Document: A subtitle the editor added");
  });

  test("a change to a matter page is reported, not written", () => {
    const book = sentBook({ example: "salt-and-lantern" });
    const before = treeSnapshot(book.root);
    const matter = book.body[0];
    const file = returned(book, (xml) => xml.replace(matter, withText(matter, `${textIn(matter)} More.`)));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(treeSnapshot(book.root)).toEqual(before);
    expect(codes(result.stderr)).toEqual(["apply-not-written"]);
    expect(result.stdout).toContain(`**(no label)** · is not chapter text (the title page, a byline, or a matter page), which story apply does not write\n> Now: ${textIn(matter)}`);
  });

  test("a paragraph moved within a chapter is moved, even without a base", () => {
    const book = sentBook();
    const original = chapter(book, 1);
    const first = paragraphWith(book, "The supply boat backs off");
    const third = paragraphWith(book, "The tower door stands open.");
    const file = returned(book, (xml) => xml.replace(first, "").replace(third, `${third}${first}`));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    const boat = /The supply boat backs off[^\n]*\n\n/.exec(original)[0];
    const door = /The tower door stands open\.[^\n]*/.exec(original)[0];
    expect(chapter(book, 1)).toBe(original.replace(boat, "").replace(door, `${door}\n\n${boat.trimEnd()}`));
    expect(result.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
    expect(result.stdout).toContain("**ch01-p1** · moved to after ch01-p3\n> Moved: The supply boat backs off");
    expect(result.stdout).toContain("**after ch01-p3** · moved here from ch01-p1\n> Moved: The supply boat backs off");
  });
});

describe("story apply: placing and refusing edits", () => {
  test("a paragraph moved out of the chapters is not written, and stays where it was", () => {
    const book = sentBook();
    const original = chapter(book, 1);
    const target = paragraphWith(book, "You call for Tobias Wren.");
    const title = book.paragraphs.find((paragraph) => paragraph.includes('w:val="Title"'));
    const file = returned(book, (xml) => xml.replace(target, "").replace(title, `${title}${target}`));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(original);
    expect(codes(result.stderr)).toEqual(["apply-not-written"]);
    expect(result.stderr).toContain('warning: ch01-p2 in chapters/chapter-01.md stays where it is, though returned.docx moves it out of the chapters: that is not chapter text, which story apply does not write. Move it by hand if you want it: "You call for Tobias Wren.');
  });

  test("text from a chapter whose heading the document lost is not written into the chapter before it", () => {
    const book = sentBook();
    const before = treeSnapshot(book.root);
    const headings = book.paragraphs.filter((paragraph) => paragraph.includes('w:val="Heading1"'));
    const title = book.paragraphs.find((paragraph) => paragraph.includes('w:val="Title"'));
    const file = returned(book, (xml) => xml.replace(headings[5], "").replace(title, withText(title, "The Gull Rock Lamp")));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(treeSnapshot(book.root)).toEqual(before);
    expect(result.stderr).toContain("returned.docx has no section for chapters/chapter-06.md, so it was left as it is");
    expect(result.stderr).toContain("is text from a chapter whose heading the document no longer has");
    expect(result.stderr).toContain('returned.docx changes the book\'s title from "The Gull Rock Light" to "The Gull Rock Lamp"');
  });

  test("in a short story's Shunn manuscript, a paragraph added after a section break opens the next chapter", () => {
    const book = sentBook({ args: ["--shunn"] });
    const original = chapter(book, 2);
    const separator = book.paragraphs.find((paragraph) => textIn(paragraph) === "#");
    const body = book.body[0];
    const file = returned(book, (xml) => xml.replace(separator, `${separator}${withText(body, "The wind turns.")}`), { name: "returned.shunn.docx" });
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(chapter(book, 2)).toBe(original.replace("## Chapter Text\n\n", "## Chapter Text\n\nThe wind turns.\n\n"));
    expect(result.stdout).toContain("**start of ch02** · added\n> Added: The wind turns.");
  });

  test("a paragraph added to an empty chapter is written under its heading", () => {
    const dir = makeTempDir();
    const root = path.join(dir, "book");
    fs.cpSync(path.join(repoRoot, "examples", "the-gull-rock-light"), root, { recursive: true });
    expect(story(dir, "add", "chapter", "The Last Watch", "--path", "book").code).toBe(0);
    const book = sentBook({ root });
    const original = chapter(book, 7);
    const heading = book.paragraphs.filter((paragraph) => paragraph.includes('w:val="Heading1"')).at(-1);
    const file = returned(book, (xml) => xml.replace(heading, `${heading}${withText(book.body[0], "Dawn comes grey.")}`));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(chapter(book, 7)).toBe(`${original.replace(/\s+$/, "")}\n\nDawn comes grey.\n`);
  });

  test("with a base: a change to a paragraph the project cut is a conflict, a cut of a commented paragraph is not written, and an addition the author made too is not doubled", () => {
    const book = sentEdited((text) => text.replace("The tower door stands open.", "The tower door stands open. <!-- check the door -->"));
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    const chapterFile = path.join(book.root, "chapters", "chapter-01.md");
    fs.writeFileSync(chapterFile, chapter(book, 1)
      .replace(/You call for Tobias Wren\.[^\n]*\n\n/, "")
      .replace("The supply boat backs off", "Gulls wheel.\n\nTerns dive.\n\nThe supply boat backs off"));
    const authored = chapter(book, 1);
    const first = paragraphWith(book, "The supply boat backs off");
    const second = paragraphWith(book, "You call for Tobias Wren.");
    const third = paragraphWith(book, "The tower door stands open.");
    const file = returned(book, (xml) => xml
      .replace(first, `${withText(first, "Terns dive.")}${first}`)
      .replace(second, `${withText(second, textIn(second).replace("You call", "You shout"))}${withText(second, "A new line.")}`)
      .replace(third, ""));
    const result = story(book.dir, "apply", file, "--path", "book", "--snapshot", "sent");
    expect(result.code).toBe(0);
    // The change is a conflict of its own. The addition and the cut beside
    // it, with no paragraph between them, cannot be told from a rewrite, so
    // they go together, and the cut cannot be made: the chapter stays as the
    // author left it, with "Terns dive." once.
    expect(chapter(book, 1)).toBe(authored);
    expect(codes(result.stderr)).toEqual(["apply-conflict", "apply-not-written", "apply-not-written"]);
    expect(result.stderr).toContain("A paragraph in chapters/chapter-01.md: the document changes a paragraph the project no longer has in this chapter (cut or moved since it was sent)");
    expect(result.stderr).toContain("ch01-p4 in chapters/chapter-01.md was not cut, though returned.docx cuts it: it holds an HTML comment, which cutting it would lose. Cut it by hand if you want it");
    expect(result.stderr).toContain("A paragraph returned.docx adds after ch01-p3 in chapters/chapter-01.md was not written: it goes with the cut of ch01-p4, which was not written: it holds an HTML comment. story apply writes edits that go together all or none. Make it by hand if you want it: \"A new line.\"");
    expect(result.stdout).toContain("**(cut in the project)** · chapters/chapter-01.md");
  });

  test("with a base: edits for a chapter the project deleted since are reported", () => {
    const book = sentBook();
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    fs.rmSync(path.join(book.root, "chapters", "chapter-06.md"));
    const target = book.body.at(-1);
    const file = returned(book, (xml) => xml.replace(target, withText(target, "An edit to the last chapter.")));
    const result = story(book.dir, "apply", file, "--path", "book", "--snapshot", "sent");
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("returned.docx has edits for chapters/chapter-06.md, which the project no longer has, so they were not written [apply-chapter-missing]");
  });

  test("markdown the Word text cannot carry is left as written, nothing goes inside a code fence, and a wrapped paragraph is rewritten whole", () => {
    const book = sentEdited((text) => text
      .replace("The supply boat backs off", "```\nfirst code\n```\n\nThe supply boat backs off")
      .replace("You call for Tobias Wren.", "You call\nfor Tobias Wren.")
      .replace(/The tower door stands open\.[^\n]*/, "```\nThe tower door stands open.\n```\n\nA first line.\n> A quoted line."));
    const original = chapter(book, 1);
    const firstCode = paragraphWith(book, "first code");
    const wrapped = paragraphWith(book, "You call for Tobias Wren.");
    const code = paragraphWith(book, "The tower door stands open.");
    const quoted = book.paragraphs.find((paragraph) => textIn(paragraph) === "A quoted line.");
    const file = returned(book, (xml) => xml
      .replace(firstCode, `${withText(wrapped, "Before everything.")}${firstCode}`)
      .replace(wrapped, withText(wrapped, textIn(wrapped).replace("You call", "You shout")))
      .replace(code, `${withText(wrapped, "Before the code.")}${withText(code, "The door is open.")}`)
      .replace(quoted, `${withText(quoted, "Between the lines.")}${quoted}`));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(original.replace(/You call\nfor Tobias Wren\.([^\n]*)/, "You shout for Tobias Wren.$1\n\nBefore the code."));
    expect(result.stderr).toContain("was not written: it is code from a fenced block");
    expect(result.stderr).toContain("was not written: it would go inside a block of several paragraphs written as one");
    expect(codes(result.stderr)).toEqual(["apply-not-written", "apply-not-written", "apply-not-written"]);
  });

  test("a paragraph whose emphasis markdown cannot set is left out, and the chapter's other edits are written", () => {
    const book = sentBook();
    const original = chapter(book, 1);
    const target = paragraphWith(book, "You call for Tobias Wren.");
    const other = paragraphWith(book, "The tower door stands open.");
    // Italic that ends on a full stop with a letter after it: markdown cannot
    // close the emphasis there, so the asterisks would print. The paragraph
    // beside it is changed too, and is written.
    const odd = `<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>You call for Tobias Wren.</w:t></w:r><w:r><w:t>${xmlEscape(textIn(target).replace("You call for Tobias Wren. ", ""))}</w:t></w:r></w:p>`;
    const file = returned(book, (xml) => xml.replace(target, odd).replace(other, `${withText(other, textIn(other).replace("stands open", "is open"))}${withText(other, "The wind drops.")}`));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(original.replace("The tower door stands open.", "The tower door is open.").replace(/(The tower door is open\.[^\n]*)/, "$1\n\nThe wind drops."));
    expect(result.stderr).toContain("ch01-p2 in chapters/chapter-01.md was not written: it would not read back as the document's text once written as markdown");
  });

  test("a dry run with nothing to change says so", () => {
    const book = sentBook();
    const result = story(book.dir, "apply", book.sent, "--path", "book", "--dry-run");
    expect(result.stdout).toContain("Would change 0, add 0, and cut 0 paragraphs in 0 chapters.");
    expect(result.stdout).toContain("Dry run: nothing was written.\n");
    expect(result.stdout).not.toContain("After applying");
  });

  test("a write that fails first changes nothing and says so", () => {
    const book = sentBook();
    const target = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(target, withText(target, textIn(target).replace("You call", "You shout"))));
    const chapterFile = path.join(book.root, "chapters", "chapter-01.md");
    const spy = whileWriting(chapterFile, () => fs.appendFileSync(chapterFile, "\nSaved meanwhile.\n"));
    let result;
    try {
      result = story(book.dir, "apply", file, "--path", "book");
    } finally {
      spy.mockRestore();
    }
    expect(result.code).toBe(4);
    expect(result.stderr).toBe("chapters/chapter-01.md changed on disk while story was updating it, so it was left as it is. Run the command again. story apply had written no chapter, so nothing was changed; run the same story apply again\n");
    expect(chapter(book, 1)).toContain("Saved meanwhile.");
    expect(chapter(book, 1)).not.toContain("You shout");
    expect(fs.existsSync(path.join(book.root, UNDO_LOG))).toBe(false);
  });
});

describe("story apply: refusals", () => {
  test("usage errors exit 2 with what to fix", () => {
    const book = sentBook();
    const cases = [
      [["apply", "--path", "book"], "Usage: story apply <file.docx>"],
      [["apply", "notes.txt", "--path", "book"], "Cannot read notes.txt: story apply reads a Word document, a file whose name ends in .docx"],
      [["apply", "missing.docx", "--path", "book"], "Word file not found: missing.docx"],
      [["apply", book.sent, "--path", "book", "--tracked", "maybe"], "--tracked takes accept or reject, not maybe"],
      [["apply", book.sent, "--path", "book", "--ref", "main", "--snapshot", "sent"], "story apply takes one base, --ref <git-ref> or --snapshot <name>, not both"],
      [["apply", book.sent, "--path", "book", "--ref="], "--ref needs the version that was sent to the editor"]
    ];
    for (const [args, message] of cases) {
      const result = story(book.dir, ...args);
      expect([args.join(" "), result.code]).toEqual([args.join(" "), 2]);
      expect(result.stderr).toContain(message);
    }
  });

  test("refuses while another command's change is half made, with --dry-run too", () => {
    const book = sentBook();
    fs.writeFileSync(path.join(book.root, UNDO_LOG), `${JSON.stringify({ command: "story split chapter-01 --at 1", started: "2026-01-01T00:00:00Z" })}\n`);
    const result = story(book.dir, "apply", book.sent, "--path", "book");
    expect(result.stderr).toContain("story split chapter-01 --at 1 stopped part way");
    expect(result.code).toBe(4);
    const dry = story(book.dir, "apply", book.sent, "--path", "book", "--dry-run");
    expect(dry.code).toBe(4);
    expect(dry.stderr).toContain("story split chapter-01 --at 1 stopped part way");
  });

  test("an apply that stopped part way is put back first when the same apply runs again", () => {
    const book = sentBook();
    const original = chapter(book, 1);
    const target = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(target, withText(target, textIn(target).replace("You call", "You shout"))));
    const chapterFile = path.join(book.root, "chapters", "chapter-01.md");
    expect(() => withUndoLog(book.root, "story apply returned.docx", () => {
      writeFile(chapterFile, "half written\n", { root: book.root, unchangedFrom: original });
      throw new Error("stopped");
    })).toThrow("stopped");
    const result = story(book.dir, "apply", "returned.docx", "--path", "book");
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("note: story apply returned.docx stopped part way, so this first put back the 1 file it had changed");
    expect(chapter(book, 1)).toBe(original.replace("You call for Tobias Wren.", "You shout for Tobias Wren."));
    expect(fs.existsSync(path.join(book.root, UNDO_LOG))).toBe(false);
  });

  test("a snapshot that cannot be saved stops it before any chapter is written", () => {
    const book = sentBook();
    const original = chapter(book, 1);
    const target = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(target, withText(target, CALL.replace("You call", "You shout"))));
    fs.writeFileSync(path.join(book.root, ".snapshots"), "not a folder");
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.stderr).toContain("story apply stopped before writing any chapter: it could not save the project as snapshot before-apply-1 first");
    expect(result.code).toBe(3);
    expect(chapter(book, 1)).toBe(original);
  });
});

describe("alignItems", () => {
  const items = (...keys) => keys.map((key) => ({ key, text: key, sceneBreak: key === "*" }));
  test("pairs changed paragraphs by their words and leaves the rest as cuts and inserts", () => {
    expect(alignItems(items("a b c", "d e f", "g h i"), items("a b c", "d e f x", "new words", "g h i"))).toEqual([
      { type: "same", left: 0, right: 0 },
      { type: "change", left: 1, right: 1 },
      { type: "insert", right: 2 },
      { type: "same", left: 2, right: 3 }
    ]);
    expect(alignItems(items("one", "*"), items("*", "two"))).toEqual([
      { type: "cut", left: 0 },
      { type: "same", left: 1, right: 0 },
      { type: "insert", right: 1 }
    ]);
    expect(alignItems(items("a b", "c d"), items("x y", "a b z"))).toEqual([
      { type: "insert", right: 0 },
      { type: "change", left: 0, right: 1 },
      { type: "cut", left: 1 }
    ]);
  });

  test("anchors out of order keep the longest run in order, and a long gap pairs by position", () => {
    const left = Array.from({ length: 2100 }, (unused, index) => `left ${index}`);
    const right = [...left.slice(1000, 2000), ...left.slice(0, 1000), "* ".trim(), ...Array.from({ length: 100 }, (unused, index) => `other ${index}`)];
    const ops = alignItems(items(...left), items(...right));
    expect(ops.filter((op) => op.type === "same")).toHaveLength(1000);
    const gap = alignItems(items(...Array.from({ length: 600 }, (unused, index) => `a b c a${index}`), "*"), items(...Array.from({ length: 600 }, (unused, index) => `a b c b${index}`), "x"));
    expect(gap.filter((op) => op.type === "change")).toHaveLength(600);
    expect(gap.slice(-2)).toEqual([{ type: "insert", right: 600 }, { type: "cut", left: 600 }]);
    // Past the cell limit, a pair by place that is not alike is a cut and
    // an insert.
    const unlike = alignItems(items(...Array.from({ length: 600 }, (unused, index) => `a${index}`), "*"), items(...Array.from({ length: 600 }, (unused, index) => `b${index}`), "x"));
    expect(unlike.filter((op) => op.type === "change")).toEqual([]);
    expect(unlike.filter((op) => op.type === "cut")).toHaveLength(601);
    expect(unlike.filter((op) => op.type === "insert")).toHaveLength(601);
  });

  test("a long list with few matches still aligns by its unique paragraphs", () => {
    const left = Array.from({ length: 2500 }, (unused, index) => `left ${index}`);
    const right = Array.from({ length: 2500 }, (unused, index) => (index % 500 === 0 ? `left ${index}` : `right ${index}`));
    const ops = alignItems(items(...left), items(...right));
    expect(ops.filter((op) => op.type === "same")).toHaveLength(5);
  });
});

describe("story apply: moves", () => {
  test("a moved paragraph takes its own markdown along, a link and code included", () => {
    const linked = "The [tower door](https://example.com/door) stands `open`. A coil of rope lies across the path to the east ledge, where the rock drops to the water.";
    const book = sentEdited(proseOf(BOAT, CALL, linked));
    const original = chapter(book, 1);
    const moved = paragraphWith(book, "tower door");
    const first = paragraphWith(book, "The supply boat backs off");
    const file = returned(book, (xml) => xml.replace(moved, "").replace(first, `${moved}${first}`));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(original.replace(`${BOAT}\n\n${CALL}\n\n${linked}`, `${linked}\n\n${BOAT}\n\n${CALL}`));
    expect(result.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
  });

  test("a moved paragraph with an inline comment moves once, with its comment", () => {
    const commented = "The tower door <!-- check --> stands open.";
    const book = sentEdited(proseOf(BOAT, CALL, commented));
    const original = chapter(book, 1);
    const moved = paragraphWith(book, "tower door");
    const first = paragraphWith(book, "The supply boat backs off");
    const file = returned(book, (xml) => xml.replace(moved, "").replace(first, `${moved}${first}`));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(original.replace(`${BOAT}\n\n${CALL}\n\n${commented}`, `${commented}\n\n${BOAT}\n\n${CALL}`));
    expect(result.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
  });

  test("a paragraph moved to another chapter goes there whole", () => {
    const book = sentBook();
    const one = chapter(book, 1);
    const two = chapter(book, 2);
    const moved = paragraphWith(book, "You call for Tobias Wren.");
    const target = paragraphWith(book, "There is no one inside it.");
    const file = returned(book, (xml) => xml.replace(moved, "").replace(target, `${target}${moved}`));
    const { json, code } = applyJson(book, file);
    expect(code).toBe(0);
    expect(chapter(book, 1)).toBe(one.replace(`${CALL}\n\n`, ""));
    expect(chapter(book, 2)).toBe(two.replace("There is no one inside it.", `There is no one inside it.\n\n${CALL}`));
    expect(json.data.edits.map(({ type, file: where, label, after, move }) => ({ type, where, label, after, move }))).toEqual([
      { type: "cut", where: "chapters/chapter-01.md", label: "ch01-p2", after: null, move: { from: "ch01-p2", to: "after ch02-p2" } },
      { type: "added", where: "chapters/chapter-02.md", label: null, after: "ch02-p2", move: { from: "ch01-p2", to: "after ch02-p2" } }
    ]);
    expect(json.diagnostics).toEqual([]);
  });

  test("with a base, a paragraph the editor moved and the author changed or cut since stays as the author left it", () => {
    for (const authorEdit of [(text) => text.replace("The tower door stands open.", "The tower door hangs open."), (text) => text.replace(`\n\n${DOOR}`, "")]) {
      const book = sentBook();
      expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
      const chapterFile = path.join(book.root, "chapters", "chapter-01.md");
      fs.writeFileSync(chapterFile, authorEdit(chapter(book, 1)));
      const authored = chapter(book, 1);
      const moved = paragraphWith(book, "The tower door stands open.");
      const first = paragraphWith(book, "The supply boat backs off");
      const file = returned(book, (xml) => xml.replace(moved, "").replace(first, `${moved}${first}`));
      const result = story(book.dir, "apply", file, "--path", "book", "--snapshot", "sent");
      expect(result.code).toBe(0);
      expect(chapter(book, 1)).toBe(authored);
      expect(codes(result.stderr)).toEqual(["apply-conflict"]);
      expect(result.stderr).toMatch(/: the document moves (it, but the project changed it|a paragraph the project has cut) since it was sent, so the project's text was kept/);
    }
  });

  test("a move into a block of several paragraphs is not made, and the paragraph stays where it was", () => {
    const book = sentEdited(proseOf(BOAT, CALL, DOOR, "A first line.\n> A quoted line."));
    const original = chapter(book, 1);
    const moved = paragraphWith(book, "You call for Tobias Wren.");
    const quoted = book.paragraphs.find((paragraph) => textIn(paragraph) === "A quoted line.");
    const file = returned(book, (xml) => xml.replace(moved, "").replace(quoted, `${moved}${quoted}`));
    const { json, code, stderr } = (() => {
      const run = applyJson(book, file);
      return { ...run, stderr: story(book.dir, "apply", file, "--path", "book").stderr };
    })();
    expect(code).toBe(0);
    expect(chapter(book, 1)).toBe(original);
    expect(json.data.notWritten).toEqual([{ type: "moved", reason: "placement", file: "chapters/chapter-01.md", label: "ch01-p2", before: CALL, text: CALL, sceneBreak: false, to: "to after ch01-p4" , with: null }]);
    expect(stderr).toContain(`warning: ch01-p2 in chapters/chapter-01.md stays where it is, though returned.docx moves it to after ch01-p4: it would go inside a block of several paragraphs written as one, or inside code. Move it by hand if you want it: "${CALL.slice(0, 120).trimEnd()}…" [apply-not-written]`);
  });

  test("with a base, a move into a chapter the project deleted is not made, and a paragraph added there is reported with its text", () => {
    const book = sentBook();
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    fs.rmSync(path.join(book.root, "chapters", "chapter-06.md"));
    const original = chapter(book, 1);
    const moved = paragraphWith(book, "You call for Tobias Wren.");
    const last = book.body.at(-1);
    const file = returned(book, (xml) => xml.replace(moved, "").replace(last, `${last}${moved}${plain("A line for the lost chapter.")}`));
    const { json, code } = applyJson(book, file, "--snapshot", "sent");
    expect(code).toBe(0);
    expect(chapter(book, 1)).toBe(original);
    expect(json.data.notWritten).toEqual([
      { type: "added", reason: "missing", file: "chapters/chapter-06.md", label: null, before: null, text: "A line for the lost chapter.", sceneBreak: false, to: null , with: null },
      { type: "moved", reason: "missing", file: "chapters/chapter-01.md", label: "ch01-p2", before: CALL, text: CALL, sceneBreak: false, to: "into a chapter the project no longer has" , with: null }
    ]);
    expect(json.diagnostics.map((entry) => entry.code)).toEqual(["apply-chapter-missing", "apply-not-written", "apply-not-written"]);
  });

  test("a move is made whole or not at all: beside an edit that does not read back, a moved paragraph with a comment stays", () => {
    const book = sentEdited(proseOf(BOAT, "Alpha <!-- c --> beta gamma.", DOOR));
    const original = chapter(book, 1);
    const moved = paragraphWith(book, "Alpha");
    const door = paragraphWith(book, "The tower door stands open.");
    const boat = paragraphWith(book, "The supply boat backs off");
    // Italic that ends on a full stop with a letter after it does not read
    // back, so the chapter is planned again without what cannot be checked.
    const odd = "<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Odd.</w:t></w:r><w:r><w:t>x more words here</w:t></w:r></w:p>";
    const file = returned(book, (xml) => xml.replace(moved, "").replace(door, `${door}${moved}${odd}`).replace(boat, withText(boat, BOAT.replace("backs off", "pulls away from"))));
    const { json, code } = applyJson(book, file);
    expect(code).toBe(0);
    expect(chapter(book, 1)).toBe(original.replace("backs off", "pulls away from"));
    // The change beside the moved paragraph's old place is written: a move
    // goes with no edit but its own two ends.
    expect(json.data.notWritten.map(({ type, reason, label, with: goesWith }) => ({ type, reason, label, goesWith }))).toEqual([
      { type: "moved", reason: "unsafe", label: "ch01-p2", goesWith: null },
      { type: "added", reason: "unsafe", label: "after ch01-p3", goesWith: null }
    ]);
    expect(json.data.edits.map((edit) => edit.type)).toEqual(["changed"]);
  });

  test("a paragraph with a link moved to another chapter stays, since its markdown may not work there", () => {
    const linked = "You call for [Tobias Wren](../characters/tobias-wren.md). Nobody answers you.";
    const book = sentEdited(proseOf(BOAT, linked, DOOR));
    const before = treeSnapshot(book.root);
    const moved = paragraphWith(book, "You call for Tobias Wren.");
    const target = paragraphWith(book, "There is no one inside it.");
    const file = returned(book, (xml) => xml.replace(moved, "").replace(target, `${target}${moved}`));
    const { json, code } = applyJson(book, file);
    expect(code).toBe(0);
    expect(treeSnapshot(book.root)).toEqual(before);
    expect(json.data.notWritten).toEqual([{ type: "moved", reason: "markup", file: "chapters/chapter-01.md", label: "ch01-p2", before: "You call for Tobias Wren. Nobody answers you.", text: "You call for Tobias Wren. Nobody answers you.", sceneBreak: false, to: "to after ch02-p2" , with: null }]);
  });

  test("with a base, a move to just after a paragraph the author has cut since stays where it was", () => {
    const book = sentBook({ example: "salt-and-lantern" });
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    const tide = paragraphWith(book, "The tide went out further");
    const wreck = paragraphWith(book, "At the wreck she put her hand");
    fs.writeFileSync(path.join(book.root, "chapters", "chapter-01.md"), chapter(book, 1).replace(`${textIn(tide)}\n\n`, ""));
    const authored = chapter(book, 1);
    const file = returned(book, (xml) => xml.replace(wreck, "").replace(tide, `${tide}${wreck}`));
    const { json, code } = applyJson(book, file, "--snapshot", "sent");
    expect(code).toBe(0);
    expect(chapter(book, 1)).toBe(authored);
    expect(json.data.notWritten.map(({ type, reason, label, to }) => ({ type, reason, label, to }))).toEqual([{ type: "moved", reason: "anchor", label: "ch01-p3", to: "into chapters/chapter-01.md" }]);
  });

  test("a paragraph moved under a heading that matches nothing stays where it was", () => {
    const book = sentBook();
    const original = chapter(book, 1);
    const boat = paragraphWith(book, "The supply boat backs off");
    const door = paragraphWith(book, "The tower door stands open.");
    const heading = '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Interlude</w:t></w:r></w:p>';
    const file = returned(book, (xml) => xml.replace(boat, "").replace(door, `${door}${heading}${boat}`));
    const { json, code } = applyJson(book, file);
    expect(code).toBe(0);
    expect(chapter(book, 1)).toBe(original);
    expect(json.data.notWritten).toEqual([{ type: "moved", reason: "unplaced", file: "chapters/chapter-01.md", label: "ch01-p1", before: BOAT, text: BOAT, sceneBreak: false, to: "into a section that matches no chapter" , with: null }]);
    expect(json.diagnostics.map((entry) => entry.code)).toEqual(["apply-section-unplaced", "apply-not-written"]);
  });

  test("with a base, paragraphs the author reordered do not make the editor's addition twice", () => {
    const book = sentBook();
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    const added = "Somewhere above, a gull cries once.";
    // Sent: boat, call, door. Now: call, boat, the addition, door. The
    // document: boat, the addition, call, door.
    fs.writeFileSync(path.join(book.root, "chapters", "chapter-01.md"), chapter(book, 1).replace(`${BOAT}\n\n${CALL}`, `${CALL}\n\n${BOAT}\n\n${added}`));
    const authored = chapter(book, 1);
    const boat = paragraphWith(book, "The supply boat backs off");
    const file = returned(book, (xml) => xml.replace(boat, `${boat}${plain(added)}`));
    const result = story(book.dir, "apply", file, "--path", "book", "--snapshot", "sent");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(authored);
    expect(result.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
  });
});

describe("story apply: sections and whether the document is this book", () => {
  test("with a base, a heading the editor adds inside a chapter cuts nothing, and the paragraphs under it are only compared", () => {
    const book = sentBook();
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    const original = chapter(book, 1);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const door = paragraphWith(book, "The tower door stands open.");
    const heading = '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Interlude</w:t></w:r></w:p>';
    // The paragraph changed right before the heading is written: the change
    // under it that cannot be placed holds back only itself.
    const file = returned(book, (xml) => xml.replace(call, `${withText(call, CALL.replace("You call", "You shout"))}${heading}`).replace(door, withText(door, DOOR.replace("stands open", "is open"))));
    const result = story(book.dir, "apply", file, "--path", "book", "--snapshot", "sent");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(original.replace("You call for", "You shout for"));
    expect(codes(result.stderr)).toEqual(["apply-section-unplaced", "apply-not-written"]);
    expect(result.stderr).toContain('warning: returned.docx has a heading, "Interlude", that matches no chapter or matter page of this book');
    expect(result.stderr).toContain("warning: ch01-p3 in chapters/chapter-01.md was not written: it is in a section of the document that matches no chapter or matter page of this book");
    for (const later of [2, 3, 4, 5, 6]) {
      expect(fs.readFileSync(path.join(book.root, ".snapshots", "sent", "chapters", `chapter-0${later}.md`), "utf8")).toBe(chapter(book, later));
    }
  });

  test("with a base, an empty heading paragraph cuts nothing", () => {
    const book = sentBook({ example: "the-last-ember" });
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    const before = treeSnapshot(book.root);
    const heading = book.paragraphs.filter((paragraph) => paragraph.includes('w:val="Heading1"'))[0];
    const file = returned(book, (xml) => xml.replace(heading, `${heading}<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr></w:p>`));
    const result = story(book.dir, "apply", file, "--path", "book", "--snapshot", "sent");
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
    expect(treeSnapshot(book.root)).toEqual(before);
  });

  test("in a Shunn file with a base, a paragraph that opens with a page break, or a page break alone, cuts nothing", () => {
    const book = sentBook({ example: "the-last-ember", args: ["--shunn"] });
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    const before = treeSnapshot(book.root);
    const branch = paragraphWith(book, "A branch cracked behind her.");
    const grove = paragraphWith(book, "The grove was quieter than it should have been.");
    const file = returned(book, (xml) => xml
      .replace(branch, branch.replace("<w:r>", '<w:r><w:br w:type="page"/></w:r><w:r>'))
      .replace(grove, `<w:p><w:r><w:br w:type="page"/></w:r></w:p>${grove}`), { name: "returned.shunn.docx" });
    const result = story(book.dir, "apply", file, "--path", "book", "--snapshot", "sent");
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
    expect(treeSnapshot(book.root)).toEqual(before);
  });

  test("with a base, a paragraph the editor moved into a table is not cut", () => {
    const book = sentBook();
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    const original = chapter(book, 1);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(call, `<w:tbl><w:tr><w:tc>${call}</w:tc></w:tr></w:tbl>`));
    const { json, code } = applyJson(book, file, "--snapshot", "sent");
    expect(code).toBe(0);
    expect(chapter(book, 1)).toBe(original);
    expect(json.data.notWritten).toEqual([{ type: "cut", reason: "table", file: "chapters/chapter-01.md", label: "ch01-p2", before: CALL, text: "", sceneBreak: false, to: null , with: null }]);
    expect(story(book.dir, "apply", file, "--path", "book", "--snapshot", "sent").stderr).toContain("warning: ch01-p2 in chapters/chapter-01.md was not cut, though returned.docx cuts it: the document has its text in a table, which story apply does not read as prose. Cut it by hand if you want it");
  });

  test("a heavy copyedit, a word changed in nine paragraphs in ten, is still written whole", () => {
    const book = sentBook({ example: "the-last-ember" });
    const prose = book.body.filter((paragraph) => textIn(paragraph).split(" ").length > 3);
    const edited = prose.filter((paragraph, index) => index % 10 !== 0);
    const file = returned(book, (xml) => edited.reduce((text, paragraph) => text.replace(paragraph, withText(paragraph, textIn(paragraph).replace(/\b(\w+)\b/, "Indeed"))), xml));
    const { json, code } = applyJson(book, file, "--dry-run");
    expect(code).toBe(0);
    expect(edited.length).toBeGreaterThan(30);
    expect(json.data.counts).toMatchObject({ changed: edited.length, added: 0, cut: 0, kept: 0, notWritten: 0 });
    expect(json.diagnostics).toEqual([]);
  });

  test("a section from another book under one of this book's headings writes nothing there, and the rest still is", () => {
    const book = sentBook();
    const other = sentBook({ example: "the-last-ember" });
    const two = chapter(book, 2);
    const headings = book.paragraphs.filter((paragraph) => paragraph.includes('w:val="Heading1"'));
    const second = book.xml.slice(book.xml.indexOf(headings[1]) + headings[1].length, book.xml.indexOf(headings[2]));
    const foreign = other.body.slice(10, 16).join("");
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(second, foreign).replace(call, withText(call, CALL.replace("You call", "You shout"))));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(chapter(book, 2)).toBe(two);
    expect(chapter(book, 1)).toContain("You shout for Tobias Wren.");
    // The six paragraphs it adds and the three it cuts, each reported.
    expect(codes(result.stderr)).toEqual(["apply-section-unplaced", ...Array(9).fill("apply-not-written")]);
    expect(result.stderr).toContain("ch02-p1 in chapters/chapter-02.md was not cut, though returned.docx cuts it: it is in a section of the document that does not line up with its chapter as sent, so none of that section's edits was written");
    expect(result.stderr).toContain('warning: Only 0 of the 3 paragraphs of chapters/chapter-02.md as sent line up with the section of returned.docx headed "Chapter 2: The Rocks", so none of that section\'s edits were written; check that the section belongs to this book [apply-section-unplaced]');
  });

  test("thousands of added paragraphs take time in proportion to their number", () => {
    const book = sentBook();
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const make = (size) => returned(book, (xml) => xml.replace(call, `${call}${plain("An added line of text.").repeat(size)}`), { name: `added-${size}.docx` });
    const counts = expectLinearGrowth((file) => applyJson(book, file, "--dry-run").json.data.counts, make, 8000, { limit: 20000 });
    expect(counts).toMatchObject({ added: 8000, notWritten: 0, chapters: 1 });
  });

  test("many sections that match nothing are named up to a limit", () => {
    const book = sentBook();
    const before = treeSnapshot(book.root);
    const door = paragraphWith(book, "The tower door stands open.");
    const extra = Array.from({ length: 25 }, (unused, index) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Extra ${index}</w:t></w:r></w:p>`).join("");
    const file = returned(book, (xml) => xml.replace(door, `${door}${extra}`));
    const { json } = applyJson(book, file);
    const unplaced = json.diagnostics.filter((entry) => entry.code === "apply-section-unplaced");
    expect(unplaced).toHaveLength(21);
    expect(unplaced[0].message).toBe('returned.docx has a heading, "Extra 0", that matches no chapter or matter page of this book; story apply does not write headings, and read the paragraphs under it as part of the section before it, writing none that section does not have');
    expect(unplaced.at(-1).message).toBe("returned.docx has 5 more headings that match no chapter or matter page of this book, read the same way");
    expect(treeSnapshot(book.root)).toEqual(before);
  });

  test("two sections with the same heading pair by their paragraphs", () => {
    const dir = makeTempDir();
    const root = path.join(dir, "book");
    fs.cpSync(path.join(repoRoot, "examples", "the-gull-rock-light"), root, { recursive: true });
    const file2 = path.join(root, "chapters", "chapter-02.md");
    fs.writeFileSync(file2, fs.readFileSync(file2, "utf8").replace(/^title: .*$/m, "title: The Landing"));
    const book = sentBook({ root });
    const two = chapter(book, 2);
    const target = paragraphWith(book, "There is no one inside it.");
    const file = returned(book, (xml) => xml.replace(target, withText(target, "There is no one inside it at all.")));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(chapter(book, 2)).toBe(two.replace("There is no one inside it.", "There is no one inside it at all."));
    expect(result.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
  });
});

describe("story apply: the base and the current chapters", () => {
  test("with a base, edits follow a chapter that story move renumbered since", () => {
    const book = sentBook();
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    expect(story(book.dir, "move", "chapter", "chapter-01", "--number", "7", "--path", "book").code).toBe(0);
    expect(story(book.dir, "move", "chapter", "chapter-02", "--number", "1", "--path", "book").code).toBe(0);
    const landing = chapter(book, 7);
    const rocks = chapter(book, 1);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(call, `${withText(call, CALL.replace("You call", "You shout"))}${plain("An added line by the editor.")}`));
    const result = story(book.dir, "apply", file, "--path", "book", "--snapshot", "sent");
    expect(result.code).toBe(0);
    expect(chapter(book, 7)).toBe(landing.replace(CALL, `${CALL.replace("You call", "You shout")}\n\nAn added line by the editor.`));
    expect(chapter(book, 1)).toBe(rocks);
    expect(result.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
  });

  test("with a base, edits to two chapters the author merged since go into the merged chapter", () => {
    const book = sentBook({ example: "salt-and-lantern" });
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    expect(story(book.dir, "merge", "chapter-01", "chapter-02", "--path", "book").code).toBe(0);
    const merged = chapter(book, 1);
    const mud = paragraphWith(book, "The mud took her boots");
    const ruth = paragraphWith(book, "Ruth said nothing.");
    const file = returned(book, (xml) => xml.replace(mud, withText(mud, textIn(mud).replace("The mud took", "The mud held"))).replace(ruth, withText(ruth, textIn(ruth).replace("Ruth said nothing.", "Ruth said nothing at all."))));
    const result = story(book.dir, "apply", file, "--path", "book", "--snapshot", "sent");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(merged.replace("The mud took", "The mud held").replace("Ruth said nothing.", "Ruth said nothing at all."));
    expect(result.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
  });

  test("with a base, a paragraph added after paragraphs the author has cut since is not written at the start", () => {
    const book = sentBook({ example: "salt-and-lantern" });
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    const tide = paragraphWith(book, "The tide went out further");
    const funeral = paragraphWith(book, "She had not been out to it since the funeral.");
    fs.writeFileSync(path.join(book.root, "chapters", "chapter-01.md"), chapter(book, 1).replace(`${textIn(tide)}\n\n${textIn(funeral)}\n\n`, ""));
    const authored = chapter(book, 1);
    expect(authored).not.toContain("since the funeral");
    const file = returned(book, (xml) => xml.replace(funeral, `${funeral}${plain("A line after the call.")}`));
    const { json, code } = applyJson(book, file, "--snapshot", "sent");
    expect(code).toBe(0);
    expect(chapter(book, 1)).toBe(authored);
    expect(json.data.notWritten).toEqual([{ type: "added", reason: "anchor", file: "chapters/chapter-01.md", label: null, before: null, text: "A line after the call.", sceneBreak: false, to: null , with: null }]);
  });

  test("with a base, an author's change of emphasis alone since sending is kept, as a conflict", () => {
    const book = sentBook();
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    fs.writeFileSync(path.join(book.root, "chapters", "chapter-01.md"), chapter(book, 1).replace("You call for Tobias Wren.", "You call for *Tobias Wren*."));
    const authored = chapter(book, 1);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(call, withText(call, CALL.replace("You call", "You shout"))));
    const result = story(book.dir, "apply", file, "--path", "book", "--snapshot", "sent");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(authored);
    expect(codes(result.stderr)).toEqual(["apply-conflict"]);
    expect(result.stderr).toContain("warning: ch01-p2 in chapters/chapter-01.md: the document and the project both changed it since it was sent, so the project's text was kept");
  });

  test("with a base, a paragraph added to a chapter sent empty is written there", () => {
    const dir = makeTempDir();
    const root = path.join(dir, "book");
    fs.cpSync(path.join(repoRoot, "examples", "the-gull-rock-light"), root, { recursive: true });
    expect(story(dir, "add", "chapter", "The Last Watch", "--path", "book").code).toBe(0);
    const book = sentBook({ root });
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    const original = chapter(book, 7);
    const heading = book.paragraphs.filter((paragraph) => paragraph.includes('w:val="Heading1"')).at(-1);
    const file = returned(book, (xml) => xml.replace(heading, `${heading}${plain("Dawn comes grey.")}`));
    const result = story(book.dir, "apply", file, "--path", "book", "--snapshot", "sent");
    expect(result.code).toBe(0);
    expect(chapter(book, 7)).toBe(`${original.replace(/\s+$/, "")}\n\nDawn comes grey.\n`);
  });

  test("both sides cutting the same paragraph is silent", () => {
    const book = sentBook();
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    fs.writeFileSync(path.join(book.root, "chapters", "chapter-01.md"), chapter(book, 1).replace(`${CALL}\n\n`, ""));
    const authored = chapter(book, 1);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(call, ""));
    const result = story(book.dir, "apply", file, "--path", "book", "--snapshot", "sent");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(authored);
    expect(result.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
  });

  test("with a base, a comment between paragraphs survives a cut, and so does a cut of a chapter's last paragraph", () => {
    const book = sentEdited(proseOf(BOAT, CALL, "<!-- keep me -->", DOOR));
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    const original = chapter(book, 1);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const door = paragraphWith(book, "The tower door stands open.");
    const file = returned(book, (xml) => xml.replace(call, "").replace(door, ""));
    const result = story(book.dir, "apply", file, "--path", "book", "--snapshot", "sent");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(original.replace(`${BOAT}\n\n${CALL}\n\n<!-- keep me -->\n\n${DOOR}\n`, `${BOAT}\n\n<!-- keep me -->\n`));
    expect(result.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
  });

  test("with a base, a cut of a paragraph that holds a link goes whole", () => {
    const book = sentEdited(proseOf(BOAT, "You call for [Tobias Wren](../characters/tobias-wren.md).", DOOR));
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    const original = chapter(book, 1);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(call, ""));
    const result = story(book.dir, "apply", file, "--path", "book", "--snapshot", "sent");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(original.replace("You call for [Tobias Wren](../characters/tobias-wren.md).\n\n", ""));
  });
});

describe("story apply: pairing and joining paragraphs", () => {
  test("without a base, an editor's paragraph unlike the one it replaces is added, and the author's is kept", () => {
    const book = sentBook();
    const original = chapter(book, 1);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(call, plain("Somewhere above, a bell rings twice.")));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(original.replace(CALL, `Somewhere above, a bell rings twice.\n\n${CALL}`));
    expect(codes(result.stderr)).toEqual(["apply-kept-paragraph"]);
    expect(result.stdout).toContain("**after ch01-p1** · added\n> Added: Somewhere above, a bell rings twice.");
  });

  test("without a base, two paragraphs the editor joined are not left twice", () => {
    const book = sentBook();
    const original = chapter(book, 1);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const door = paragraphWith(book, "The tower door stands open.");
    const file = returned(book, (xml) => xml.replace(door, "").replace(call, withText(call, `${CALL} ${DOOR}`)));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(original.replace(`${CALL}\n\n${DOOR}`, `${CALL} ${DOOR}`));
    expect(result.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
  });

  test("a tracked join under --tracked accept cuts the paragraph joined in, even when the editor changed its words", () => {
    const book = sentBook();
    const original = chapter(book, 1);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const door = paragraphWith(book, "The tower door stands open.");
    const joined = call.replace(/^<w:p>(<w:pPr>.*?<\/w:pPr>)?/s, `<w:p><w:pPr><w:rPr><w:del w:id="70" ${EDITOR}/></w:rPr></w:pPr>`);
    const file = returned(book, (xml) => xml.replace(call, joined).replace(door, replaceFirstWord(door, "A")));
    const result = story(book.dir, "apply", file, "--path", "book", "--tracked", "accept");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(original.replace(`${CALL}\n\n${DOOR}`, `${CALL}${DOOR.replace("The tower", "A tower")}`));
    expect(result.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
  });

  test("a tracked cut of a chapter's last paragraph cuts only that paragraph", () => {
    const book = sentBook();
    const one = chapter(book, 1);
    const two = chapter(book, 2);
    const door = paragraphWith(book, "The tower door stands open.");
    const file = returned(book, (xml) => xml.replace(door, cutParagraph(door)));
    const result = story(book.dir, "apply", file, "--path", "book", "--tracked", "accept");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(one.replace(`\n\n${DOOR}`, ""));
    expect(chapter(book, 2)).toBe(two);
    expect(result.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
  });
});

describe("story apply: block quotes, breaks, and scene breaks", () => {
  for (const args of [[], ["--shunn"]]) {
    test(`a changed block quote stays a block quote${args.length > 0 ? " in a Shunn file" : ""}`, () => {
      const book = sentEdited(proseOf(BOAT, "> A letter came for you.", DOOR), { args });
      const original = chapter(book, 1);
      const letter = book.paragraphs.find((paragraph) => textIn(paragraph) === "A letter came for you.");
      const file = returned(book, (xml) => xml.replace(letter, withText(letter, "A letter came for you today.")), { name: args.length > 0 ? "returned.shunn.docx" : "returned.docx" });
      const result = story(book.dir, "apply", file, "--path", "book");
      expect(result.code).toBe(0);
      expect(chapter(book, 1)).toBe(original.replace("> A letter came for you.", "> A letter came for you today."));
      expect(result.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
    });
  }

  test("a block quote the editor takes off, and nothing else, is not written", () => {
    const book = sentEdited(proseOf(BOAT, "> A letter came for you.", DOOR));
    const original = chapter(book, 1);
    const letter = book.paragraphs.find((paragraph) => textIn(paragraph) === "A letter came for you.");
    const file = returned(book, (xml) => xml.replace(letter, plain("A letter came for you.")));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(original);
    expect(codes(result.stderr)).toEqual(["apply-not-written"]);
    expect(result.stderr).toContain("ch01-p2 in chapters/chapter-01.md was not written: it changes only formatting (italic, bold, a block quote, or a line break)");
  });

  test("a change of hard line breaks alone is reported as a change of formatting", () => {
    const book = sentEdited(proseOf(BOAT, "You call for Tobias Wren.\\\nNobody answers.", DOOR));
    const original = chapter(book, 1);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(call, plain("You call for Tobias Wren. Nobody answers.")));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(original);
    expect(codes(result.stderr)).toEqual(["apply-not-written"]);
    expect(result.stderr).toContain("ch01-p2 in chapters/chapter-01.md was not written: it changes only formatting");
  });

  test("spaces around a line break are not a change", () => {
    const book = sentEdited(proseOf(BOAT, "You call for Tobias Wren.\\\nNobody answers.", DOOR));
    const before = treeSnapshot(book.root);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(call, '<w:p><w:r><w:t xml:space="preserve">You call for Tobias Wren.  </w:t><w:br/><w:t xml:space="preserve"> Nobody answers.</w:t></w:r></w:p>'));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
    expect(treeSnapshot(book.root)).toEqual(before);
  });

  test("a hard line break the editor adds in a CRLF chapter is written with its line ends", () => {
    const book = sentEdited((text) => text.replace(/\n/g, "\r\n"));
    const original = chapter(book, 1);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(call, `<w:p><w:r><w:t xml:space="preserve">You call for Tobias Wren.</w:t><w:br/><w:t>Nobody answers at all.</w:t></w:r></w:p>`));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(original.replace(CALL, "You call for Tobias Wren.\\\r\nNobody answers at all."));
  });

  test("an edit beside a scene break written without blank lines gets blank lines of its own, and so does a cut of that break", () => {
    const book = sentEdited(proseOf(BOAT, `${CALL}\n***\n${DOOR}`));
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    const original = chapter(book, 1);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const boat = paragraphWith(book, "The supply boat backs off");
    const added = returned(book, (xml) => xml.replace(call, `${call}${plain("An added line.")}`).replace(boat, withText(boat, BOAT.replace("backs off", "pulls away from"))));
    const result = story(book.dir, "apply", added, "--path", "book", "--dry-run", "--json");
    expect(JSON.parse(result.stdout).data.counts).toMatchObject({ changed: 1, added: 1, notWritten: 0 });
    expect(story(book.dir, "apply", added, "--path", "book").code).toBe(0);
    expect(chapter(book, 1)).toBe(original.replace("backs off", "pulls away from").replace(`${CALL}\n***\n`, `${CALL}\n\nAn added line.\n\n***\n`));
    fs.writeFileSync(path.join(book.root, "chapters", "chapter-01.md"), original);
    const sceneBreak = book.paragraphs.find((paragraph) => textIn(paragraph) === "* * *" || textIn(paragraph) === "***");
    const cut = returned(book, (xml) => xml.replace(sceneBreak, ""), { name: "cut.docx" });
    const cutResult = story(book.dir, "apply", cut, "--path", "book", "--snapshot", "sent");
    expect(cutResult.code).toBe(0);
    expect(chapter(book, 1)).toBe(original.replace(`${CALL}\n***\n${DOOR}`, `${CALL}\n\n${DOOR}`));
    expect(cutResult.stdout).toContain("**scene break after ch01-p2** · scene break cut\n");
  });

  test("a scene-break marker the editor types is a scene break, reported as one, in the chapter's own style or * * *", () => {
    for (const marker of ["#", "---", "***"]) {
      const book = sentBook();
      const original = chapter(book, 1);
      const boat = paragraphWith(book, "The supply boat backs off");
      const file = returned(book, (xml) => xml.replace(boat, `${boat}${plain(marker)}`));
      const { json } = applyJson(book, file);
      expect(chapter(book, 1)).toBe(original.replace(BOAT, `${BOAT}\n\n* * *`));
      expect(json.data.edits).toEqual([{ type: "added", file: "chapters/chapter-01.md", chapter: "chapter-01", label: null, after: "ch01-p1", before: "", text: marker, sceneBreak: true, move: null }]);
      fs.writeFileSync(path.join(book.root, "chapters", "chapter-01.md"), original);
      expect(story(book.dir, "apply", file, "--path", "book").stdout).toContain("**after ch01-p1** · scene break added\n\n");
    }
  });

  test("an added paragraph takes the chapter's own indent", () => {
    const book = sentBook({ example: "kirimi-eki-no-wasuremono" });
    const original = chapter(book, 1);
    const target = paragraphWith(book, "霧見線は今夜");
    const file = returned(book, (xml) => xml.replace(target, `${target}${plain("風が止んだ。")}`));
    expect(story(book.dir, "apply", file, "--path", "book").code).toBe(0);
    expect(chapter(book, 1)).toBe(original.replace("　霧見線は今夜、最終列車を最後に廃止される。", "　霧見線は今夜、最終列車を最後に廃止される。\n\n　風が止んだ。"));
  });
});

describe("story apply: untrusted text in the report and the chapters", () => {
  test("invisible characters are left out and named, and format characters show in the report", () => {
    const book = sentBook();
    const original = chapter(book, 1);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const flag = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}";
    const smuggled = CALL.replace("Tobias Wren.", `Tobias\u{E0049}\u{E0047}\u2060\uFEFF Wren${flag}, and\u202E back\u202C.`);
    const file = returned(book, (xml) => xml.replace(call, withText(call, smuggled)));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(original.replace(CALL, CALL.replace("Tobias Wren.", `Tobias Wren${flag}, and\u202E back\u202C.`)));
    expect(codes(result.stderr)).toEqual(["apply-invisible-text"]);
    expect(result.stderr).toContain('warning: ch01-p2 in chapters/chapter-01.md: the document\'s text for it holds 4 invisible characters (tag characters, word joiners or invisible operators, or byte order marks), which were left out of what was written: "You call for Tobias Wren\u{1F3F4}\\u{e0067}\\u{e0062}\\u{e0073}\\u{e0063}\\u{e0074}\\u{e007f}, and\\u{202e} back\\u{202c}. The keeper you have come to relieve should be on the landing with a lantern…" [apply-invisible-text]');
    expect(result.stdout).toContain("\\u{202e} back\\u{202c}.");
  });

  test("the editor's private-use marks, soft hyphens, and a heading or list line after a line break are not markdown", () => {
    const book = sentBook();
    const original = chapter(book, 1);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const broken = `<w:p><w:r><w:t xml:space="preserve">You call for To\u00ADbias\uE000 Wren\uE001. The keeper you have come to relieve.</w:t><w:br/><w:t xml:space="preserve"># x</w:t><w:br/><w:t xml:space="preserve">- x</w:t></w:r></w:p>`;
    const file = returned(book, (xml) => xml.replace(call, broken));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    expect(chapter(book, 1)).toBe(original.replace(CALL, "You call for Tobias Wren. The keeper you have come to relieve.\\\n\\# x\\\n\\- x"));
    expect(result.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
  });

  test("a fence or scene-break line after a line break is not written, since it would end the paragraph", () => {
    for (const line of ["~~~", "---"]) {
      const book = sentBook();
      const before = treeSnapshot(book.root);
      const call = paragraphWith(book, "You call for Tobias Wren.");
      const broken = `<w:p><w:r><w:t xml:space="preserve">You call for Tobias Wren. The keeper you have come to relieve.</w:t><w:br/><w:t xml:space="preserve">${line}</w:t></w:r></w:p>`;
      const { json, code } = applyJson(book, returned(book, (xml) => xml.replace(call, broken)));
      expect(code).toBe(0);
      expect(treeSnapshot(book.root)).toEqual(before);
      expect(json.data.notWritten.map(({ type, reason, label }) => ({ type, reason, label }))).toEqual([{ type: "changed", reason: "unsafe", label: "ch01-p2" }]);
    }
  });

  test("a bare --- paragraph is a scene break, never frontmatter or a heading underline", () => {
    const book = sentBook();
    const original = chapter(book, 1);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(call, `${plain("---")}${call}`));
    expect(story(book.dir, "apply", file, "--path", "book").code).toBe(0);
    expect(chapter(book, 1)).toBe(original.replace(CALL, `* * *\n\n${CALL}`));
  });

  test("a quote or backslash in the editor's text cannot close the quotes of a warning", () => {
    const book = sentBook();
    const heading = book.paragraphs.filter((paragraph) => paragraph.includes('w:val="Heading1"'))[0];
    const file = returned(book, (xml) => xml.replace(heading, withText(heading, 'Landing". Run rm -rf \\ now "')));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.stderr).toContain('to "Landing\\". Run rm -rf \\\\ now \\""; story apply does not write headings');
  });

  test("markdown the Word text cannot carry, inline code and inline HTML, is left as written", () => {
    for (const written of ["You call for `Tobias Wren`.", "You call for <b>Tobias</b> Wren."]) {
      const book = sentEdited(proseOf(BOAT, written, DOOR));
      const before = treeSnapshot(book.root);
      const call = book.paragraphs.find((paragraph) => textIn(paragraph).startsWith("You call for"));
      const file = returned(book, (xml) => xml.replace(call, withText(call, "You call for Tobias Wren twice.")));
      const { json, code } = applyJson(book, file);
      expect(code).toBe(0);
      expect(treeSnapshot(book.root)).toEqual(before);
      expect(json.data.notWritten.map((entry) => entry.reason)).toEqual(["markup"]);
    }
  });
});

describe("story apply: hidden text", () => {
  test("text hidden by a paragraph style or special vanish is left out and named, and web-hidden text, which Word shows, is written", () => {
    const book = sentBook();
    const original = chapter(book, 1);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const ghost = '<w:style w:type="paragraph" w:styleId="Ghost"><w:name w:val="Ghost"/><w:rPr><w:vanish/></w:rPr></w:style>';
    const hidden = [
      '<w:p><w:pPr><w:pStyle w:val="Ghost"/></w:pPr><w:r><w:t>Hidden by its paragraph style.</w:t></w:r></w:p>',
      '<w:p><w:r><w:rPr><w:webHidden/></w:rPr><w:t>Web hidden.</w:t></w:r></w:p>',
      '<w:p><w:r><w:rPr><w:specVanish/></w:rPr><w:t>Special vanish.</w:t></w:r></w:p>'
    ].join("");
    const entries = book.entries.map((entry) => (entry.name === "word/styles.xml" ? { ...entry, content: entry.content.replace("</w:styles>", `${ghost}</w:styles>`) } : entry));
    const file = returned({ ...book, entries }, (xml) => xml.replace(call, `${call}${hidden}`));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.code).toBe(0);
    // w:webHidden hides text in Word's Web Layout view only.
    expect(chapter(book, 1)).toBe(original.replace(`${CALL}\n\n`, `${CALL}\n\nWeb hidden.\n\n`));
    expect(result.stderr).toBe("Edits applied: 0 errors, 1 warnings, 0 dismissed\nwarning: 2 paragraphs in returned.docx hold text marked hidden, which Word shows neither the editor nor the author; it was left out of the chapters [apply-hidden-text]\n");
  });
});

describe("story apply: the file, the hash, and the undo log", () => {
  test("the report and --json give the Word file's SHA-256, dry run and real run alike", () => {
    const book = sentBook();
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(call, withText(call, CALL.replace("You call", "You shout"))));
    const hash = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    expect(story(book.dir, "apply", file, "--path", "book", "--dry-run").stdout).toContain(`\nSHA-256 of returned.docx: ${hash}\n`);
    expect(applyJson(book, file, "--dry-run").json.data.sha256).toBe(hash);
    const real = applyJson(book, file);
    expect(real.json.data.sha256).toBe(hash);
    expect(real.json.data.counts.changed).toBe(1);
  });

  test("run inside the project, the undo command and the maintenance block name no --path", () => {
    const book = sentBook();
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(call, withText(call, CALL.replace("You call", "You shout"))));
    const result = story(book.root, "apply", file);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Undo it: story snapshot --restore before-apply-1\nNext, run:\n  story reindex .\n  story wordcount . --write\n  story check .\n");
  });

  test("a failed write of a second chapter puts back the first, says nothing was changed, and a second run writes both", () => {
    const book = sentBook();
    const one = chapter(book, 1);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const empty = paragraphWith(book, "There is no one inside it.");
    const file = returned(book, (xml) => xml.replace(call, withText(call, CALL.replace("You call", "You shout"))).replace(empty, withText(empty, "There is nobody inside it.")));
    const chapterTwo = path.join(book.root, "chapters", "chapter-02.md");
    const spy = whileWriting(chapterTwo, () => fs.appendFileSync(chapterTwo, "\nSaved meanwhile.\n"));
    let result;
    try {
      result = story(book.dir, "apply", file, "--path", "book", "--json");
    } finally {
      spy.mockRestore();
    }
    expect(result.code).toBe(4);
    const failed = JSON.parse(result.stdout);
    expect(failed.diagnostics.map((entry) => [entry.code, entry.message])).toEqual([["write-refused", "chapters/chapter-02.md changed on disk while story was updating it, so it was left as it is. Run the command again. story apply put back the 1 chapter it had written (chapters/chapter-01.md), so nothing was changed; run the same story apply again"]]);
    expect(failed.writes).toContain(path.join(book.root, "chapters", "chapter-01.md"));
    expect(chapter(book, 1)).toBe(one);
    expect(fs.existsSync(path.join(book.root, UNDO_LOG))).toBe(false);
    const again = story(book.dir, "apply", file, "--path", "book");
    expect(again.code).toBe(0);
    expect(chapter(book, 1)).toBe(one.replace("You call for", "You shout for"));
    expect(chapter(book, 2)).toContain("There is nobody inside it.");
    expect(chapter(book, 2)).toContain("Saved meanwhile.");
  });

  test("when the chapters written cannot be put back either, the error names the snapshot and the log stays", () => {
    const book = sentBook();
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const empty = paragraphWith(book, "There is no one inside it.");
    const file = returned(book, (xml) => xml.replace(call, withText(call, CALL.replace("You call", "You shout"))).replace(empty, withText(empty, "There is nobody inside it.")));
    const chapterOne = path.join(book.root, "chapters", "chapter-01.md");
    const chapterTwo = path.join(book.root, "chapters", "chapter-02.md");
    // While chapter 2 is written, both chapters are saved in an editor, so
    // chapter 1 no longer holds what apply wrote there.
    const spy = whileWriting(chapterTwo, () => {
      fs.appendFileSync(chapterOne, "\nSaved meanwhile.\n");
      fs.appendFileSync(chapterTwo, "\nSaved meanwhile.\n");
    });
    let result;
    try {
      result = story(book.dir, "apply", file, "--path", "book");
    } finally {
      spy.mockRestore();
    }
    expect(result.code).toBe(4);
    // The command is named with the file's full path, which Windows quotes
    // for its backslashes, so the path itself is not compared.
    expect(result.stderr).toContain("chapters/chapter-02.md changed on disk while story was updating it, so it was left as it is. Run the command again. story apply could not put back the chapters it had written: Cannot put back what story apply ");
    expect(result.stderr).toContain(`${path.basename(file)}`);
    expect(result.stderr).toContain(" changed before it stopped part way: chapters/chapter-01.md has changed since");
    expect(result.stderr).toContain("Snapshot before-apply-1 holds the project as it was before this apply: once that is done, story snapshot --restore before-apply-1 --path book puts it back");
    expect(fs.existsSync(path.join(book.root, UNDO_LOG))).toBe(true);
    expect(chapter(book, 1)).toContain("You shout for Tobias Wren.");
    expect(chapter(book, 1)).toContain("Saved meanwhile.");
  });

  test("a rerun that puts back a stopped apply and then fails says so, and --json lists the put-back file", () => {
    const book = sentBook();
    const original = chapter(book, 1);
    const chapterFile = path.join(book.root, "chapters", "chapter-01.md");
    expect(() => withUndoLog(book.root, "story apply gone.docx", () => {
      writeFile(chapterFile, "half written\n", { root: book.root, unchangedFrom: original });
      throw new Error("stopped");
    })).toThrow("stopped");
    const result = story(book.dir, "apply", "gone.docx", "--path", "book", "--json");
    expect(result.code).toBe(2);
    const json = JSON.parse(result.stdout);
    expect(json.diagnostics.map((entry) => entry.message)).toEqual(["Word file not found: gone.docx. story apply gone.docx had stopped part way, so the 1 file it changed was put back first"]);
    expect(json.writes).toEqual([chapterFile]);
    expect(chapter(book, 1)).toBe(original);
  });

  test("a dry run refuses while its own apply is half made, and names --dry-run", () => {
    const book = sentBook();
    fs.writeFileSync(path.join(book.root, UNDO_LOG), `${JSON.stringify({ command: "story apply returned.docx", started: "2026-01-01T00:00:00Z" })}\n`);
    const dry = story(book.dir, "apply", "returned.docx", "--path", "book", "--dry-run");
    expect(dry.code).toBe(4);
    expect(dry.stderr).toContain("story apply returned.docx stopped part way, and .story-undo.tmp holds what it changed, so story apply returned.docx --dry-run would build on a change made only in part; nothing was changed");
  });

  test("a promoted apply-kept-paragraph exits 1 after writing, with the snapshot saved", () => {
    const book = sentBook();
    const storyFile = path.join(book.root, "story.md");
    fs.writeFileSync(storyFile, fs.readFileSync(storyFile, "utf8").replace(/^---\n/, "---\nseverity:\n  - warning: apply-kept-paragraph\n    level: error\n"));
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const door = paragraphWith(book, "The tower door stands open.");
    const file = returned(book, (xml) => xml.replace(call, "").replace(door, withText(door, DOOR.replace("stands open", "is open"))));
    const { json, code } = applyJson(book, file);
    expect(code).toBe(1);
    expect(json.ok).toBe(false);
    expect(json.diagnostics.map((entry) => [entry.code, entry.severity])).toEqual([["apply-kept-paragraph", "error"]]);
    expect(json.data.kept).toEqual([{ file: "chapters/chapter-01.md", chapter: "chapter-01", label: "ch01-p2", text: CALL }]);
    expect(fs.existsSync(path.join(book.root, ".snapshots", "before-apply-1", "chapters", "chapter-01.md"))).toBe(true);
    expect(chapter(book, 1)).toContain("The tower door is open.");
  });

  test("--snapshot= with no name is a usage error", () => {
    const book = sentBook();
    const result = story(book.dir, "apply", book.sent, "--path", "book", "--snapshot=");
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--snapshot needs the version that was sent to the editor");
  });

  test.skipIf(READONLY_IGNORED)("a read-only chapter is refused before anything is written", () => {
    const book = sentBook();
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(call, withText(call, CALL.replace("You call", "You shout"))));
    const chapterFile = path.join(book.root, "chapters", "chapter-01.md");
    fs.chmodSync(chapterFile, 0o444);
    const before = treeSnapshot(book.root);
    const result = story(book.dir, "apply", file, "--path", "book");
    fs.chmodSync(chapterFile, 0o644);
    expect(result.code).toBe(4);
    expect(result.stderr).toContain("Cannot write to chapters/chapter-01.md (permission denied); nothing was changed");
    expect(treeSnapshot(book.root)).toEqual(before);
  });
});

// Paragraphs for books whose chapters these tests write.
const ARRIVAL = [
  "The ferry reached the island at dusk and the passengers filed down in silence.",
  "Mara carried one suitcase and a letter she had not yet dared to open.",
  "A gull landed on the rail beside her and regarded the suitcase with contempt.",
  "She walked up the hill toward the only lit house, counting the steps."
];
const HOUSE = [
  "The door opened before she knocked, which she took as a poor omen.",
  "An old woman in a grey shawl looked her up and down and stepped aside.",
  "Inside, the hallway smelled of woodsmoke and wet wool.",
  "Portraits lined the stairs, each face turned away from the painter.",
  "Mara set down her suitcase and asked whether her uncle was well.",
  "The old woman laughed and said that depended on what Mara meant by well."
];

// A copy of an example with the prose of each chapter `chapters` names ({
// 2: [...] }) replaced, and the Word file built from it.
function sentProse(chapters, { example = "the-gull-rock-light", args = [] } = {}) {
  const dir = makeTempDir();
  const root = path.join(dir, "book");
  fs.cpSync(path.join(repoRoot, "examples", example), root, { recursive: true });
  for (const [number, blocks] of Object.entries(chapters)) {
    const file = path.join(root, "chapters", `chapter-${String(number).padStart(2, "0")}.md`);
    fs.writeFileSync(file, proseOf(...blocks)(fs.readFileSync(file, "utf8")));
  }
  return sentBook({ root, args });
}

function heading1(text) {
  return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

describe("story apply: edits that go together are written together or not at all", () => {
  test("with a base, a move into a section that does not line up is not made, and nor is one out of it", () => {
    const rewrites = ["Nobody answered the bell for a long while.", "Eventually a girl of about ten unlatched it.", "The corridor beyond was painted bright yellow.", "Framed maps covered every wall to the ceiling."];
    for (const direction of ["in", "out"]) {
      const book = sentProse({ 1: ARRIVAL, 2: HOUSE });
      expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
      const before = treeSnapshot(book.root);
      const gull = paragraphWith(book, "A gull landed");
      const door = paragraphWith(book, "The door opened");
      const mara = paragraphWith(book, "Mara set down");
      const walked = paragraphWith(book, "She walked up the hill");
      // Four of chapter 2's six paragraphs rewritten: the section does not
      // line up with the chapter, so none of its edits is written, and a
      // move half in it is not made either.
      const rewritten = (xml) => [HOUSE[1], HOUSE[2], HOUSE[3], HOUSE[5]].reduce((text, words, index) => text.replace(paragraphWith(book, words), plain(rewrites[index])), xml);
      const file = returned(book, (xml) => rewritten(direction === "in"
        ? xml.replace(gull, "").replace(door, `${door}${gull}`)
        : xml.replace(mara, "").replace(walked, `${walked}${mara}`)));
      const { json, code } = applyJson(book, file, "--snapshot", "sent");
      expect(code).toBe(0);
      expect(treeSnapshot(book.root)).toEqual(before);
      expect(json.data.counts).toMatchObject({ changed: 0, added: 0, cut: 0, chapters: 0 });
      expect(json.data.notWritten.filter((entry) => entry.type === "moved")).toEqual([direction === "in"
        ? { type: "moved", reason: "section", file: "chapters/chapter-01.md", label: "ch01-p3", before: ARRIVAL[2], text: ARRIVAL[2], sceneBreak: false, to: "to after ch02-p1", with: null }
        : { type: "moved", reason: "section", file: "chapters/chapter-02.md", label: "ch02-p5", before: HOUSE[4], text: HOUSE[4], sceneBreak: false, to: "to after ch01-p4", with: null }]);
      expect(json.diagnostics[0].message).toContain("so none of that section's edits were written");
    }
  });

  test("a heading the editor adds inside a chapter, over a paragraph it rewrites, cuts nothing", () => {
    const book = sentBook();
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    const before = treeSnapshot(book.root);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const rewrite = "Nobody had told the keeper that the doctor left the island three days ago.";
    const file = returned(book, (xml) => xml.replace(call, `${heading1("Part Two")}${plain(rewrite)}`));
    const { json, code } = applyJson(book, file, "--snapshot", "sent");
    expect(code).toBe(0);
    expect(treeSnapshot(book.root)).toEqual(before);
    expect(json.data.notWritten).toEqual([
      { type: "cut", reason: "unplaced", file: "chapters/chapter-01.md", label: "ch01-p2", before: CALL, text: "", sceneBreak: false, to: null, with: "the paragraph the document adds after ch01-p1" },
      { type: "added", reason: "unplaced", file: "chapters/chapter-01.md", label: "after ch01-p1", before: null, text: rewrite, sceneBreak: false, to: null, with: null }
    ]);
    const result = story(book.dir, "apply", file, "--path", "book", "--snapshot", "sent");
    expect(result.stdout).toContain("**ch01-p2** · chapters/chapter-01.md · not cut: it goes with the paragraph the document adds after ch01-p1, which was not written: it is in a section that matches no chapter. story apply writes edits that go together all or none\n> Now: You call for Tobias Wren.");
    expect(result.stderr).toContain("warning: ch01-p2 in chapters/chapter-01.md was not cut, though returned.docx cuts it: it goes with the paragraph the document adds after ch01-p1, which was not written: it is in a section that matches no chapter. story apply writes edits that go together all or none. Cut it by hand if you want it");
  });

  test("with a base, a paragraph rewritten after the author cut the ones before it is replaced whole", () => {
    const book = sentProse({ 2: HOUSE });
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    fs.writeFileSync(path.join(book.root, "chapters", "chapter-02.md"), chapter(book, 2).replace(`${HOUSE[0]}\n\n${HOUSE[1]}\n\n`, ""));
    const authored = chapter(book, 2);
    const hallway = paragraphWith(book, HOUSE[2]);
    const rewrite = "The keeper's house is dark, its shutters nailed against the wind.";
    const file = returned(book, (xml) => xml.replace(hallway, plain(rewrite)));
    const { json, code } = applyJson(book, file, "--snapshot", "sent");
    expect(code).toBe(0);
    expect(chapter(book, 2)).toBe(authored.replace(HOUSE[2], rewrite));
    expect(json.data.edits.map(({ type, label, after }) => ({ type, label, after }))).toEqual([{ type: "cut", label: "ch02-p1", after: null }, { type: "added", label: null, after: null }]);
    expect(json.data.notWritten).toEqual([]);
  });

  test("a join with a paragraph that holds a link writes nothing, with a base or without", () => {
    // The joined paragraph pairs with the one it is most like: the one with
    // the link (whose change cannot be written), or the other (and the one
    // with the link would be cut, its link lost).
    const long = "You call for [Tobias Wren](../characters/tobias-wren.md). The keeper you have come to relieve should be on the landing.";
    const short = "You call for [Tobias Wren](../characters/tobias-wren.md). Nobody answers.";
    const shapes = [
      { linked: long, other: "The tower door stands open.", expected: [{ type: "changed", reason: "markup", label: "ch01-p2", goesWith: null }, { type: "cut", reason: "markup", label: "ch01-p3", goesWith: "the change to ch01-p2" }] },
      { linked: short, other: DOOR, expected: [{ type: "cut", reason: "markup", label: "ch01-p2", goesWith: null }, { type: "changed", reason: "markup", label: "ch01-p3", goesWith: "the cut of ch01-p2" }] }
    ];
    for (const { linked, other, expected } of shapes) {
      for (const args of [[], ["--snapshot", "sent"]]) {
        const book = sentEdited(proseOf(BOAT, linked, other));
        expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
        const before = treeSnapshot(book.root);
        const call = paragraphWith(book, "You call for Tobias Wren.");
        const door = paragraphWith(book, "The tower door stands open.");
        const file = returned(book, (xml) => xml.replace(door, "").replace(call, withText(call, `${textIn(call)} ${other}`)));
        const { json, code } = applyJson(book, file, ...args);
        expect(code).toBe(0);
        expect(treeSnapshot(book.root)).toEqual(before);
        expect(json.data.notWritten.map(({ type, reason, label, with: goesWith }) => ({ type, reason, label, goesWith }))).toEqual(expected);
      }
    }
  });

  test("a join is a conflict whole when the author changed the paragraph since, and is not made when it does not read back", () => {
    const book = sentBook();
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    const chapterFile = path.join(book.root, "chapters", "chapter-01.md");
    const original = chapter(book, 1);
    fs.writeFileSync(chapterFile, original.replace("You call for", "You shout for"));
    const authored = chapter(book, 1);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const door = paragraphWith(book, "The tower door stands open.");
    const joined = returned(book, (xml) => xml.replace(door, "").replace(call, withText(call, `${CALL} ${DOOR}`)), { name: "joined.docx" });
    const conflict = applyJson(book, joined, "--snapshot", "sent");
    expect(chapter(book, 1)).toBe(authored);
    expect(conflict.json.data.conflicts.map(({ label, reason }) => ({ label, reason }))).toEqual([
      { label: "ch01-p2", reason: "the document and the project both changed it since it was sent" },
      { label: "ch01-p3", reason: "the document's edit goes with the change to ch01-p2, which is a conflict, and story apply writes edits that go together all or none" }
    ]);
    // Italic that ends on a full stop with a letter after it does not read
    // back, so the paragraph joined in is not cut either.
    fs.writeFileSync(chapterFile, original);
    const odd = `<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>You call for Tobias Wren.</w:t></w:r><w:r><w:t>${xmlEscape(`${CALL.replace("You call for Tobias Wren. ", "")} ${DOOR}`)}</w:t></w:r></w:p>`;
    const unsafe = returned(book, (xml) => xml.replace(door, "").replace(call, odd), { name: "unsafe.docx" });
    const run = applyJson(book, unsafe);
    expect(chapter(book, 1)).toBe(original);
    expect(run.json.data.notWritten.map(({ type, reason, label, with: goesWith }) => ({ type, reason, label, goesWith }))).toEqual([
      { type: "changed", reason: "unsafe", label: "ch01-p2", goesWith: null },
      { type: "cut", reason: "unsafe", label: "ch01-p3", goesWith: "the change to ch01-p2" }
    ]);
  });

  for (const args of [[], ["--shunn"]]) {
    test(`a chapter heading that loses its ${args.length > 0 ? "page break" : "style"} puts none of its chapter's text into the chapter before`, () => {
      const book = sentBook({ example: "the-left-luggage-office", args });
      const before = treeSnapshot(book.root);
      const isHeading = (paragraph) => paragraph.includes(args.length > 0 ? 'w:type="page"' : 'w:val="Heading1"');
      const at = book.paragraphs.findIndex((paragraph) => isHeading(paragraph) && textIn(paragraph).startsWith("Chapter 2:"));
      const heading = book.paragraphs[at];
      const next = book.paragraphs.findIndex((paragraph, index) => index > at && isHeading(paragraph));
      const body = book.paragraphs.slice(at + 1, next).filter((paragraph) => textIn(paragraph) !== "" && !/^(?:#|\* \* \*)$/.test(textIn(paragraph)));
      const lost = args.length > 0 ? heading.replace('<w:r><w:br w:type="page"/></w:r>', "") : heading.replace('<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>', "");
      expect(lost).not.toBe(heading);
      const changed = `${textIn(body[1])} Changed.`;
      const file = returned(book, (xml) => xml.replace(heading, lost).replace(body[1], withText(body[1], changed)), { name: `lost${args.length > 0 ? ".shunn" : ""}.docx` });
      const { json, code } = applyJson(book, file);
      expect(code).toBe(0);
      expect(treeSnapshot(book.root)).toEqual(before);
      expect(json.data.counts).toMatchObject({ changed: 0, added: 0, cut: 0, chapters: 0 });
      const refused = json.data.notWritten.filter((entry) => entry.type === "added" && entry.reason === "elsewhere" && !entry.sceneBreak).map((entry) => entry.text);
      expect(refused).toEqual([textIn(heading), ...body.map((paragraph) => (paragraph === body[1] ? changed : textIn(paragraph)))]);
      expect(json.diagnostics.map((entry) => entry.code)).toContain("apply-chapter-missing");
    });
  }

  test("with a base, an edit next to paragraphs the author split or moved into another chapter is not written", () => {
    for (const authorEdit of ["split", "move"]) {
      const book = sentProse({ 2: HOUSE }, { example: "salt-and-lantern" });
      expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
      if (authorEdit === "split") {
        expect(story(book.dir, "split", "chapter-02", "--at", HOUSE[4], "--title", "Later", "--path", "book").code).toBe(0);
      } else {
        fs.writeFileSync(path.join(book.root, "chapters", "chapter-02.md"), chapter(book, 2).replace(`\n\n${HOUSE[5]}`, ""));
        fs.writeFileSync(path.join(book.root, "chapters", "chapter-01.md"), `${chapter(book, 1).trimEnd()}\n\n${HOUSE[5]}\n`);
      }
      const before = treeSnapshot(book.root);
      const mara = paragraphWith(book, "Mara set down");
      const laughed = paragraphWith(book, "The old woman laughed");
      const added = "A clock upstairs struck nine and then a tenth time.";
      const file = returned(book, (xml) => xml.replace(mara, `${mara}${plain(added)}`).replace(laughed, ""));
      const { json, code } = applyJson(book, file, "--snapshot", "sent");
      expect(code).toBe(0);
      expect(treeSnapshot(book.root)).toEqual(before);
      const cut = { file: "chapters/chapter-02.md", chapter: "chapter-02", label: null, reason: `the document cuts a paragraph the project has moved to another chapter (now ${authorEdit === "split" ? "ch03-p2" : "ch01-p10"}) since it was sent`, project: HOUSE[5], document: "", base: HOUSE[5] };
      if (authorEdit === "split") {
        // The paragraph the addition follows is in the new chapter now.
        expect(json.data.conflicts).toEqual([cut]);
        expect(json.data.notWritten).toEqual([{ type: "added", reason: "anchor", file: "chapters/chapter-02.md", label: null, before: null, text: added, sceneBreak: false, to: null, with: null }]);
        expect(story(book.dir, "apply", file, "--path", "book", "--snapshot", "sent").stdout).toContain(`**(moved to another chapter in the project)** · chapters/chapter-02.md · ${cut.reason}\n> Project: ${HOUSE[5]}\n> Document: (cut)`);
      } else {
        expect(json.data.conflicts).toEqual([{ file: "chapters/chapter-02.md", chapter: "chapter-02", label: "after ch02-p5", reason: "the document's edit goes with a cut of a paragraph, which is a conflict, and story apply writes edits that go together all or none", project: "", document: added, base: null }, cut]);
        expect(json.data.notWritten).toEqual([]);
      }
    }
  });

  test("with a base, a paragraph the editor splits and the author changed since is a conflict whole", () => {
    const book = sentBook();
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    fs.writeFileSync(path.join(book.root, "chapters", "chapter-01.md"), chapter(book, 1).replace("you have come to relieve", "you have come to replace"));
    const authored = chapter(book, 1);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const rest = CALL.replace("You call for Tobias Wren. ", "");
    const file = returned(book, (xml) => xml.replace(call, `${plain("You call for Tobias Wren.")}${plain(rest)}`));
    const { json, code } = applyJson(book, file, "--snapshot", "sent");
    expect(code).toBe(0);
    expect(chapter(book, 1)).toBe(authored);
    expect(json.data.conflicts.map(({ label, reason, document }) => ({ label, reason, document }))).toEqual([
      { label: "after ch01-p1", reason: "the document's edit goes with the change to ch01-p2, which is a conflict, and story apply writes edits that go together all or none", document: "You call for Tobias Wren." },
      { label: "ch01-p2", reason: "the document and the project both changed it since it was sent", document: rest }
    ]);
    expect(json.data.edits).toEqual([]);
  });

  test("a split whose changed half cannot be written adds nothing", () => {
    const commented = "You call for Tobias Wren. <!-- who? --> The only answer is the sea working at the rocks.";
    const book = sentEdited(proseOf(BOAT, commented, DOOR));
    const before = treeSnapshot(book.root);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(call, `${plain("You call for Tobias Wren.")}${plain("The only answer is the sea working at the rocks.")}`));
    const { json, code } = applyJson(book, file);
    expect(code).toBe(0);
    expect(treeSnapshot(book.root)).toEqual(before);
    expect(json.data.notWritten.map(({ type, reason, label, with: goesWith }) => ({ type, reason, label, goesWith }))).toEqual([
      { type: "changed", reason: "comment", label: "ch01-p2", goesWith: null },
      { type: "added", reason: "comment", label: "after ch01-p1", goesWith: "the change to ch01-p2" }
    ]);
  });

  test("with a base, a join across a paragraph the author added between the two since is a conflict", () => {
    const book = sentBook();
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    fs.writeFileSync(path.join(book.root, "chapters", "chapter-01.md"), chapter(book, 1).replace(`${CALL}\n\n`, `${CALL}\n\nThe author adds a line here.\n\n`));
    const authored = chapter(book, 1);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const door = paragraphWith(book, "The tower door stands open.");
    const file = returned(book, (xml) => xml.replace(door, "").replace(call, withText(call, `${CALL} ${DOOR}`)));
    const { json, code } = applyJson(book, file, "--snapshot", "sent");
    expect(code).toBe(0);
    expect(chapter(book, 1)).toBe(authored);
    expect(json.data.conflicts.map(({ label, reason }) => ({ label, reason }))).toEqual([
      { label: "ch01-p2", reason: "the document's edit goes with the cut of ch01-p4, which is a conflict, and story apply writes edits that go together all or none" },
      { label: "ch01-p4", reason: "the project has paragraphs in this passage, or its paragraphs in another order, that the version sent did not" }
    ]);
  });

  test("a sentence the editor moves from one paragraph to another is written in both or in neither", () => {
    const linkedDoor = "The tower door stands [open](../x.md). A coil of rope lies across the path.";
    const book = sentEdited(proseOf(BOAT, CALL, linkedDoor));
    const before = treeSnapshot(book.root);
    const boat = paragraphWith(book, "The supply boat backs off");
    const door = paragraphWith(book, "The tower door stands open.");
    const moved = "The boatman does not wait for thanks.";
    const file = returned(book, (xml) => xml.replace(boat, withText(boat, BOAT.replace(` ${moved}`, ""))).replace(door, withText(door, `${textIn(door)} ${moved}`)));
    const { json, code } = applyJson(book, file);
    expect(code).toBe(0);
    expect(treeSnapshot(book.root)).toEqual(before);
    expect(json.data.notWritten.map(({ type, reason, label, with: goesWith }) => ({ type, reason, label, goesWith }))).toEqual([
      { type: "changed", reason: "markup", label: "ch01-p1", goesWith: "the change to ch01-p3" },
      { type: "changed", reason: "markup", label: "ch01-p3", goesWith: null }
    ]);
  });

  test("without a base, a joined paragraph whose words the editor changed is not written beside the paragraph kept", () => {
    const book = sentBook();
    const before = treeSnapshot(book.root);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const door = paragraphWith(book, "The tower door stands open.");
    // The first sentence of the paragraph joined in is the same, the rest
    // changed, so its cut is not seen as a join: it is kept, and the change
    // would write that sentence a second time.
    const file = returned(book, (xml) => xml.replace(door, "").replace(call, withText(call, `${CALL} ${DOOR.replace("east ledge", "west ledge")}`)));
    const { json, code } = applyJson(book, file);
    expect(code).toBe(0);
    expect(treeSnapshot(book.root)).toEqual(before);
    expect(json.data.kept.map((entry) => entry.label)).toEqual(["ch01-p3"]);
    expect(json.data.notWritten.map(({ type, reason, label }) => ({ type, reason, label }))).toEqual([{ type: "changed", reason: "repeats", label: "ch01-p2" }]);
  });

  test("with a base, a document applied twice makes its edits once", () => {
    const book = sentBook();
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    const boat = paragraphWith(book, "The supply boat backs off");
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const door = paragraphWith(book, "The tower door stands open.");
    const file = returned(book, (xml) => xml.replace(boat, withText(boat, BOAT.replace("backs off", "pulls away from"))).replace(call, "").replace(door, `${door}${call}${plain("A gull cries once.")}`));
    const first = applyJson(book, file, "--snapshot", "sent");
    expect(first.json.data.counts).toMatchObject({ changed: 1, added: 2, cut: 1, conflicts: 0, notWritten: 0 });
    const once = chapter(book, 1);
    const again = applyJson(book, file, "--snapshot", "sent");
    expect(again.json.data.counts).toEqual({ changed: 0, added: 0, cut: 0, conflicts: 0, kept: 0, notWritten: 0, chapters: 0 });
    expect(chapter(book, 1)).toBe(once);
  });

  test("a moved paragraph takes a comment at the end of its line along, to its chapter or another", () => {
    const commented = `${CALL} <!-- check the name -->`;
    for (const target of ["The tower door stands open.", "There is no one inside it."]) {
      const book = sentEdited(proseOf(BOAT, commented, DOOR));
      const one = chapter(book, 1);
      const two = chapter(book, 2);
      const call = paragraphWith(book, "You call for Tobias Wren.");
      const after = paragraphWith(book, target);
      const file = returned(book, (xml) => xml.replace(call, "").replace(after, `${after}${call}`));
      const result = story(book.dir, "apply", file, "--path", "book");
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("Edits applied: 0 errors, 0 warnings, 0 dismissed\n");
      if (target === "The tower door stands open.") {
        expect(chapter(book, 1)).toBe(one.replace(`${commented}\n\n${DOOR}`, `${DOOR}\n\n${commented}`));
      } else {
        expect(chapter(book, 1)).toBe(one.replace(`${commented}\n\n`, ""));
        expect(chapter(book, 2)).toBe(two.replace("There is no one inside it.", `There is no one inside it.\n\n${commented}`));
      }
    }
  });

  test("a paragraph whose comment runs on past its line is not moved", () => {
    const book = sentEdited(proseOf(BOAT, `${CALL} <!-- a note\nthat runs on -->`, DOOR));
    const before = treeSnapshot(book.root);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const door = paragraphWith(book, "The tower door stands open.");
    const file = returned(book, (xml) => xml.replace(call, "").replace(door, `${door}${call}`));
    const { json, code } = applyJson(book, file);
    expect(code).toBe(0);
    expect(treeSnapshot(book.root)).toEqual(before);
    expect(json.data.notWritten).toEqual([{ type: "moved", reason: "comment", file: "chapters/chapter-01.md", label: "ch01-p2", before: CALL, text: CALL, sceneBreak: false, to: "to after ch01-p3", with: null }]);
    expect(story(book.dir, "apply", file, "--path", "book").stderr).toContain("ch01-p2 in chapters/chapter-01.md stays where it is, though returned.docx moves it to after ch01-p3: a comment on its line runs on past it, so moving it would leave part of the comment");
  });

  test("with a base, a heavy copyedit is written paragraph by paragraph: the one paragraph the author changed since is the only conflict", () => {
    const book = sentBook({ example: "the-last-ember" });
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    const chapterFile = path.join(book.root, "chapters", "chapter-01.md");
    const sent = chapter(book, 1);
    // Since sending, the author changed one sentence of ch01-p5.
    fs.writeFileSync(chapterFile, sent.replace("Trees didn't, no matter what the Vale hermits claimed.", "Trees never did, whatever the hermits said."));
    const authored = chapter(book, 1);
    // The editor changed every body paragraph of the chapter: one word put
    // in front of each, so no paragraph is left as sent between them.
    const prose = book.body.filter((paragraph) => textIn(paragraph) !== "");
    expect(prose.length).toBe(54);
    const file = returned(book, (xml) => prose.reduce((text, paragraph) => text.replace(paragraph, paragraph.replace(/(<w:t[^>]*>)/, "$1Then ")), xml));
    const { json, code } = applyJson(book, file, "--snapshot", "sent");
    expect(code).toBe(0);
    expect(json.data.counts).toEqual({ changed: 53, added: 0, cut: 0, conflicts: 1, kept: 0, notWritten: 0, chapters: 1 });
    expect(json.diagnostics.map((entry) => entry.code)).toEqual(["apply-conflict"]);
    expect(json.data.conflicts.map(({ label, reason }) => ({ label, reason }))).toEqual([{ label: "ch01-p5", reason: "the document and the project both changed it since it was sent" }]);
    const merged = chapter(book, 1);
    // The paragraph both changed is the author's; its neighbours, and the
    // chapter's first and last paragraphs, are the editor's.
    expect(merged).toContain("\n\nThe tree didn't answer. Trees never did, whatever the hermits said.");
    expect(merged).toContain("\n\nThen \"You feel it too,\" she murmured.\n\nThe tree didn't answer.");
    expect(merged).toContain("\n\nThen She pulled her hand back and studied her fingers.");
    expect(merged).toContain("\n\nThen The grove was quieter than it should have been.\n\n");
    expect(merged).toMatch(/\n\nThen But it was a start\.\n$/);
    expect(merged.split("\n\nThen ").length - 1).toBe(53);
    expect(merged.replaceAll("\n\nThen ", "\n\n")).toBe(authored);
  });

  test("without a base, a paragraph with a link holds back its own change only, when the editor changed every paragraph", () => {
    const linked = "You call for [Tobias Wren](../characters/tobias-wren.md). Nobody answers you.";
    const book = sentEdited(proseOf(BOAT, linked, DOOR));
    const original = chapter(book, 1);
    const boat = paragraphWith(book, "The supply boat backs off");
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const door = paragraphWith(book, "The tower door stands open.");
    const file = returned(book, (xml) => xml
      .replace(boat, withText(boat, BOAT.replace("backs off", "pulls away from")))
      .replace(call, withText(call, "You call for Tobias Wren. Nobody answers."))
      .replace(door, withText(door, DOOR.replace("stands open", "is open"))));
    const { json, code } = applyJson(book, file);
    expect(code).toBe(0);
    expect(chapter(book, 1)).toBe(original.replace("backs off", "pulls away from").replace("stands open", "is open"));
    expect(json.data.edits.map(({ type, label }) => ({ type, label }))).toEqual([{ type: "changed", label: "ch01-p1" }, { type: "changed", label: "ch01-p3" }]);
    expect(json.data.notWritten).toEqual([{ type: "changed", reason: "markup", file: "chapters/chapter-01.md", label: "ch01-p2", before: "You call for Tobias Wren. Nobody answers you.", text: "You call for Tobias Wren. Nobody answers.", sceneBreak: false, to: null, with: null }]);
    expect(json.diagnostics.map((entry) => entry.code)).toEqual(["apply-not-written"]);
  });

  test("with a base, a paragraph added beside one the author changed since is written there, beside a conflict too, unless its sentences come from that paragraph", () => {
    for (const editor of ["changes it", "leaves it", "splits it"]) {
      const book = sentBook();
      expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
      const chapterFile = path.join(book.root, "chapters", "chapter-01.md");
      fs.writeFileSync(chapterFile, chapter(book, 1).replace("You call for", "You shout for"));
      const authored = chapter(book, 1);
      const call = paragraphWith(book, "You call for Tobias Wren.");
      const added = "Somewhere above, a shutter bangs once and is still.";
      const rest = CALL.replace("You call for Tobias Wren. ", "");
      const replacement = {
        "changes it": `${withText(call, CALL.replace("You call", "You cry"))}${plain(added)}`,
        "leaves it": `${call}${plain(added)}`,
        "splits it": `${plain("You call for Tobias Wren.")}${plain(rest)}`
      }[editor];
      const file = returned(book, (xml) => xml.replace(call, replacement));
      const { json, code } = applyJson(book, file, "--snapshot", "sent");
      expect(code).toBe(0);
      expect(json.data.notWritten).toEqual([]);
      if (editor === "splits it") {
        // The paragraph added holds sentences the change takes out of the
        // paragraph both changed, so it goes with that conflict.
        expect(chapter(book, 1)).toBe(authored);
        expect(json.data.conflicts.map(({ label, reason }) => ({ label, reason }))).toEqual([
          { label: "after ch01-p1", reason: "the document's edit goes with the change to ch01-p2, which is a conflict, and story apply writes edits that go together all or none" },
          { label: "ch01-p2", reason: "the document and the project both changed it since it was sent" }
        ]);
        continue;
      }
      expect(chapter(book, 1)).toBe(authored.replace(/(You shout for Tobias Wren\.[^\n]*)/, `$1\n\n${added}`));
      expect(json.data.edits.map(({ type, after }) => ({ type, after }))).toEqual([{ type: "added", after: "ch01-p2" }]);
      expect(json.data.conflicts.map(({ label }) => label)).toEqual(editor === "changes it" ? ["ch01-p2"] : []);
    }
  });

  test("with a base, a cut and an addition side by side are made together or not at all, whichever of the two cannot be made", () => {
    for (const refused of ["cut", "addition"]) {
      const book = sentEdited(proseOf(BOAT, refused === "cut" ? CALL.replace("Wren. ", "Wren. <!-- who? --> ") : CALL, DOOR));
      expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
      const original = chapter(book, 1);
      const boat = paragraphWith(book, "The supply boat backs off");
      const call = paragraphWith(book, "You call for Tobias Wren.");
      // A paragraph unlike the one it takes the place of: a cut and an
      // addition, which may be a rewrite. Italic that ends on a full stop
      // with a letter after it does not read back as markdown.
      const addition = refused === "cut"
        ? plain("Nobody waits on the landing tonight.")
        : "<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Odd.</w:t></w:r><w:r><w:t>x more words here</w:t></w:r></w:p>";
      const file = returned(book, (xml) => xml.replace(call, addition).replace(boat, withText(boat, BOAT.replace("backs off", "pulls away from"))));
      const { json, code } = applyJson(book, file, "--snapshot", "sent");
      expect(code).toBe(0);
      // The change before them is an edit of its own, and is written.
      expect(chapter(book, 1)).toBe(original.replace("backs off", "pulls away from"));
      expect(json.data.edits.map(({ type, label }) => ({ type, label }))).toEqual([{ type: "changed", label: "ch01-p1" }]);
      expect(json.data.notWritten.map(({ type, reason, label, with: goesWith }) => ({ type, reason, label, goesWith }))).toEqual(refused === "cut"
        ? [{ type: "cut", reason: "comment", label: "ch01-p2", goesWith: null }, { type: "added", reason: "comment", label: "after ch01-p1", goesWith: "the cut of ch01-p2" }]
        : [{ type: "cut", reason: "unsafe", label: "ch01-p2", goesWith: "the paragraph the document adds after ch01-p1" }, { type: "added", reason: "unsafe", label: "after ch01-p1", goesWith: null }]);
    }
  });

  test("a sentence moved into one paragraph and another split out of the same paragraph tie the three edits together", () => {
    const keeper = "The keeper you have come to relieve should be on the landing with a lantern and a list of complaints.";
    const sea = "The only answer is the sea working at the rocks.";
    for (const opening of [BOAT, BOAT.replace("the landing", "the [landing](../x.md)")]) {
      const book = sentEdited(proseOf(opening, CALL, DOOR));
      const original = chapter(book, 1);
      const boat = paragraphWith(book, "The supply boat backs off");
      const call = paragraphWith(book, "You call for Tobias Wren.");
      // The last sentence of ch01-p2 goes to the end of ch01-p1, and its
      // first becomes a paragraph of its own after it.
      const file = returned(book, (xml) => xml
        .replace(boat, withText(boat, `${textIn(boat)} ${sea}`))
        .replace(call, `${withText(call, keeper)}${plain("You call for Tobias Wren.")}`));
      const { json, code } = applyJson(book, file);
      expect(code).toBe(0);
      if (opening === BOAT) {
        expect(chapter(book, 1)).toBe(original.replace(BOAT, `${BOAT} ${sea}`).replace(CALL, `${keeper}\n\nYou call for Tobias Wren.`));
        expect(json.data.notWritten).toEqual([]);
        continue;
      }
      // The first paragraph's link holds back its change, and with it the
      // two edits its sentence links it to.
      expect(chapter(book, 1)).toBe(original);
      expect(json.data.notWritten.map(({ type, reason, label, with: goesWith }) => ({ type, reason, label, goesWith }))).toEqual([
        { type: "changed", reason: "markup", label: "ch01-p1", goesWith: null },
        { type: "changed", reason: "markup", label: "ch01-p2", goesWith: "the change to ch01-p1" },
        { type: "added", reason: "markup", label: "after ch01-p2", goesWith: "the change to ch01-p1" }
      ]);
    }
  });

  test("with a base, a join or a split whose text has no sentence end to follow is still one edit", () => {
    const dark = "The wind rose and the lamp went dark—";
    const unseen = "and nobody on the island saw it go";
    for (const shape of ["join", "split"]) {
      const book = sentEdited(proseOf(BOAT, ...(shape === "join" ? [dark, unseen] : [`${dark} ${unseen}`]), DOOR));
      expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
      const chapterFile = path.join(book.root, "chapters", "chapter-01.md");
      // The author changed the paragraph the editor joins into, or splits.
      fs.writeFileSync(chapterFile, chapter(book, 1).replace("The wind rose", "The gale rose"));
      const authored = chapter(book, 1);
      const first = paragraphWith(book, "The wind rose");
      const file = returned(book, (xml) => (shape === "join"
        ? xml.replace(paragraphWith(book, unseen), "").replace(first, withText(first, `${dark} ${unseen}`))
        : xml.replace(first, `${plain(dark)}${plain(unseen)}`)));
      const { json, code } = applyJson(book, file, "--snapshot", "sent");
      expect(code).toBe(0);
      // Neither half is made: the joined paragraph's text is not lost, and
      // the split one's is not there twice.
      expect(chapter(book, 1)).toBe(authored);
      expect(json.data.conflicts.map(({ label, reason }) => ({ label, reason }))).toEqual(shape === "join"
        ? [{ label: "ch01-p2", reason: "the document and the project both changed it since it was sent" }, { label: "ch01-p3", reason: "the document's edit goes with the change to ch01-p2, which is a conflict, and story apply writes edits that go together all or none" }]
        : [{ label: "ch01-p2", reason: "the document and the project both changed it since it was sent" }, { label: "after ch01-p2", reason: "the document's edit goes with the change to ch01-p2, which is a conflict, and story apply writes edits that go together all or none" }]);
    }
  });

  test("with a base, a change to a paragraph the author moved to another chapter since is a conflict, and the change beside it is written", () => {
    const book = sentBook();
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    fs.writeFileSync(path.join(book.root, "chapters", "chapter-01.md"), chapter(book, 1).replace(`${CALL}\n\n`, ""));
    fs.writeFileSync(path.join(book.root, "chapters", "chapter-02.md"), `${chapter(book, 2).trimEnd()}\n\n${CALL}\n`);
    const one = chapter(book, 1);
    const two = chapter(book, 2);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const door = paragraphWith(book, "The tower door stands open.");
    const file = returned(book, (xml) => xml.replace(call, withText(call, CALL.replace("You call", "You shout"))).replace(door, withText(door, DOOR.replace("stands open", "is open"))));
    const { json, code } = applyJson(book, file, "--snapshot", "sent");
    expect(code).toBe(0);
    expect(chapter(book, 1)).toBe(one.replace("stands open", "is open"));
    expect(chapter(book, 2)).toBe(two);
    expect(json.data.conflicts).toEqual([{ file: "chapters/chapter-01.md", chapter: "chapter-01", label: null, reason: "the document changes a paragraph the project has moved to another chapter (now ch02-p4) since it was sent", project: CALL, document: CALL.replace("You call", "You shout"), base: CALL }]);
    expect(json.data.edits.map(({ type, label }) => ({ type, label }))).toEqual([{ type: "changed", label: "ch01-p2" }]);
  });

  test("text moved into or next to a chapter whose heading the document lost is not written, and nor is a move there", () => {
    const book = sentBook();
    const before = treeSnapshot(book.root);
    const heading = book.paragraphs.find((paragraph) => paragraph.includes('w:val="Heading1"') && textIn(paragraph).startsWith("Chapter 3:"));
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const door = paragraphWith(book, "The tower door stands open.");
    const reef = paragraphWith(book, "Out past the reef");
    const stair = paragraphWith(book, "The stair turns and turns.");
    const floor = paragraphWith(book, "Tobias Wren is on the watch-room floor");
    const boat = paragraphWith(book, "The supply boat backs off");
    // Chapter 3's heading loses its style, so its section is lost. Two of
    // its paragraphs go to chapter 1, one of them with a word changed, and a
    // paragraph of chapter 1 goes to the end of chapter 2, where chapter 3's
    // text now follows.
    const changed = textIn(floor).replace("ankle", "leg");
    const file = returned(book, (xml) => xml
      .replace(heading, heading.replace('<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>', ""))
      .replace(stair, "")
      .replace(door, `${door}${stair}`)
      .replace(floor, "")
      .replace(boat, `${withText(floor, changed)}${boat}`)
      .replace(call, "")
      .replace(reef, `${reef}${call}`));
    const { json, code } = applyJson(book, file);
    expect(code).toBe(0);
    expect(treeSnapshot(book.root)).toEqual(before);
    expect(json.data.counts).toMatchObject({ changed: 0, added: 0, cut: 0, chapters: 0 });
    expect(json.data.notWritten.filter((entry) => entry.type === "moved")).toEqual([{ type: "moved", reason: "elsewhere", file: "chapters/chapter-01.md", label: "ch01-p2", before: CALL, text: CALL, sceneBreak: false, to: "into text the document may have from a chapter whose heading it lost", with: null }]);
    for (const text of [textIn(stair), changed]) {
      expect(json.data.notWritten).toContainEqual({ type: "added", reason: "elsewhere", file: null, label: null, before: null, text, sceneBreak: false, to: null, with: null });
    }
  });

  test("with a base, a scene break the editor adds where the author added one since is not added again, and one added elsewhere is", () => {
    const book = sentBook();
    expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
    fs.writeFileSync(path.join(book.root, "chapters", "chapter-01.md"), chapter(book, 1).replace(`${BOAT}\n\n`, `${BOAT}\n\n* * *\n\n`));
    const authored = chapter(book, 1);
    const call = paragraphWith(book, "You call for Tobias Wren.");
    const door = paragraphWith(book, "The tower door stands open.");
    const file = returned(book, (xml) => xml.replace(call, `${plain("* * *")}${call}`).replace(door, `${plain("* * *")}${door}`));
    const { json, code } = applyJson(book, file, "--snapshot", "sent");
    expect(code).toBe(0);
    expect(chapter(book, 1)).toBe(authored.replace(`${CALL}\n\n`, `${CALL}\n\n* * *\n\n`));
    expect(json.data.edits.map(({ type, after, sceneBreak }) => ({ type, after, sceneBreak }))).toEqual([{ type: "added", after: "ch01-p2", sceneBreak: true }]);
    expect(json.data.notWritten).toEqual([]);
  });

  test("a join of a paragraph that holds a link, whose text has no sentence end to follow, cuts nothing", () => {
    const dark = "The wind rose and the lamp went dark—";
    const unseen = "and nobody on [the island](../x.md) saw it go";
    for (const args of [[], ["--snapshot", "sent"]]) {
      const book = sentEdited(proseOf(BOAT, dark, unseen, DOOR));
      expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
      const before = treeSnapshot(book.root);
      const first = paragraphWith(book, "The wind rose");
      const second = paragraphWith(book, "nobody on the island");
      const file = returned(book, (xml) => xml.replace(second, "").replace(first, withText(first, `${dark} and nobody on the island saw it go`)));
      const { json, code } = applyJson(book, file, ...args);
      expect(code).toBe(0);
      expect(treeSnapshot(book.root)).toEqual(before);
      expect(json.data.notWritten.map(({ type, reason, label, with: goesWith }) => ({ type, reason, label, goesWith }))).toEqual([
        { type: "changed", reason: "markup", label: "ch01-p2", goesWith: "the cut of ch01-p3" },
        { type: "cut", reason: "markup", label: "ch01-p3", goesWith: null }
      ]);
    }
  });
});
