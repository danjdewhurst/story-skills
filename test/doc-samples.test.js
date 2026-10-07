import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { gitEnv, makeTempDir, treeDiff, treeSnapshot } from "./helpers.js";

// Replays the command samples in the docs that a replay comment marks, so a
// change to what the CLI prints, or to its exit code, fails here until the
// sample is refreshed (#564). docs/development.md describes the comment.
const repoRoot = path.resolve(import.meta.dir, "..");
const storyBin = path.join(repoRoot, "bin", "story.js");
const EXAMPLES = fs.readdirSync(path.join(repoRoot, "examples")).filter((name) => fs.existsSync(path.join(repoRoot, "examples", name, "story.md")));

// <!-- replay[: <folder>][ setup=<name>][ exit=<code>[,<code>...]] -->
const MARKER = /^\s*<!-- replay(?:: ([a-z0-9-]+|\.))?(?: setup=([a-z0-9-]+))?(?: exit=(\d+(?:,\d+)*))? -->\s*$/;
const FENCE = /^(\s*)(`{3,}|~{3,})(\w*)\s*$/;

// How many samples each file marks, so a marker lost to an edit, or one the
// grammar no longer reads, fails here instead of dropping its sample. Change
// the count with the markers.
const MARKED = {
  "README.md": 1,
  "docs/cli-reference.md": 66,
  "docs/continuity.md": 22,
  "docs/development.md": 1,
  "docs/getting-started.md": 7,
  "docs/languages.md": 2,
  "docs/manuscripts.md": 5,
  "docs/series.md": 1,
  "docs/writing-workflows.md": 2
};

// Scripts a sample may run with `node scripts/<file>`. Each only reads the
// checkout, so it runs from there.
const SCRIPTS = new Set(["check-schema.js"]);

// Every markdown file in the repository, except the example books and
// what is not committed. A symlink, such as plugins/story-skills, is not
// followed.
const UNSCANNED = new Set(["examples", "node_modules", "coverage", "evals/outputs", "evals/baseline"]);
function markdownFiles(dir = repoRoot) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.relative(repoRoot, path.join(dir, entry.name)).split(path.sep).join("/");
    if (entry.isDirectory()) {
      return entry.name.startsWith(".") || UNSCANNED.has(relative) ? [] : markdownFiles(path.join(dir, entry.name));
    }
    return entry.isFile() && entry.name.endsWith(".md") ? [relative] : [];
  }).sort();
}

// The fence that opens at `lines[index]`, with its indent taken off each
// line, and the index of its closing line.
function readFence(lines, index) {
  const open = FENCE.exec(lines[index] ?? "");
  if (open === null) {
    return null;
  }
  const [, indent, marks, lang] = open;
  const body = [];
  let end = index + 1;
  while (end < lines.length && !new RegExp(`^\\s*${marks[0]}{${marks.length},}\\s*$`).test(lines[end])) {
    body.push(lines[end].startsWith(indent) ? lines[end].slice(indent.length) : lines[end]);
    end += 1;
  }
  return end < lines.length ? { lang, body, end } : null;
}

function nextNonBlank(lines, index) {
  let next = index;
  while (next < lines.length && lines[next].trim() === "") {
    next += 1;
  }
  return next;
}

// The lines outside fences, with code spans blanked, so a comment that only
// a code span shows, such as `<!-- replay -->` in running text, is not read.
function visibleLines(lines) {
  let fence = null;
  return lines.map((line) => {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      if (mark !== null && mark[1][0] === fence[0] && mark[1].length >= fence.length && line.trim() === mark[1]) {
        fence = null;
      }
      return "";
    }
    if (mark !== null) {
      fence = mark[1];
      return "";
    }
    return line.replace(/(`+)(?!`).*?(?<!`)\1(?!`)/g, (span) => " ".repeat(span.length));
  });
}

// Each marked sample: a shell fence of commands followed by a text fence
// with their output, or one text fence of `$ story ...` lines each followed
// by its output. A comment that mentions replay but does not match MARKER,
// or is not on a line of its own, is an error rather than a skipped sample.
function samples(file, text = fs.readFileSync(path.join(repoRoot, file), "utf8")) {
  const lines = text.split("\n");
  const shown = visibleLines(lines);
  const visible = shown.join("\n");
  for (const comment of visible.matchAll(/<!--[\s\S]*?-->/g)) {
    const line = visible.slice(0, comment.index).split("\n").length;
    if (/replay/i.test(comment[0]) && !MARKER.test(shown[line - 1])) {
      throw new Error(`${file}:${line}: ${comment[0]} is not a replay comment: write <!-- replay[: <folder>][ setup=<name>][ exit=<code>] --> on a line of its own`);
    }
  }
  const found = [];
  shown.forEach((line, index) => {
    const marker = MARKER.exec(line);
    if (marker === null) {
      return;
    }
    const where = `${file}:${index + 1}`;
    const [, folder, setup, exits] = marker;
    const first = readFence(lines, index + 1);
    let steps;
    if (first?.lang === "shell") {
      const output = readFence(lines, nextNonBlank(lines, first.end + 1));
      if (output?.lang !== "text") {
        throw new Error(`${where}: the replayed shell fence must be followed by a text fence with its output`);
      }
      steps = [{ commands: first.body.filter((command) => command.trim() !== ""), output: output.body.join("\n") }];
    } else if (first?.lang === "text" && first.body[0]?.startsWith("$ ")) {
      steps = [];
      for (const bodyLine of first.body) {
        if (bodyLine.startsWith("$ ")) {
          steps.push({ commands: [bodyLine.slice(2)], output: [] });
        } else {
          steps.at(-1).output.push(bodyLine);
        }
      }
      steps = steps.map((step) => ({ ...step, output: step.output.join("\n") }));
    } else {
      throw new Error(`${where}: a replay comment must come straight before a shell fence or a text fence that starts with "$ story"`);
    }
    const count = steps.flatMap((step) => step.commands).length;
    const codes = (exits ?? "0").split(",").map(Number);
    if (codes.length !== 1 && codes.length !== count) {
      throw new Error(`${where}: exit= gives ${codes.length} codes for ${count} commands; give one for all, or one for each`);
    }
    if (setup !== undefined && !(setup in SETUPS)) {
      throw new Error(`${where}: no setup named ${setup}; the setups are ${Object.keys(SETUPS).join(", ")}`);
    }
    if (setup === undefined && folder !== undefined && folder !== "." && !EXAMPLES.includes(folder)) {
      throw new Error(`${where}: ${folder} is not an example; replay in ".", an example, or a folder a setup makes`);
    }
    found.push({ where, folder, setup, steps, exit: (n) => codes[codes.length === 1 ? 0 : n] });
  });
  return found;
}

// A scratch home folder, shown in output as ~, with a copy of the examples:
// as ~/stories, for a sample run in one of them (or, with ".", in ~/stories
// itself) beside the books it links to, or, for a sample with no folder, as
// ~/story-skills/examples. Only examples/ is copied, so a sample replayed
// from ~/story-skills can name nothing else in the repository.
function scratchHome(folder) {
  const home = fs.realpathSync(makeTempDir("story-doc-samples-"));
  const copy = folder === undefined ? path.join(home, "story-skills") : path.join(home, "stories");
  fs.cpSync(path.join(repoRoot, "examples"), folder === undefined ? path.join(copy, "examples") : copy, { recursive: true });
  return { home, copy, cwd: folder === undefined ? copy : path.join(copy, folder) };
}

// The program and arguments for one sample command. A story command may
// only name paths inside the scratch home, so a replayed write cannot reach
// the checkout or anywhere else, and a sample run from ~/story-skills may
// not name a part of the repository other than examples/.
function commandLine(line, cwd, home) {
  const script = /^node scripts\/([\w.-]+)$/.exec(line);
  if (script !== null) {
    if (!SCRIPTS.has(script[1]) || path.basename(cwd) !== "story-skills") {
      throw new Error(`cannot replay ${JSON.stringify(line)}: only ${[...SCRIPTS].join(", ")} run, from the repository root`);
    }
    return [path.join(repoRoot, "scripts", script[1])];
  }
  if (!/^story(\s|$)/.test(line) || /[|&;<>$`\\]/.test(line.replace(/"[^"]*"|'[^']*'/g, ""))) {
    throw new Error(`cannot replay ${JSON.stringify(line)}: write it as one plain story command`);
  }
  const args = [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3]).slice(1);
  const notCopied = fs.readdirSync(repoRoot).filter((name) => name !== "examples");
  for (const arg of args) {
    const value = /^--[\w-]+=/.test(arg) ? arg.slice(arg.indexOf("=") + 1) : arg;
    const inHome = path.relative(home, path.resolve(cwd, value));
    if (path.isAbsolute(value) || inHome === ".." || inHome.startsWith(`..${path.sep}`)) {
      throw new Error(`cannot replay ${JSON.stringify(line)}: ${value} is outside the scratch home`);
    }
    if (cwd === path.join(home, "story-skills") && value.includes("/") && notCopied.includes(value.split("/")[0])) {
      throw new Error(`cannot replay ${JSON.stringify(line)}: only examples/ is copied to ~/story-skills, not ${value.split("/")[0]}/`);
    }
  }
  return [storyBin, ...args];
}

// Runs one program with stdout and stderr sharing a file, so their lines
// keep the order it printed them in, and returns that output and the exit
// code. gitEnv() keeps the developer's git setup away from a command that
// reads git, such as compare --ref.
function run(argv, cwd, home) {
  const capture = path.join(home, "output.txt");
  const fd = fs.openSync(capture, "w");
  let status;
  try {
    status = spawnSync(process.execPath, argv, { cwd, stdio: ["ignore", fd, fd], env: gitEnv() }).status;
  } finally {
    fs.closeSync(fd);
  }
  const output = fs.readFileSync(capture, "utf8").split(home).join("~");
  fs.rmSync(capture);
  return { output, status };
}

// A story command for a setup, which must succeed.
function setupStory(home, cwd, ...args) {
  const { output, status } = run([storyBin, ...args], cwd, home);
  if (status !== 0) {
    throw new Error(`setup: story ${args.join(" ")} exited ${status}: ${output}`);
  }
}

// Replaces `from` with `to` in a scratch file, failing when `from` is not
// there, so a changed example breaks its setup loudly.
function edit(file, from, to) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(from)) {
    throw new Error(`setup: ${file} has no ${JSON.stringify(from)}`);
  }
  fs.writeFileSync(file, text.replace(from, to));
}

// The setups a marker names with setup=<name>, which build in ~/stories the
// project state the page describes before its sample, with the commands and
// hand edits the page gives.
const SETUPS = {
  // getting-started.md: The Sunken Ledger after chapter 1 is drafted and
  // the post-write `story wordcount . --write` has run.
  "sunken-ledger-drafted": (home, stories) => {
    const root = path.join(stories, "the-sunken-ledger");
    setupStory(home, stories, "init", "The Sunken Ledger", "--form", "novel", "--genre", "mystery", "--sub-genre", "coastal", "--setting-era", "near-future",
      "--pov", "third-person-limited", "--tense", "past", "--theme", "truth", "--theme", "memory", "--synopsis", "A salvage diver finds a sealed room under a storm-damaged harbor.");
    setupStory(home, root, "add", "character", "Ines Calloway", "--role", "protagonist");
    setupStory(home, root, "add", "location", "Grayling Shoal", "--type", "landmark", "--character", "ines-calloway");
    setupStory(home, root, "add", "chapter", "The Door Under The Shoal", "--number", "1", "--pov", "ines-calloway", "--location", "grayling-shoal", "--character", "ines-calloway");
    setupStory(home, root, "add", "scene", "Ines Finds The Door", "--chapter", "chapter-01", "--scene", "1", "--pov", "ines-calloway", "--location", "grayling-shoal", "--character", "ines-calloway");
    const chapter = path.join(root, "chapters", "chapter-01.md");
    edit(chapter, "status: outline\n", "status: draft\n");
    edit(chapter, "word-count: 0\n", "hook: question\nword-count: 0\n");
    fs.appendFileSync(chapter, "\nThe storm had taken the harbor wall in a single night. By morning the water off Grayling Shoal was brown with silt, and Ines Calloway was the only diver the council could find who would go down before the insurers arrived.\n\n"
      + "She went in at slack tide. Twenty metres down, where the shoal should have ended in sand, the current had scoured away a shelf of concrete and left a door.\n\n"
      + "It was steel, rimmed with rust, and it was locked from the inside.\n");
    edit(path.join(root, "scenes", "chapter-01-scene-01.md"), "sequel: false\n", "outcome: yes-but\nsequel: false\n");
    setupStory(home, root, "wordcount", ".", "--write");
    edit(path.join(root, "continuity", "state.md"), "current-chapter: 0\n", "current-chapter: 1\n");
  },
  // getting-started.md step 5: oskar-lind added by hand to chapter 1's cast,
  // with no file, and current-chapter left at 0.
  "sunken-ledger-broken": (home, stories) => {
    SETUPS["sunken-ledger-drafted"](home, stories);
    const root = path.join(stories, "the-sunken-ledger");
    edit(path.join(root, "chapters", "chapter-01.md"), "  - ines-calloway\nmentions", "  - ines-calloway\n  - oskar-lind\nmentions");
    edit(path.join(root, "continuity", "state.md"), "current-chapter: 1\n", "current-chapter: 0\n");
  },
  // cli-reference.md: a new Salt Road.
  "salt-road-new": (home, stories) => {
    setupStory(home, stories, "init", "The Salt Road", "--genre", "fantasy", "--sub-genre", "coastal adventure", "--theme", "loyalty", "--theme", "memory");
  },
  // cli-reference.md: The Salt Road filled with the commands under add.
  "salt-road-added": (home, stories) => {
    SETUPS["salt-road-new"](home, stories);
    const root = path.join(stories, "the-salt-road");
    for (const args of [
      ["location", "Gull Harbour", "--type", "port", "--region", "the Shallows"],
      ["character", "Ilse Marrow", "--role", "protagonist", "--location", "gull-harbour"],
      ["arc", "The Long Crossing", "--type", "main", "--character", "ilse-marrow", "--themes", "loyalty,memory", "--acts", "act-1,act-2"],
      ["chapter", "Low Tide", "--pov", "ilse-marrow", "--character", "ilse-marrow", "--location", "gull-harbour", "--arc", "the-long-crossing", "--date", "1024-03-02", "--time", "dawn", "--hook", "question"],
      ["scene", "The Harbour Bell", "--chapter", "chapter-01", "--pov", "ilse-marrow", "--location", "gull-harbour", "--character", "ilse-marrow", "--date", "1024-03-02", "--time", "06:30", "--outcome", "yes-but"],
      ["clue", "Tar on the chain", "--planted", "chapter-01", "--significance-delayed"],
      ["clue", "The Drowned Lantern", "--planted", "chapter-01", "--red-herring", "--character", "ilse-marrow"],
      ["term", "Slack water", "--category", "concept", "--alias", "slack", "--alias", "the turn"],
      ["research", "Tidal bore timing", "--source", "Admiralty Tide Tables, 2024 edition", "--used-in", "chapter-01", "--accuracy", "must-be-accurate", "--confidence", "medium", "--method", "reading", "--risk", "safety"],
      ["matter", "Acknowledgments", "--placement", "back"]
    ]) {
      setupStory(home, root, "add", ...args);
    }
  },
  // cli-reference.md: The Salt Road after the renames, the one-chapter
  // project most of the page's Salt Road samples use.
  "salt-road": (home, stories) => {
    SETUPS["salt-road-added"](home, stories);
    const root = path.join(stories, "the-salt-road");
    setupStory(home, root, "rename", "character", "ilse-marrow", "Ilse Varrow");
    setupStory(home, root, "rename", "chapter", "chapter-01", "Slack Water");
  },
  // cli-reference.md continuity: a saltmere location 30 hours from the
  // harbour, and a second scene that puts Ilse there the same evening.
  "salt-road-route": (home, stories) => {
    SETUPS["salt-road"](home, stories);
    const root = path.join(stories, "the-salt-road");
    setupStory(home, root, "add", "location", "Saltmere", "--type", "town");
    edit(path.join(root, "worldbuilding", "locations", "gull-harbour.md"), "tags: []\n", "tags: []\nroutes:\n  - to: saltmere\n    hours: 30\n    mode: salt wagon\n");
    setupStory(home, root, "add", "scene", "The Salt Gate", "--chapter", "chapter-01", "--pov", "ilse-varrow", "--location", "saltmere", "--character", "ilse-varrow", "--date", "1024-03-02", "--time", "evening");
  },
  // cli-reference.md next: the journey error fixed by moving the Saltmere
  // scene to the next day, then revising, with the structure pass done.
  "salt-road-revising": (home, stories) => {
    SETUPS["salt-road-route"](home, stories);
    const root = path.join(stories, "the-salt-road");
    edit(path.join(root, "scenes", "chapter-01-scene-02.md"), "date: 1024-03-02\n", "date: 1024-03-03\n");
    edit(path.join(root, "story.md"), "status: planning\n", "status: revising\n");
    setupStory(home, root, "passes", "--init");
    setupStory(home, root, "passes", "--done", "structure");
  },
  // cli-reference.md passes: the default ladder recorded and structure done.
  "salt-road-passes": (home, stories) => {
    SETUPS["salt-road"](home, stories);
    const root = path.join(stories, "the-salt-road");
    setupStory(home, root, "passes", "--init");
    setupStory(home, root, "passes", "--done", "structure");
  },
  // cli-reference.md timeline: a second chapter with a flashback scene
  // twelve years earlier and a scene back on the quay.
  "salt-road-flashback": (home, stories) => {
    SETUPS["salt-road"](home, stories);
    const root = path.join(stories, "the-salt-road");
    const scene = ["--chapter", "chapter-02", "--pov", "ilse-varrow", "--location", "gull-harbour", "--character", "ilse-varrow"];
    setupStory(home, root, "add", "chapter", "The Old Harbour", "--pov", "ilse-varrow", "--character", "ilse-varrow", "--location", "gull-harbour");
    setupStory(home, root, "add", "scene", "Twelve Years Earlier", ...scene, "--date", "1012-11-08", "--time", "night");
    setupStory(home, root, "add", "scene", "Back on the Quay", ...scene, "--date", "1024-03-02", "--time", "evening");
  },
  // cli-reference.md doctor, "A worked repair": the unraveled thread with
  // glossary/_index.md deleted, chapter 1's word-count edited to 20, and
  // edran-vale misspelt edran-vael in its cast.
  "worked-repair": (home, stories) => {
    const root = path.join(stories, "the-unraveled-thread");
    fs.rmSync(path.join(root, "glossary", "_index.md"));
    edit(path.join(root, "chapters", "chapter-01.md"), "word-count: 34\n", "word-count: 20\n");
    edit(path.join(root, "chapters", "chapter-01.md"), "  - edran-vale\n", "  - edran-vael\n");
  },
  // continuity.md: the unraveled thread after the fixes in "Worked example:
  // fixing the unraveled thread".
  "unraveled-repaired": (home, stories) => {
    const root = path.join(stories, "the-unraveled-thread");
    edit(path.join(root, "chapters", "chapter-04.md"), "  - jonas-reed\n  - edran-vale\n", "  - jonas-reed\nmentions:\n  - edran-vale\n");
    edit(path.join(root, "continuity", "promises", "the-broken-compass.md"), "planted: chapter-03\npayoff: chapter-02\n", "planted: chapter-02\npayoff: chapter-03\n");
    edit(path.join(root, "continuity", "questions", "who-burned-the-mill.md"), "introduced: chapter-03\nresolved: chapter-02\n", "introduced: chapter-02\nresolved: chapter-03\n");
    edit(path.join(root, "continuity", "state.md"), "learned-in: chapter-05\n", "learned-in: chapter-04\n");
    edit(path.join(root, "continuity", "state.md"), "    status: active\n", "    status: destroyed\n    since: chapter-02\n");
    edit(path.join(root, "chapters", "chapter-03.md"), "  - jonas-reed\n", "  - jonas-reed\n  - nessa-thorn\n");
    fs.writeFileSync(path.join(root, "continuity", "exemptions.md"), "---\ntype: exemption-log\nexemptions:\n  - code: promise-unpaid\n    file: continuity/promises/the-sealed-letter.md\n"
      + "    reason: \"The letter pays off in book two; the gap is deliberate.\"\n---\n\n# Continuity Exemptions\n");
  },
  // continuity.md timeline: the repaired thread with the scene dates from
  // "Clock and travel time".
  "unraveled-dated": (home, stories) => {
    SETUPS["unraveled-repaired"](home, stories);
    const scenes = path.join(stories, "the-unraveled-thread", "scenes");
    edit(path.join(scenes, "chapter-01-scene-01.md"), "status: outline\n", "status: outline\ndate: 1924-10-14\ntime: night\n");
    edit(path.join(scenes, "chapter-02-scene-01.md"), "status: outline\n", "status: outline\ndate: 1924-10-21\ntime: morning\n");
    edit(path.join(scenes, "chapter-03-scene-01.md"), "status: outline\n", "status: outline\ndate: 1924-10-20\ntime: \"22:00\"\nflashback-to: the night of the fire\n");
    edit(path.join(scenes, "chapter-04-scene-01.md"), "status: outline\n", "status: outline\ndate: 1924-10-21\ntime: \"23:30\"\ntravel-hours: 30\n");
  },
  // continuity.md passes: the default ladder recorded on the unraveled
  // thread, with structure done.
  "unraveled-passes": (home, stories) => {
    const root = path.join(stories, "the-unraveled-thread");
    setupStory(home, root, "passes", ".", "--init");
    setupStory(home, root, "passes", ".", "--done", "structure");
  },
  // continuity.md next: the same copy revising, with character in progress.
  "unraveled-revising": (home, stories) => {
    SETUPS["unraveled-passes"](home, stories);
    const root = path.join(stories, "the-unraveled-thread");
    setupStory(home, root, "passes", ".", "--start", "character");
    edit(path.join(root, "story.md"), "status: drafting\n", "status: revising\n");
  },
  // cli-reference.md voices: reckon in Kael's voice-words and soldiers in
  // his voice-avoid.
  "last-ember-kael-voice": (home, stories) => {
    edit(path.join(stories, "the-last-ember", "characters", "kael-voss.md"), "---\n", "---\nvoice-words:\n  - reckon\nvoice-avoid:\n  - soldiers\n");
  },
  // continuity.md voices: voice-words and voice-avoid on Kael, and Sera's
  // pronoun tags changed to name her.
  "last-ember-voices": (home, stories) => {
    const root = path.join(stories, "the-last-ember");
    edit(path.join(root, "characters", "kael-voss.md"), "---\n", "---\nvoice-words:\n  - for the record\n  - aye\nvoice-avoid:\n  - good\n");
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replaceAll(" she said", " Sera said").replaceAll(" she murmured", " Sera murmured"));
  },
  // continuity.md progress: targets on the book and chapter 1, and four
  // logged sessions.
  "last-ember-progress": (home, stories) => {
    const root = path.join(stories, "the-last-ember");
    edit(path.join(root, "story.md"), "status: in-progress\n", "status: in-progress\ntarget-words: 90000\ndeadline: 2027-03-31\n");
    edit(path.join(root, "chapters", "chapter-01.md"), "word-count:", "target-words: 3500\nword-count:");
    fs.writeFileSync(path.join(root, "progress.md"), "---\ntype: progress-log\nsessions:\n"
      + ["2026-09-14: 120", "2026-09-17: 480", "2026-09-20: 760", "2026-09-24: 967"].map((entry) => `  - date: ${entry.replace(": ", "\n    words: ")}\n`).join("") + "---\n");
  },
  // cli-reference.md progress: target-words 90000 and a deadline.
  "last-ember-target": (home, stories) => {
    edit(path.join(stories, "the-last-ember", "story.md"), "status: in-progress\n", "status: in-progress\ntarget-words: 90000\ndeadline: 2027-03-31\n");
  },
  // writing-workflows.md: The Gannet Point Light, a novel with a deadline
  // and 132 words drafted.
  "gannet-point-light": (home, stories) => {
    const root = path.join(stories, "the-gannet-point-light");
    setupStory(home, stories, "init", "The Gannet Point Light", "--form", "novel");
    edit(path.join(root, "story.md"), "target-words: 80000\n", "target-words: 80000\ndeadline: 2027-03-31\n");
    setupStory(home, root, "add", "chapter", "The Drowned Man", "--number", "1");
    fs.appendFileSync(path.join(root, "chapters", "chapter-01.md"), `\n${Array.from({ length: 132 }, () => "tide").join(" ")}\n`);
  }
};

// The output with trailing blank lines dropped: a sample may leave a blank
// line between one command's output and the next prompt.
function trimmed(text) {
  return text.replace(/\s+$/, "");
}

const all = markdownFiles().flatMap((file) => samples(file).map((sample) => ({ ...sample, file })));

describe("doc sample markers", () => {
  test("each file marks the samples MARKED pins", () => {
    const counts = {};
    for (const { file } of all) {
      counts[file] = (counts[file] ?? 0) + 1;
    }
    expect(counts).toEqual(MARKED);
  });

  test("a comment that mentions replay but is not a marker on its own line fails", () => {
    const sample = "```shell\nstory continuity\n```\n\n```text\nContinuity is consistent\n```\n";
    for (const comment of ["<!-- replay:the-last-ember -->", "<!--replay-->", "<!-- Replay -->", "<!-- replay: the-last-ember exit=two -->", "<!-- replay: ../.. -->", "Text <!-- replay -->"]) {
      expect(() => samples("x.md", `${comment}\n${sample}`)).toThrow("is not a replay comment");
    }
    expect(samples("x.md", `<!-- replay: the-last-ember setup=worked-repair exit=0 -->\n${sample}`)).toHaveLength(1);
  });

  test("a replay comment in a code span or a fence is text, not a marker", () => {
    expect(samples("x.md", "Mark it with `<!-- replay:x -->`.\n\n```markdown\n<!-- replay -->\n```\n")).toEqual([]);
  });

  test("a marker names an example, a setup, and exit codes that exist", () => {
    const sample = "```text\n$ story add\n$ story add villain\n```\n";
    expect(() => samples("x.md", `<!-- replay: no-such-book -->\n${sample}`)).toThrow("no-such-book is not an example");
    expect(() => samples("x.md", `<!-- replay: the-last-ember setup=no-such-setup -->\n${sample}`)).toThrow("no setup named no-such-setup");
    expect(() => samples("x.md", `<!-- replay: the-last-ember exit=2,2,2 -->\n${sample}`)).toThrow("exit= gives 3 codes for 2 commands");
    expect(() => samples("x.md", "<!-- replay -->\nNo fence here.\n")).toThrow("must come straight before");
  });

  test("a replayed command cannot name a path outside the scratch home, or a part of the repository it lacks", () => {
    const home = path.join(path.sep, "scratch", "home");
    const book = path.join(home, "stories", "the-last-ember");
    expect(commandLine("story build --out dist/book.md", book, home)).toEqual([storyBin, "build", "--out", "dist/book.md"]);
    expect(commandLine("story export --out ../outside.md", book, home)).toEqual([storyBin, "export", "--out", "../outside.md"]);
    for (const line of ["story build --out /tmp/book.md", "story reindex ../../..", "story build --out=../../../book.md", "story validate --path ../../../checkout"]) {
      expect(() => commandLine(line, book, home)).toThrow("is outside the scratch home");
    }
    expect(() => commandLine("story validate templates/github", path.join(home, "story-skills"), home)).toThrow("only examples/ is copied");
    expect(() => commandLine("node scripts/release.js", path.join(home, "story-skills"), home)).toThrow("cannot replay");
    expect(() => commandLine("story continuity . | head", book, home)).toThrow("one plain story command");
  });
});

// The samples show POSIX paths and a POSIX shell, so they run where those
// hold.
describe.skipIf(process.platform === "win32")("replayed doc samples", () => {
  for (const sample of all) {
    const shown = sample.steps.flatMap((step) => step.commands).join("; ");
    test(`${sample.where} ${shown}`, () => {
      const { home, copy, cwd } = scratchHome(sample.folder);
      if (sample.setup !== undefined) {
        SETUPS[sample.setup](home, copy);
      }
      expect(fs.existsSync(cwd)).toBe(true);
      let index = 0;
      for (const step of sample.steps) {
        let output = "";
        for (const command of step.commands) {
          const argv = commandLine(command, cwd, home);
          const before = treeSnapshot(copy);
          const result = run(argv, cwd, home);
          output += result.output;
          expect({ command, exit: result.status }).toEqual({ command, exit: sample.exit(index) });
          // A refused command writes nothing.
          if (result.status !== 0) {
            expect({ command, changes: treeDiff(before, treeSnapshot(copy)) }).toEqual({ command, changes: [] });
          }
          index += 1;
        }
        expect(trimmed(output)).toBe(trimmed(step.output));
      }
    });
  }
});
