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
import { git, makeTempDir, memoryIo, treeSnapshot, whileWriting } from "./helpers.js";

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
    expect(result.stderr).toContain('warning: ch01-p5 in chapters/chapter-01.md: the document and the project both changed it since it was sent, so the project\'s text was kept. Project: ""You feel it," she whispered.". Document: ""You feel it too?" she asked."');
    expect(result.stdout).toContain("## Conflicts: the project's text was kept");
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
    expect(applied.stderr).toContain("warning: 1 paragraph in returned.docx holds hidden text, which Word shows neither the editor nor the author; it was left out of the chapters [apply-hidden-text]");
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
    expect(codes(result.stderr).sort()).toEqual(["apply-chapter-missing", "apply-heading-changed", "apply-heading-changed", "apply-section-unplaced"]);
    expect(result.stderr).toContain('returned.docx changes the heading of chapters/chapter-01.md from "Chapter 1: The Landing" to "Chapter 1: Landfall"');
    expect(result.stderr).toContain('The section of returned.docx headed "Appendix" matches no chapter or matter page of this book, so its 1 paragraph was not written');
    expect(result.stderr).toContain("returned.docx has no section for chapters/chapter-06.md, so it was left as it is");
  });

  test("a file from another book matches nothing and writes nothing", () => {
    const book = sentBook();
    const other = sentBook({ example: "the-last-ember" });
    const before = treeSnapshot(book.root);
    const result = story(book.dir, "apply", other.sent, "--path", "book");
    expect(result.code).toBe(0);
    expect(codes(result.stderr)).toEqual(["apply-section-unplaced"]);
    expect(result.stderr).toContain("None of ");
    expect(treeSnapshot(book.root)).toEqual(before);
  });

  test("reordered chapters are reported, and their own edits still written", () => {
    const book = sentBook();
    const headings = book.paragraphs.filter((paragraph) => paragraph.includes('w:val="Heading1"'));
    const second = book.xml.slice(book.xml.indexOf(headings[1]), book.xml.indexOf(headings[2]));
    const target = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(second, "").replace(headings[0], `${second}${headings[0]}`).replace(target, withText(target, "You call again.")));
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(codes(result.stderr)).toEqual(["apply-chapters-reordered"]);
    expect(chapter(book, 1)).toContain("You call again.");
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
    expect(result.stderr).toContain("A change in returned.docx was not written: it is not chapter text (the title page, a byline, or a matter page)");
    expect(result.stdout).toContain("## Not written: make these by hand if you want them");
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
    const paragraphs = (text) => text.slice(text.indexOf("## Chapter Text")).split("\n\n").map((block) => block.trim().slice(0, 20));
    const moved = paragraphs(chapter(book, 1));
    expect(moved.indexOf("The supply boat back")).toBeGreaterThan(moved.indexOf("The tower door stand"));
    expect(chapter(book, 1).length).toBe(original.length);
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
    expect(result.stderr).toContain("A change in returned.docx was not written: it is not chapter text");
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
    expect(chapter(book, 1)).toBe(authored.replace("The tower door stands open.", "A new line.\n\nThe tower door stands open."));
    expect(codes(result.stderr)).toEqual(["apply-conflict", "apply-not-written"]);
    expect(result.stderr).toContain("A paragraph in chapters/chapter-01.md: the document changes a paragraph the project has cut since it was sent");
    expect(result.stderr).toContain("was not written: it holds an HTML comment, which rewriting it would lose");
    expect(result.stdout).toContain("**(cut in the project)** · chapters/chapter-01.md");
    expect(result.stdout).toContain("**after ch01-p3** · added\n> Added: A new line.");
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
    // close the emphasis there, so the asterisks would print.
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

  test("a write that fails after the snapshot names the snapshot that puts the project back", () => {
    const book = sentBook();
    const target = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(target, withText(target, "You shout.")));
    const chapterFile = path.join(book.root, "chapters", "chapter-01.md");
    const spy = whileWriting(chapterFile, () => fs.appendFileSync(chapterFile, "\nSaved meanwhile.\n"));
    let result;
    try {
      result = story(book.dir, "apply", file, "--path", "book");
    } finally {
      spy.mockRestore();
    }
    expect(result.code).toBe(4);
    expect(result.stderr).toContain("Snapshot before-apply-1 holds the project as it was before this apply: story snapshot --restore before-apply-1 --path book puts it back");
    expect(chapter(book, 1)).toContain("Saved meanwhile.");
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

  test("refuses while another command's change is half made, and a dry run refuses its own", () => {
    const book = sentBook();
    fs.writeFileSync(path.join(book.root, UNDO_LOG), `${JSON.stringify({ command: "story split chapter-01 --at 1", started: "2026-01-01T00:00:00Z" })}\n`);
    const result = story(book.dir, "apply", book.sent, "--path", "book");
    expect(result.stderr).toContain("story split chapter-01 --at 1 stopped part way");
    expect(result.code).toBe(4);
    const dry = story(book.dir, "apply", book.sent, "--path", "book", "--dry-run");
    expect(dry.code).toBe(4);
  });

  test("an apply that stopped part way is put back first when the same apply runs again", () => {
    const book = sentBook();
    const original = chapter(book, 1);
    const target = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(target, withText(target, "You shout.")));
    const chapterFile = path.join(book.root, "chapters", "chapter-01.md");
    expect(() => withUndoLog(book.root, "story apply returned.docx", () => {
      writeFile(chapterFile, "half written\n", { root: book.root, unchangedFrom: original });
      throw new Error("stopped");
    })).toThrow("stopped");
    const result = story(book.dir, "apply", "returned.docx", "--path", "book");
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("note: story apply returned.docx stopped part way, so this first put back the 1 file it had changed");
    expect(chapter(book, 1)).toBe(original.replace(/You call for Tobias Wren\.[^\n]*/, "You shout."));
    expect(fs.existsSync(path.join(book.root, UNDO_LOG))).toBe(false);
  });

  test("a snapshot that cannot be saved stops it before any chapter is written", () => {
    const book = sentBook();
    const original = chapter(book, 1);
    const target = paragraphWith(book, "You call for Tobias Wren.");
    const file = returned(book, (xml) => xml.replace(target, withText(target, "You shout.")));
    fs.writeFileSync(path.join(book.root, ".snapshots"), "not a folder");
    const result = story(book.dir, "apply", file, "--path", "book");
    expect(result.stderr).toContain("story apply stopped before writing any chapter: it could not save the project as snapshot before-apply-1 first");
    expect(result.code).not.toBe(0);
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
    const gap = alignItems(items(...Array.from({ length: 600 }, (unused, index) => `a${index}`), "*"), items(...Array.from({ length: 600 }, (unused, index) => `b${index}`), "x"));
    expect(gap.filter((op) => op.type === "change")).toHaveLength(600);
    expect(gap.slice(-2)).toEqual([{ type: "insert", right: 600 }, { type: "cut", left: 600 }]);
  });

  test("a long list with few matches still aligns by its unique paragraphs", () => {
    const left = Array.from({ length: 2500 }, (unused, index) => `left ${index}`);
    const right = Array.from({ length: 2500 }, (unused, index) => (index % 500 === 0 ? `left ${index}` : `right ${index}`));
    const ops = alignItems(items(...left), items(...right));
    expect(ops.filter((op) => op.type === "same")).toHaveLength(5);
  });
});
