import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { buildBook, createStoryProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

// A small mystery: a detective, a victim who dies in chapter 2, a place, a
// relic, an arc, a clue, an open and a resolved question, and a secret in
// the victim's notes.
function project(options = {}) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Lamp & Tide", force: false });
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("schema-version: 2\n", `schema-version: 2\nauthor: Ada Writer\n${options.language ? `language: ${options.language}\n` : ""}`), "utf8");
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), "title: Arrival\nnumber: 1\nstatus: draft\npov: mara\ncharacters: [mara, tobias]\nlocations: [lamp-house]\narcs-advanced: [the-keeper]\nhook: question", "## Chapter Text\n\nMara climbed to the Lamp House. Tobias waited.\n");
  writeMarkdown(path.join(root, "chapters", "chapter-02.md"), "title: Low Water\nnumber: 2\nstatus: draft\npov: mara\ncharacters: [mara]", "## Chapter Text\n\nThe tide went out without Tobias.\n");
  writeMarkdown(path.join(root, "characters", "mara.md"), "name: Mara <Keeper>\nrole: protagonist\nstatus: alive\nrelationships:\n  - character: tobias\n    type: brother\nlocations: [lamp-house]", "\n# Mara\n\n## Backstory\n\nGrew up in the *lamp* house.\n");
  writeMarkdown(path.join(root, "characters", "tobias.md"), "name: Tobias\nrole: supporting\nstatus: deceased\ndied-in: chapter-02", "\n# Tobias\n\n## Secret\n\nTobias forged the ledger.\n\n| When | Event |\n|------|-------|\n| | |\n");
  writeMarkdown(path.join(root, "worldbuilding", "locations", "lamp-house.md"), "name: Lamp House\ntype: lighthouse\nnotable-characters: [mara]", "\n# Lamp House\n");
  writeMarkdown(path.join(root, "worldbuilding", "artifacts", "brass-key.md"), "name: Brass Key\ntype: object\nstatus: hidden\nowner: tobias", "\n# Brass Key\n");
  writeMarkdown(path.join(root, "plot", "arcs", "the-keeper.md"), "name: The Keeper\ntype: main\nstatus: resolved\ncharacters: [mara]", "\n# The Keeper\n\n## Resolution\n\nMara keeps the light.\n");
  writeMarkdown(path.join(root, "continuity", "clues", "wet-boots.md"), "title: Wet Boots\nstatus: paid-off\nplanted: chapter-01\npayoff: chapter-02\ncharacters: [mara]", "\n# Wet Boots\n");
  writeMarkdown(path.join(root, "continuity", "questions", "who-lit-the-lamp.md"), "title: Who lit the lamp?\nstatus: open\nintroduced: chapter-01", "\n# Who lit the lamp?\n");
  writeMarkdown(path.join(root, "continuity", "questions", "where-is-tobias.md"), "title: Where is Tobias?\nstatus: resolved\nintroduced: chapter-01\nresolved: chapter-02", "\n# Where is Tobias?\n");
  writeMarkdown(path.join(root, "continuity", "promises", "the-lamp-relit.md"), "title: The lamp relit\nstatus: planted\nplanted: chapter-01\narcs: [the-keeper]\ncharacters: [mara]", "\n# The lamp relit\n");
  return { root, cwd };
}

function readSite(directory) {
  const files = {};
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        files[path.relative(directory, full).split(path.sep).join("/")] = fs.readFileSync(full, "utf8");
      }
    }
  };
  walk(directory);
  return files;
}

describe("build --format codex", () => {
  test("writes a linked page per entity and section to dist/codex", () => {
    const { root } = project();
    const result = buildBook(root, { format: "codex" });
    expect(result).toMatchObject({ format: "codex", outFile: path.join(root, "dist", "codex"), pages: 9 });
    const site = readSite(result.outFile);
    expect(Object.keys(site).sort()).toEqual([
      "arcs/the-keeper.html",
      "artifacts/brass-key.html",
      "characters/mara.html",
      "characters/tobias.html",
      "index.html",
      "locations/lamp-house.html",
      "progress.html",
      "threads.html",
      "timeline.html"
    ]);

    const index = site["index.html"];
    expect(index).toContain('<html lang="en">');
    expect(index).toContain("<title>Lamp &amp; Tide: story bible</title>");
    expect(index).toContain('<a href="characters/mara.html">Mara &lt;Keeper&gt;</a>');
    expect(index).toContain('<a href="timeline.html">Timeline</a>');

    const mara = site["characters/mara.html"];
    expect(mara).toContain('<a href="../characters/tobias.html">Tobias</a> <span class="muted">brother</span>');
    expect(mara).toContain('<a href="../locations/lamp-house.html">Lamp House</a>');
    expect(mara).toContain("<li>1. Arrival</li>");
    expect(mara).toContain('<a href="../index.html">Story bible</a>');
    // Backlinks: the location and arc name Mara.
    expect(mara).toContain('<a href="../locations/lamp-house.html">Lamp House</a> <span class="muted">Location</span>');
    expect(mara).toContain('<a href="../arcs/the-keeper.html">The Keeper</a> <span class="muted">Arc</span>');

    expect(site["arcs/the-keeper.html"]).toContain("<h2>Advanced in</h2>");
    expect(site["timeline.html"]).toContain('<a href="characters/mara.html">Mara &lt;Keeper&gt;</a>');
    expect(site["threads.html"]).toContain("Who lit the lamp?");
    expect(site["threads.html"]).toContain('<tr><td>The lamp relit</td><td>1. Arrival</td><td><a href="arcs/the-keeper.html">The Keeper</a></td><td><a href="characters/mara.html">Mara &lt;Keeper&gt;</a></td></tr>');
    expect(site["progress.html"]).toContain('<a href="arcs/the-keeper.html">The Keeper</a></td><td class="cell">x</td>');

    for (const [file, html] of Object.entries(site)) {
      expect({ file, script: /<script|\bsrc=|https?:\/\//i.test(html) }).toEqual({ file, script: false });
    }
  });

  test("leaves spoilers out unless --spoilers is given", () => {
    const { root } = project();
    const safe = readSite(buildBook(root, { format: "codex" }).outFile);
    const all = Object.values(safe).join("\n");
    for (const secret of ["forged the ledger", "Mara keeps the light", "deceased", "Dies in", "Wet Boots", "Where is Tobias?", "hidden", "Grew up"]) {
      expect({ secret, shown: all.includes(secret) }).toEqual({ secret, shown: false });
    }
    // The artifact's owner is a spoiler, so Tobias's page has no backlink to it.
    expect(safe["characters/tobias.html"]).not.toContain("brass-key");

    const full = readSite(buildBook(root, { format: "codex", spoilers: true }).outFile);
    expect(full["characters/tobias.html"]).toContain("<p>Tobias forged the ledger.</p>");
    expect(full["characters/tobias.html"]).toContain("<tr><th scope=\"row\">Dies in</th><td>2. Low Water</td></tr>");
    expect(full["characters/tobias.html"]).toContain('<a href="../artifacts/brass-key.html">Brass Key</a>');
    // A template's blank table row is not shown.
    expect(full["characters/tobias.html"]).not.toContain("<th>When</th>");
    expect(full["characters/mara.html"]).toContain("<p>Grew up in the <em>lamp</em> house.</p>");
    expect(full["characters/mara.html"]).not.toContain("<h3>Mara</h3>");
    expect(full["threads.html"]).toContain("Wet Boots");
    expect(full["threads.html"]).toContain("Where is Tobias?");
    expect(full["timeline.html"]).toContain("dies in chapter 2");
  });

  test("is byte-identical across builds and clears pages an earlier codex wrote", () => {
    const { root } = project();
    const first = readSite(buildBook(root, { format: "codex", spoilers: true }).outFile);
    const second = readSite(buildBook(root, { format: "codex", spoilers: true }).outFile);
    expect(second).toEqual(first);

    // Pages added by hand, without the generator tag, are kept.
    fs.writeFileSync(path.join(root, "dist", "codex", "about.html"), "<p>About</p>", "utf8");
    fs.writeFileSync(path.join(root, "dist", "codex", "characters", "notes.html"), "<p>Notes</p>", "utf8");
    fs.rmSync(path.join(root, "worldbuilding", "artifacts", "brass-key.md"));
    const third = readSite(buildBook(root, { format: "codex" }).outFile);
    expect(Object.keys(third)).not.toContain("artifacts/brass-key.html");
    expect(fs.existsSync(path.join(root, "dist", "codex", "artifacts"))).toBe(false);
    expect(third["about.html"]).toBe("<p>About</p>");
    expect(third["characters/notes.html"]).toBe("<p>Notes</p>");
  });

  test("refuses to build while the session log does not parse", () => {
    const { root } = project();
    fs.writeFileSync(path.join(root, "progress.md"), "---\nsessions: [\n---\n", "utf8");
    expect(() => buildBook(root, { format: "codex" })).toThrow("Cannot build the codex: fix this file first");
  });

  test("covers scenes, factions, systems, routes, progressions, knowledge, notes markup, and the session log", () => {
    const { root } = project();
    writeMarkdown(path.join(root, "scenes", "chapter-01-scene-01.md"), "title: The Climb\nchapter: chapter-01\nscene: 1\npov: mara\ncharacters: [mara, ghost]\nlocation: harbour\ndate: 2020-05-01\ntime: \"06:00\"", "\n# The Climb\n");
    writeMarkdown(path.join(root, "worldbuilding", "locations", "harbour.md"), "name: Harbour\ntype: port\nroutes:\n  - to: lamp-house\n    hours: 1\n    mode: boat\n  - to: nowhere", "\n# Harbour\n");
    writeMarkdown(path.join(root, "worldbuilding", "factions", "keepers.md"), "name: The Keepers\ntype: guild\nstatus: declining\nmembers: [mara, ghost]\nlocations: [lamp-house]", "\n# Keepers\n");
    writeMarkdown(path.join(root, "worldbuilding", "systems", "tide-law.md"), "name: Tide Law\ntype: law\npronunciation: TIDE-law", "\n# Tide Law\n");
    const tobias = path.join(root, "characters", "tobias.md");
    writeMarkdown(tobias, "name: Tobias\nrole: supporting\nstatus: deceased\ndied-in: chapter-02\nrevived-in: chapter-09\naliases:\n  - name: Toby\n    used-by: mara\nprogressions:\n  - from: chapter-02\n    field: rank\n    value: ghost", [
      "",
      "# Tobias",
      "",
      "| Kin | Tie |",
      "|-----|-----|",
      "| Mara | sister |",
      "",
      "Line one  ",
      "line two\\",
      "line three",
      "",
      "A first paragraph",
      "| Year | Event |",
      "| 1901 | Born |",
      "",
      "- one",
      "  continued",
      "1. first",
      "Plain line",
      "> A quote",
      "",
      "```",
      "```js",
      "# not a heading",
      "```",
      "",
      "~~~",
      "left open"
    ].join("\n"));
    fs.writeFileSync(path.join(root, "continuity", "state.md"), "---\ntype: continuity-state\nknowledge-state:\n  - character: tobias\n    knows: the ledger was forged\n    learned-in: chapter-01\n  - character: tobias\n    knows: the tide tables\n---\n\n# Continuity State\n", "utf8");
    fs.writeFileSync(path.join(root, "progress.md"), "---\ntype: progress-log\nsessions:\n  - date: 2020-05-01\n    words: 10\n---\n\n# Progress Log\n", "utf8");

    const site = readSite(buildBook(root, { format: "codex", spoilers: true }).outFile);
    const tobiasPage = site["characters/tobias.html"];
    expect(tobiasPage).toContain("<tr><th scope=\"row\">Revived in</th><td>chapter-09</td></tr>");
    expect(tobiasPage).toContain("<li>From 2. Low Water: rank becomes ghost</li>");
    expect(tobiasPage).toContain("<tr><th scope=\"row\">Aliases</th><td>name: Toby, used-by: mara</td></tr>");
    expect(tobiasPage).toContain("<li>the ledger was forged <span class=\"muted\">learned in 1. Arrival</span></li>");
    expect(tobiasPage).toContain("<li>the tide tables <span class=\"muted\">known from the start</span></li>");
    expect(tobiasPage).toContain("<thead><tr><th>Kin</th><th>Tie</th></tr></thead><tbody>\n<tr><td>Mara</td><td>sister</td></tr>");
    expect(tobiasPage).toContain("<p>A first paragraph</p>\n<div class=\"scroll\"><table><tbody>\n<tr><td>Year</td><td>Event</td></tr>\n<tr><td>1901</td><td>Born</td></tr>");
    expect(tobiasPage).toContain("<ul>\n<li>one continued</li>\n</ul>\n<ol>\n<li>first</li>\n</ol>\n<p>Plain line</p>\n<blockquote><p>A quote</p></blockquote>");
    expect(tobiasPage).toContain("<pre><code>```js\n# not a heading</code></pre>\n<pre><code>left open</code></pre>");
    expect(tobiasPage).toContain("<p>Line one<br>line two<br>line three</p>");

    expect(site["locations/harbour.html"]).toContain('<a href="../locations/lamp-house.html">Lamp House</a> <span class="muted">1 h, boat</span><br>nowhere');
    expect(site["locations/lamp-house.html"]).toContain('<a href="../factions/keepers.html">The Keepers</a> <span class="muted">Faction</span>');
    expect(site["factions/keepers.html"]).toContain('<tr><th scope="row">Members</th><td><a href="../characters/mara.html">Mara &lt;Keeper&gt;</a>, ghost</td></tr>');
    expect(site["systems/tide-law.html"]).toContain('<tr><th scope="row">Pronunciation</th><td>TIDE-law</td></tr>');
    expect(site["timeline.html"]).toContain("<td>2020-05-01</td><td>06:00</td><td>The Climb</td><td>1. Arrival</td>");
    expect(site["progress.html"]).toContain("<tr><td>2020-05-01</td><td>10</td></tr>");
  });

  test("says when there are no threads, entities, or dated scenes", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Empty Shelf", force: false });
    const site = readSite(buildBook(root, { format: "codex", spoilers: true }).outFile);
    expect(site["threads.html"]).toContain("<h2>Questions</h2>\n<p>None.</p>\n<h2>Promises</h2>\n<p>None.</p>\n<h2>Clues</h2>\n<p>None.</p>");
    expect(site["index.html"]).toContain("<p>No characters, places, or other entities yet.</p>");
    expect(site["timeline.html"]).toContain("No dated scenes or chapters yet.");
  });

  test("sets right-to-left languages from the right", () => {
    const { root } = project({ language: "ar" });
    const site = readSite(buildBook(root, { format: "codex" }).outFile);
    expect(site["index.html"]).toContain('<html lang="ar" dir="rtl">');
  });

  test("measures a book counted in characters in characters", () => {
    const { root } = project({ language: "ja" });
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace("number: 1\n", "number: 1\ntarget-characters: 100\n"), "utf8");
    // A session logged before the book was counted in characters is left out.
    fs.writeFileSync(path.join(root, "progress.md"), "---\ntype: progress-log\nsessions:\n  - date: 2020-05-01\n    words: 10\n  - date: 2020-05-02\n    words: 12\n    characters: 40\n---\n\n# Progress Log\n", "utf8");
    const site = readSite(buildBook(root, { format: "codex" }).outFile);
    expect(site["progress.html"]).toContain("<tbody>\n<tr><td>2020-05-02</td><td>40</td></tr>\n</tbody>");
    expect(site["progress.html"]).toContain('<tr><th scope="row">総文字数</th>');
    expect(site["progress.html"]).toContain("<th>文字数</th><th>目標</th>");
    expect(site["progress.html"]).toMatch(/<td>100 \(\d+%\)<\/td>/);
  });

  test("refuses a folder that holds other files, the project root, and a file", () => {
    const { root } = project();
    fs.mkdirSync(path.join(root, "dist"), { recursive: true });
    fs.writeFileSync(path.join(root, "dist", "book.html"), "mine", "utf8");
    expect(() => buildBook(root, { format: "codex", out: "dist" })).toThrow("it holds other files");
    expect(fs.readFileSync(path.join(root, "dist", "book.html"), "utf8")).toBe("mine");
    expect(() => buildBook(root, { format: "codex", out: "." })).toThrow("it holds the project");
    expect(() => buildBook(root, { format: "codex", out: "chapters" })).toThrow("it is project source");
    expect(() => buildBook(root, { format: "codex", out: "dist/book.html" })).toThrow("is not a folder");
    expect(() => buildBook(root, { format: "codex", out: " " })).toThrow("--out needs a folder path");
  });

  test("--spoilers applies only to the codex, and the CLI reports the pages", () => {
    const { root, cwd } = project();
    expect(() => buildBook(root, { format: "html", spoilers: true })).toThrow("--spoilers applies only to --format codex");
    const result = invoke(cwd, ["build", root, "--format", "codex", "--spoilers"]);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toBe(`Built a codex of 9 pages to ${path.join(root, "dist", "codex")}\n`);
  });
});
