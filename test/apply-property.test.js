import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { xmlText, zipEntries } from "../src/docx.js";
import { parseFrontmatter } from "../src/frontmatter.js";
import { commentRanges } from "../src/markdown.js";
import { writeZip } from "../src/packaging.js";
import { makeTempDir, memoryIo } from "./helpers.js";

// story apply writes an editor's Word file into the chapters. Its rule: when
// unsure, write less and report more, and never lose, repeat, or misplace a
// writer's prose without a report entry that names the paragraph. This test
// writes random books whose every sentence holds a token found nowhere else
// in the book (zq<n>), so sentences can be counted; builds the Word file
// (plain or Shunn); edits it as an editor might; edits the project as an
// author might after sending it; runs story apply with the version sent as
// the base and without one; and checks, for each run that exits 0:
//
//   S1 no silent loss: a sentence the project had and lost is not in the
//      document either, and an edit (cut or changed) of the report covers
//      it. With a base, a sentence the author added since sending stays.
//   S2 no duplication: no sentence is in the project more often than it was
//      before the run or than it is in the document.
//   S3 no invention: every sentence after the run was in the project or is
//      in the document.
//   S4 accounting: a sentence new in the document (not in the version sent,
//      or not in the project without a base) and not in the project after
//      the run is named by a not-written, conflict, or kept entry.
//   S5 scope: chapter frontmatter and every file that is not a chapter keep
//      their bytes, and a dry run changes nothing.
//   S6 stability: the same document applied again plans no edit the first
//      run wrote.
//   S7 every chapter still parses, and story validate finds no new error.
//
// A fixed seed runs in `bun run test`, and CI runs seeds 1 to 5. To search
// further:
//   STORY_PROPERTY_RUNS=300 STORY_PROPERTY_SEED=7 bun test ./test/apply-property.test.js
// (the time limit grows with the run count). STORY_PROPERTY_SEED=random
// picks a seed and prints it. A failure prints its seed, its case, the
// operations, and the report; STORY_PROPERTY_CASE=<n> runs that case of the
// seed alone, STORY_PROPERTY_KEEP=<folder> keeps each case there to replay
// by hand, and STORY_PROPERTY_STATS=1 prints what the runs wrote in all.
// Fix what a failure finds in src/apply.js, never by loosening a check or
// narrowing what the cases make.

const RUNS = Number(process.env.STORY_PROPERTY_RUNS ?? 40);
const SEED = process.env.STORY_PROPERTY_SEED === "random"
  ? Math.floor(Math.random() * 2 ** 31)
  : Number(process.env.STORY_PROPERTY_SEED ?? 20261112);
const ONLY = process.env.STORY_PROPERTY_CASE === undefined ? null : Number(process.env.STORY_PROPERTY_CASE);

// What the runs wrote and reported, summed, printed with STORY_PROPERTY_STATS=1.
const STATS = new Map();

const WORDS = ["harbour", "lantern", "quiet", "stone", "river", "morning", "window", "letter", "shadow", "garden", "road", "candle", "winter", "bridge", "silver", "market", "orchard", "kettle", "ladder", "pocket", "engine", "station", "tower", "meadow", "rope", "salt", "thread", "copper", "valley", "gull", "ferry", "chapel", "cellar", "attic", "basket"];
const TOKEN = /\bzq\d+\b/g;
const HAS_TOKEN = /\bzq\d+\b/;

// A small fast generator (mulberry32), so a seed gives the same case on
// every machine.
function generator(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const int = (low, high) => low + Math.floor(next() * (high - low + 1));
  const pick = (list) => list[Math.floor(next() * list.length)];
  const chance = (share) => next() < share;
  return { next, int, pick, chance };
}

function story(cwd, ...argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, stdout: io.output(), stderr: io.error() };
}

// --- Books ---------------------------------------------------------------

// Sentences: a capital word, the token, and plain words, ending in a full
// stop that is the only one in it.
function sentenceMaker(random) {
  let next = 0;
  return () => {
    next += 1;
    const words = Array.from({ length: random.int(4, 8) }, () => random.pick(WORDS));
    const first = random.pick(WORDS);
    return `${first[0].toUpperCase()}${first.slice(1)} zq${next} ${words.join(" ")}.`;
  };
}

// A plain word after the token of one of the sentences of `text`, wrapped by
// `wrap`, or null when there is none to wrap.
function wrapWord(random, text, wrap) {
  const spots = [...text.matchAll(/zq\d+ ([a-z]+)\b/g)];
  if (spots.length === 0) {
    return null;
  }
  const spot = random.pick(spots);
  const start = spot.index + spot[0].length - spot[1].length;
  return `${text.slice(0, start)}${wrap(spot[1])}${text.slice(start + spot[1].length)}`;
}

// One paragraph's markdown: plain sentences, or with a link, inline code, an
// inline or end-of-line comment, a block quote, a hard line break, or
// emphasis.
function paragraphMarkdown(random, sentence) {
  const sentences = Array.from({ length: random.int(1, 3) }, sentence);
  let text = sentences.join(" ");
  const kind = random.pick(["plain", "plain", "plain", "plain", "link", "code", "comment", "end-comment", "quote", "break", "emphasis"]);
  if (kind === "link") {
    text = wrapWord(random, text, (word) => `[${word}](https://example/${word})`) ?? text;
  } else if (kind === "code") {
    text = wrapWord(random, text, (word) => `\`${word}\``) ?? text;
  } else if (kind === "comment" && sentences.length > 1) {
    text = `${sentences[0]} <!-- note --> ${sentences.slice(1).join(" ")}`;
  } else if (kind === "end-comment") {
    text = `${text} <!-- check this -->`;
  } else if (kind === "quote") {
    text = `> ${text}`;
  } else if (kind === "break" && sentences.length > 1) {
    text = `${sentences[0]}  \n${sentences.slice(1).join(" ")}`;
  } else if (kind === "emphasis") {
    text = wrapWord(random, text, (word) => `*${word}*`) ?? text;
  }
  return text;
}

function chapterFile(number, title, blocks) {
  const body = blocks.length === 0 ? "" : `${blocks.join("\n\n")}\n`;
  return `---\ntitle: ${title}\nnumber: ${number}\nstatus: draft\nword-count: 0\n---\n\n# Chapter ${number}: ${title}\n\n## Chapter Text\n\n${body}`;
}

let template = null;

// A new project with `chapters` chapters of random prose, registries and
// word counts up to date.
function writeBook(random, sentence) {
  if (template === null || !fs.existsSync(template)) {
    const dir = makeTempDir("story-apply-template-");
    expect(story(dir, "init", "Prop Book").code).toBe(0);
    template = path.join(dir, "prop-book");
  }
  const dir = makeTempDir("story-apply-property-");
  const root = path.join(dir, "book");
  fs.cpSync(template, root, { recursive: true });
  const titles = ["Arrival", "The House", "The Uncle", "The Shore", "Night"];
  const count = random.int(2, 4);
  for (let number = 1; number <= count; number += 1) {
    const blocks = [];
    const size = random.int(2, 7);
    for (let index = 0; index < size; index += 1) {
      if (index > 0 && random.chance(0.08)) {
        blocks.push("* * *");
      }
      blocks.push(paragraphMarkdown(random, sentence));
    }
    fs.writeFileSync(path.join(root, "chapters", `chapter-${String(number).padStart(2, "0")}.md`), chapterFile(number, titles[number - 1], blocks));
  }
  expect(story(dir, "reindex", "book").code).toBe(0);
  expect(story(dir, "wordcount", "book", "--write").code).toBe(0);
  return { dir, root };
}

// --- The editor's Word file ---------------------------------------------

function xmlEscape(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function textOf(xml) {
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:br\/>/g)]
    .map((match) => (match[1] === undefined ? " " : match[1]))
    .join("")
    .replace(/&(amp|lt|gt|quot|apos);/g, (whole, name) => entities[name]);
}

const SHUNN_BODY = '<w:pPr><w:spacing w:line="480" w:lineRule="auto"/><w:ind w:firstLine="720"/></w:pPr>';
const SHUNN_RUN = '<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="24"/></w:rPr>';
const SHUNN_CENTER = '<w:pPr><w:spacing w:line="480" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr>';

// The build's paragraphs as items: { xml, kind, chapter }, `kind` one of
// front (the title page), heading (a chapter's), body, or break (a scene
// break), `chapter` the number of the chapter it is in.
function readDocument(xml, shunn) {
  const start = xml.indexOf("<w:body>") + "<w:body>".length;
  const end = xml.indexOf("<w:sectPr");
  const items = [];
  let chapter = 0;
  for (const [paragraph] of xml.slice(start, end).matchAll(/<w:p>(?:(?!<\/w:p>).)*<\/w:p>/gs)) {
    const heading = shunn ? paragraph.includes('w:type="page"') : paragraph.includes('w:val="Heading1"');
    if (heading) {
      chapter += 1;
    }
    const text = textOf(paragraph);
    const kind = heading ? "heading" : chapter === 0 ? "front" : /^(?:\* \* \*|#)$/.test(text) ? "break" : "body";
    items.push({ xml: paragraph, kind, chapter });
  }
  return { head: xml.slice(0, start), items, tail: xml.slice(end) };
}

function plainParagraph(text, shunn) {
  return shunn
    ? `<w:p>${SHUNN_BODY}<w:r>${SHUNN_RUN}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`
    : `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function sentencesOf(text) {
  return text.split(/(?<=\.)\s+/).filter((part) => part.trim() !== "");
}

// The editor's operations on the items, each named in `log`.
function editDocument(random, doc, shunn, sentence, log) {
  const { items } = doc;
  const body = () => items.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === "body");
  const chapters = () => [...new Set(items.filter((item) => item.kind === "heading").map((item) => item.chapter))];
  const make = (text, chapter) => ({ xml: plainParagraph(text, shunn), kind: "body", chapter });
  // A place after a body paragraph or a chapter heading of `chapter` (any
  // when null): an index to insert at.
  const placeIn = (chapter) => {
    const spots = items.map((item, index) => ({ item, index })).filter(({ item }) => (item.kind === "body" || item.kind === "heading" || item.kind === "break") && (chapter === null || item.chapter === chapter));
    if (spots.length === 0) {
      return null;
    }
    const spot = random.pick(spots);
    return { index: spot.index + 1, chapter: spot.item.chapter };
  };
  const operations = {
    "change a sentence": () => {
      const candidates = body().filter(({ item }) => HAS_TOKEN.test(textOf(item.xml)));
      if (candidates.length === 0) {
        return null;
      }
      const { item, index } = random.pick(candidates);
      const parts = sentencesOf(textOf(item.xml));
      const at = random.int(0, parts.length - 1);
      parts[at] = sentence();
      items[index] = make(parts.join(" "), item.chapter);
      return `p${index}`;
    },
    "rewrite a paragraph": () => {
      const candidates = body();
      if (candidates.length === 0) {
        return null;
      }
      const { item, index } = random.pick(candidates);
      items[index] = make(Array.from({ length: random.int(1, 2) }, sentence).join(" "), item.chapter);
      return `p${index}`;
    },
    "cut a paragraph": () => {
      const candidates = items.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === "body" || item.kind === "break");
      if (candidates.length === 0) {
        return null;
      }
      const { index } = random.pick(candidates);
      items.splice(index, 1);
      return `p${index}`;
    },
    "add a paragraph": () => {
      const place = placeIn(null);
      if (place === null) {
        return null;
      }
      items.splice(place.index, 0, make(Array.from({ length: random.int(1, 2) }, sentence).join(" "), place.chapter));
      return `at ${place.index}`;
    },
    "move a paragraph within its chapter": () => {
      const candidates = body();
      if (candidates.length === 0) {
        return null;
      }
      const { item, index } = random.pick(candidates);
      items.splice(index, 1);
      const place = placeIn(item.chapter);
      if (place === null) {
        items.splice(index, 0, item);
        return null;
      }
      items.splice(place.index, 0, item);
      return `p${index} to ${place.index}`;
    },
    "move a paragraph to another chapter": () => {
      const candidates = body();
      const all = chapters();
      if (candidates.length === 0 || all.length < 2) {
        return null;
      }
      const { item, index } = random.pick(candidates);
      const target = random.pick(all.filter((chapter) => chapter !== item.chapter));
      items.splice(index, 1);
      const place = placeIn(target);
      items.splice(place.index, 0, { ...item, chapter: target });
      return `p${index} to ${place.index}`;
    },
    "join two paragraphs": () => {
      const candidates = body().filter(({ item, index }) => items[index + 1]?.kind === "body" && items[index + 1].chapter === item.chapter);
      if (candidates.length === 0) {
        return null;
      }
      const { item, index } = random.pick(candidates);
      items.splice(index, 2, make(`${textOf(item.xml)} ${textOf(items[index + 1].xml)}`, item.chapter));
      return `p${index}`;
    },
    "move a sentence to another paragraph": () => {
      const candidates = body().filter(({ item }) => sentencesOf(textOf(item.xml)).length > 1);
      const targets = body();
      if (candidates.length === 0 || targets.length < 2) {
        return null;
      }
      const { item, index } = random.pick(candidates);
      const target = random.pick(targets.filter((entry) => entry.index !== index));
      const parts = sentencesOf(textOf(item.xml));
      const [moved] = parts.splice(random.int(0, parts.length - 1), 1);
      items[index] = make(parts.join(" "), item.chapter);
      items[target.index] = make(`${textOf(target.item.xml)} ${moved}`, target.item.chapter);
      return `p${index} to p${target.index}`;
    },
    "split a paragraph": () => {
      const candidates = body().filter(({ item }) => sentencesOf(textOf(item.xml)).length > 1);
      if (candidates.length === 0) {
        return null;
      }
      const { item, index } = random.pick(candidates);
      const parts = sentencesOf(textOf(item.xml));
      const at = random.int(1, parts.length - 1);
      items.splice(index, 1, make(parts.slice(0, at).join(" "), item.chapter), make(parts.slice(at).join(" "), item.chapter));
      return `p${index}`;
    },
    "add a heading inside a chapter": () => {
      const place = placeIn(null);
      if (place === null) {
        return null;
      }
      const words = `Part ${random.pick(["Two", "Three", "Four"])}`;
      const xml = shunn
        ? `<w:p>${SHUNN_CENTER}<w:r><w:br w:type="page"/></w:r><w:r>${SHUNN_RUN}<w:t xml:space="preserve">${words}</w:t></w:r></w:p>`
        : `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">${words}</w:t></w:r></w:p>`;
      items.splice(place.index, 0, { xml, kind: "added-heading", chapter: place.chapter });
      return `at ${place.index}`;
    },
    "take a chapter heading's style": () => {
      const candidates = items.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === "heading" && item.chapter > 1);
      if (candidates.length === 0) {
        return null;
      }
      const { item, index } = random.pick(candidates);
      const xml = shunn ? item.xml.replace('<w:r><w:br w:type="page"/></w:r>', "") : item.xml.replace(/<w:pPr><w:pStyle w:val="Heading1"\/><\/w:pPr>/, "");
      items[index] = { xml, kind: "lost-heading", chapter: item.chapter };
      return `chapter ${item.chapter}`;
    },
    "type a scene break": () => {
      const place = placeIn(null);
      if (place === null) {
        return null;
      }
      items.splice(place.index, 0, { xml: plainParagraph(shunn ? "#" : "* * *", shunn), kind: "break", chapter: place.chapter });
      return `at ${place.index}`;
    }
  };
  const count = random.int(1, 8);
  for (let step = 0; step < count; step += 1) {
    const name = random.pick(Object.keys(operations));
    const done = operations[name]();
    if (done !== null) {
      log.push(`editor: ${name} (${done})`);
    }
  }
}

function returnedFile(sent, out, edit) {
  const bytes = fs.readFileSync(sent);
  const entries = [...zipEntries(bytes).values()].map((entry) => ({ name: entry.name, content: xmlText(bytes, entry) }));
  writeZip(out, entries.map((entry) => (entry.name === "word/document.xml" ? { ...entry, content: edit(entry.content) } : entry)));
}

// --- The author's edits since sending -----------------------------------

function chapterFiles(root) {
  return fs.readdirSync(path.join(root, "chapters")).filter((name) => /^chapter-\d+\.md$/.test(name)).sort();
}

// A chapter file as { head, blocks }: the text through "## Chapter Text"
// and the blocks of prose after it.
function readChapter(file) {
  const text = fs.readFileSync(file, "utf8");
  const at = text.indexOf("## Chapter Text\n");
  const head = text.slice(0, at + "## Chapter Text\n".length);
  const blocks = text.slice(head.length).split(/\n{2,}/).map((block) => block.replace(/^\n+|\n+$/g, "")).filter((block) => block !== "");
  return { head, blocks };
}

function writeChapter(file, { head, blocks }) {
  fs.writeFileSync(file, blocks.length === 0 ? head : `${head}\n${blocks.join("\n\n")}\n`);
}

function editProject(random, book, sentence, log) {
  const { dir, root } = book;
  const files = () => chapterFiles(root).map((name) => path.join(root, "chapters", name));
  const prose = () => files().flatMap((file) => readChapter(file).blocks.map((block, index) => ({ file, index, block }))).filter(({ block }) => block !== "* * *");
  const operations = {
    "change a sentence": () => {
      const candidates = prose().filter(({ block }) => HAS_TOKEN.test(block));
      if (candidates.length === 0) {
        return null;
      }
      const { file, index, block } = random.pick(candidates);
      const spots = [...block.matchAll(/[A-Z][a-z]+ zq\d+[^.]*\./g)];
      const spot = random.pick(spots);
      const chapter = readChapter(file);
      chapter.blocks[index] = `${block.slice(0, spot.index)}${sentence()}${block.slice(spot.index + spot[0].length)}`;
      writeChapter(file, chapter);
      return `${path.basename(file)} block ${index}`;
    },
    "cut a paragraph": () => {
      const candidates = prose();
      if (candidates.length === 0) {
        return null;
      }
      const { file, index } = random.pick(candidates);
      const chapter = readChapter(file);
      chapter.blocks.splice(index, 1);
      writeChapter(file, chapter);
      return `${path.basename(file)} block ${index}`;
    },
    "add a paragraph": () => {
      const file = random.pick(files());
      const chapter = readChapter(file);
      const at = random.int(0, chapter.blocks.length);
      chapter.blocks.splice(at, 0, Array.from({ length: random.int(1, 2) }, sentence).join(" "));
      writeChapter(file, chapter);
      return `${path.basename(file)} block ${at}`;
    },
    "move a paragraph": () => {
      const candidates = prose();
      if (candidates.length === 0) {
        return null;
      }
      const { file, index, block } = random.pick(candidates);
      const from = readChapter(file);
      from.blocks.splice(index, 1);
      writeChapter(file, from);
      const target = random.pick(files());
      const to = readChapter(target);
      const at = random.int(0, to.blocks.length);
      to.blocks.splice(at, 0, block);
      writeChapter(target, to);
      return `${path.basename(file)} block ${index} to ${path.basename(target)} block ${at}`;
    },
    "change emphasis only": () => {
      const candidates = prose().filter(({ block }) => !/[`*<[\]>]/.test(block) && !block.includes("  \n"));
      if (candidates.length === 0) {
        return null;
      }
      const { file, index, block } = random.pick(candidates);
      const chapter = readChapter(file);
      chapter.blocks[index] = wrapWord(random, block, (word) => `*${word}*`);
      writeChapter(file, chapter);
      return `${path.basename(file)} block ${index}`;
    },
    "split a chapter": () => {
      const candidates = files().map((file) => ({ file, chapter: readChapter(file) }))
        .flatMap(({ file, chapter }) => chapter.blocks.map((block, index) => ({ file, block, index })).filter(({ block, index }) => index > 0 && /^[A-Z][a-z]+ zq\d+[^\n]*$/.test(block) && !block.includes("<!--")));
      if (candidates.length === 0) {
        return null;
      }
      const { file, block, index } = random.pick(candidates);
      const id = path.basename(file, ".md");
      const result = story(dir, "split", id, "--at", block, "--title", "Later", "--path", "book");
      if (result.code !== 0) {
        return `${id} refused: ${result.stderr.trim()}`;
      }
      return `${id} at block ${index}`;
    },
    "renumber a chapter": () => {
      const names = chapterFiles(root);
      if (names.length < 2) {
        return null;
      }
      const id = path.basename(random.pick(names), ".md");
      const number = random.int(1, names.length);
      const result = story(dir, "move", "chapter", id, "--number", String(number), "--path", "book");
      if (result.code !== 0) {
        return null;
      }
      return `${id} to ${number}`;
    }
  };
  const count = random.int(0, 4);
  for (let step = 0; step < count; step += 1) {
    const name = random.pick(Object.keys(operations));
    const done = operations[name]();
    if (done !== null) {
      log.push(`author: ${name} (${done})`);
    }
  }
}

// --- Checking a run -------------------------------------------------------

function tokenCounts(texts) {
  const counts = new Map();
  for (const text of texts) {
    for (const [token] of text.matchAll(TOKEN)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return counts;
}

// The sentences of the project's chapters, by token, with how often each is
// there.
function projectTokens(root) {
  return tokenCounts(chapterFiles(root).map((name) => withoutComments(parseFrontmatter(fs.readFileSync(path.join(root, "chapters", name), "utf8"), name).body)));
}

// The text with its HTML comments left out, found as the project's own
// parser finds them, so a sentence inside a comment is not counted.
function withoutComments(text) {
  let kept = "";
  let position = 0;
  for (const { start, end } of commentRanges(text)) {
    kept += text.slice(position, start);
    position = end;
  }
  return kept + text.slice(position);
}

function documentTokens(file) {
  const bytes = fs.readFileSync(file);
  const entry = [...zipEntries(bytes).values()].find((candidate) => candidate.name === "word/document.xml");
  const xml = xmlText(bytes, entry);
  return tokenCounts([...xml.matchAll(/<w:p>(?:(?!<\/w:p>).)*<\/w:p>/gs)].map((match) => textOf(match[0])));
}

// Every file of the project but the snapshots, by its path: its bytes, or,
// for a chapter, its frontmatter.
function scope(root) {
  const entries = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const key = path.relative(root, full).split(path.sep).join("/");
      if (key === ".snapshots") {
        continue;
      }
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const text = fs.readFileSync(full, "utf8");
      entries[key] = /^chapters\/chapter-\d+\.md$/.test(key) ? text.slice(0, text.length - parseFrontmatter(text, key).body.length) : text;
    }
  };
  walk(root);
  return entries;
}

function fullTree(root) {
  const entries = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        entries[path.relative(root, full)] = fs.readFileSync(full, "utf8");
      }
    }
  };
  walk(root);
  return entries;
}

function validateErrors(dir) {
  const result = story(dir, "validate", "book", "--json");
  const json = JSON.parse(result.stdout);
  return new Set(json.diagnostics.filter((entry) => entry.level === "error").map((entry) => `${entry.code} ${entry.file ?? ""}`));
}

function applyRun(dir, file, base, dryRun) {
  const result = story(dir, "apply", file, "--path", "book", "--json", ...base, ...(dryRun ? ["--dry-run"] : []));
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    // Checked by the caller.
  }
  return { ...result, json };
}

const has = (texts, token) => texts.some((text) => new RegExp(`\\b${token}\\b`).test(text));

// Runs apply on a copy of the project at `source` and returns each
// invariant it breaks, as "S<n> ...".
function checkRun({ source, file, base, baseTokens }) {
  const failures = [];
  const dir = makeTempDir("story-apply-run-");
  const root = path.join(dir, "book");
  fs.cpSync(source, root, { recursive: true });
  const before = projectTokens(root);
  const tree = fullTree(root);
  const scopeBefore = scope(root);
  const errorsBefore = validateErrors(dir);
  const doc = documentTokens(file);

  const dry = applyRun(dir, file, base, true);
  if (dry.code !== 0 || dry.json === null) {
    return [`the dry run exited ${dry.code}: ${dry.stderr}`];
  }
  if (JSON.stringify(fullTree(root)) !== JSON.stringify(tree)) {
    failures.push("S5 the dry run changed the project");
  }
  const run = applyRun(dir, file, base, false);
  if (run.code !== 0 || run.json === null) {
    return [...failures, `the run exited ${run.code}: ${run.stderr}`];
  }
  const data = run.json.data;
  for (const [name, value] of Object.entries(data.counts)) {
    STATS.set(name, (STATS.get(name) ?? 0) + value);
  }
  const after = projectTokens(root);
  const edited = data.edits.filter((edit) => edit.type === "cut" || edit.type === "changed").map((edit) => edit.before);
  const reported = [...data.notWritten.map((entry) => entry.text), ...data.conflicts.map((entry) => entry.document), ...data.kept.map((entry) => entry.text)];
  for (const [token, times] of before) {
    if (!after.has(token)) {
      if (doc.has(token)) {
        failures.push(`S1 ${token} was lost, though the document has it`);
      }
      if (!has(edited, token)) {
        failures.push(`S1 ${token} was lost, and no cut or change in the report covers it`);
      }
      if (baseTokens !== null && !baseTokens.has(token)) {
        failures.push(`S1 ${token}, which the author wrote since sending, was lost`);
      }
    }
    if ((after.get(token) ?? 0) > Math.max(times, doc.get(token) ?? 0)) {
      failures.push(`S2 ${token} is there ${after.get(token)} times, was ${times}, and the document has it ${doc.get(token) ?? 0} times`);
    }
  }
  for (const [token, times] of after) {
    if (!before.has(token) && !doc.has(token)) {
      failures.push(`S3 ${token} came from nowhere`);
    }
    if (!before.has(token) && times > (doc.get(token) ?? 0)) {
      failures.push(`S2 ${token} is there ${times} times, and the document has it ${doc.get(token) ?? 0} times`);
    }
  }
  for (const token of doc.keys()) {
    const isNew = !(baseTokens ?? before).has(token);
    if (isNew && !after.has(token) && !has(reported, token)) {
      failures.push(`S4 ${token} is new in the document, not written, and not reported`);
    }
  }
  const scopeAfter = scope(root);
  for (const key of new Set([...Object.keys(scopeBefore), ...Object.keys(scopeAfter)])) {
    if (scopeBefore[key] !== scopeAfter[key]) {
      failures.push(`S5 ${key} changed outside chapter prose`);
    }
  }
  // S6: the same document again.
  const again = applyRun(dir, file, base, true);
  if (again.code !== 0 || again.json === null) {
    failures.push(`S6 the second run exited ${again.code}: ${again.stderr}`);
  } else {
    const written = [...after.keys()].filter((token) => !before.has(token));
    for (const edit of again.json.data.edits) {
      for (const token of written) {
        if (has([edit.text, edit.before], token)) {
          failures.push(`S6 the second run plans another ${edit.type} edit of ${token}, which the first run wrote`);
        }
      }
      if (edit.move !== null && data.edits.some((first) => first.move !== null && first.type === edit.type && first.before === edit.before && first.text === edit.text)) {
        failures.push(`S6 the second run moves ${edit.label ?? edit.after} again`);
      }
    }
  }
  // S7: the chapters still parse and validate finds no new error.
  for (const name of chapterFiles(root)) {
    try {
      parseFrontmatter(fs.readFileSync(path.join(root, "chapters", name), "utf8"), name);
    } catch (error) {
      failures.push(`S7 ${name} no longer parses: ${error.message}`);
    }
  }
  for (const error of validateErrors(dir)) {
    if (!errorsBefore.has(error)) {
      failures.push(`S7 story validate reports a new error: ${error}`);
    }
  }
  return failures.length === 0 ? [] : [...new Set(failures), `report: ${JSON.stringify({ codes: run.json.diagnostics.map((entry) => entry.code), edits: data.edits, conflicts: data.conflicts, kept: data.kept, notWritten: data.notWritten })}`];
}

// One case: a book, a Word file of it, the editor's edits, the author's
// edits, and apply with and without the version sent as its base.
function runCase(seed, index) {
  const random = generator((seed * 7919 + index * 104729) >>> 0);
  const sentence = sentenceMaker(random);
  const book = writeBook(random, sentence);
  const shunn = random.chance(0.4);
  const sent = path.join(book.dir, "sent.docx");
  expect(story(book.dir, "build", "book", "--format", "docx", "--out", sent, ...(shunn ? ["--shunn"] : [])).code).toBe(0);
  expect(story(book.dir, "snapshot", "sent", "--path", "book").code).toBe(0);
  const baseTokens = projectTokens(book.root);
  const log = [`build: ${shunn ? "docx --shunn" : "docx"}`];
  const file = path.join(book.dir, "returned.docx");
  returnedFile(sent, file, (xml) => {
    const doc = readDocument(xml, shunn);
    editDocument(random, doc, shunn, sentence, log);
    return `${doc.head}${doc.items.map((item) => item.xml).join("")}${doc.tail}`;
  });
  editProject(random, book, sentence, log);
  // STORY_PROPERTY_KEEP=<dir> keeps the case there, to replay it by hand.
  if (process.env.STORY_PROPERTY_KEEP !== undefined) {
    const keep = path.join(process.env.STORY_PROPERTY_KEEP, `seed-${seed}-case-${index}`);
    fs.rmSync(keep, { recursive: true, force: true });
    fs.cpSync(book.dir, keep, { recursive: true });
  }
  const failures = [];
  for (const [label, base, tokens] of [["with a base", ["--snapshot", "sent"], baseTokens], ["without a base", [], null]]) {
    for (const failure of checkRun({ source: book.root, file, base, baseTokens: tokens })) {
      failures.push(`${label}: ${failure}`);
    }
  }
  return failures.length === 0 ? null : `seed ${seed} case ${index}\n  ${log.join("\n  ")}\n  ${failures.join("\n  ")}`;
}

describe("story apply: random books, edits, and invariants", () => {
  test(`seed ${SEED}: ${ONLY === null ? `${RUNS} cases` : `case ${ONLY}`} keep S1 to S7`, () => {
    if (process.env.STORY_PROPERTY_SEED === "random") {
      console.log(`STORY_PROPERTY_SEED=${SEED}`);
    }
    const failures = [];
    for (const index of ONLY === null ? Array.from({ length: RUNS }, (unused, at) => at) : [ONLY]) {
      const failure = runCase(SEED, index);
      if (failure !== null) {
        failures.push(failure);
      }
    }
    if (failures.length > 0) {
      console.error(failures.join("\n\n"));
    }
    if (process.env.STORY_PROPERTY_STATS === "1") {
      console.log(JSON.stringify(Object.fromEntries(STATS)));
    }
    expect(failures).toEqual([]);
  }, 20000 + RUNS * 5000);
});
