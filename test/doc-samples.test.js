import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "./helpers.js";

// Replays the command samples in the docs that a `<!-- replay -->` comment
// marks, so a change to what the CLI prints fails here until the sample is
// refreshed (#564). docs/development.md describes the convention.
const repoRoot = path.resolve(import.meta.dir, "..");
const storyBin = path.join(repoRoot, "bin", "story.js");
const MARKER = /^\s*<!-- replay(?:: ([^\s>]+))? -->\s*$/;
const FENCE = /^(\s*)```(\w*)\s*$/;

function markdownFiles() {
  const docs = fs.readdirSync(path.join(repoRoot, "docs")).filter((name) => name.endsWith(".md")).map((name) => `docs/${name}`);
  return ["README.md", ...docs.sort()];
}

// The fence that opens at `lines[index]`, with its indent taken off each
// line, and the index of its closing line.
function readFence(lines, index) {
  const open = FENCE.exec(lines[index] ?? "");
  if (open === null) {
    return null;
  }
  const indent = open[1];
  const body = [];
  let end = index + 1;
  while (end < lines.length && lines[end].trim() !== "```") {
    body.push(lines[end].startsWith(indent) ? lines[end].slice(indent.length) : lines[end]);
    end += 1;
  }
  return end < lines.length ? { lang: open[2], body, end } : null;
}

function nextNonBlank(lines, index) {
  let next = index;
  while (next < lines.length && lines[next].trim() === "") {
    next += 1;
  }
  return next;
}

// A command line split into arguments as a POSIX shell would for the plain
// words and quoted strings the samples use. Anything that needs a real
// shell (pipes, redirects, variables, command chains) cannot be replayed.
function shellWords(line) {
  if (!/^story(\s|$)/.test(line) || /[|&;<>$`\\]/.test(line.replace(/"[^"]*"|'[^']*'/g, ""))) {
    throw new Error(`cannot replay ${JSON.stringify(line)}: write it as one plain story command`);
  }
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3]).slice(1);
}

// Each marked sample: a shell fence of story commands followed by a text
// fence with their output, or one text fence of `$ story ...` lines each
// followed by its output.
function samples(file) {
  const lines = fs.readFileSync(path.join(repoRoot, file), "utf8").split("\n");
  const found = [];
  lines.forEach((line, index) => {
    const marker = MARKER.exec(line);
    if (marker === null) {
      return;
    }
    const where = `${file}:${index + 1}`;
    const first = readFence(lines, index + 1);
    if (first?.lang === "shell") {
      const output = readFence(lines, nextNonBlank(lines, first.end + 1));
      if (output?.lang !== "text") {
        throw new Error(`${where}: the replayed shell fence must be followed by a text fence with its output`);
      }
      const commands = first.body.filter((command) => command.trim() !== "");
      found.push({ where, example: marker[1], steps: [{ commands, output: output.body.join("\n") }] });
    } else if (first?.lang === "text" && first.body[0]?.startsWith("$ ")) {
      const steps = [];
      for (const bodyLine of first.body) {
        if (bodyLine.startsWith("$ ")) {
          steps.push({ commands: [bodyLine.slice(2)], output: [] });
        } else {
          steps.at(-1).output.push(bodyLine);
        }
      }
      found.push({ where, example: marker[1], steps: steps.map((step) => ({ ...step, output: step.output.join("\n") })) });
    } else {
      throw new Error(`${where}: a replay comment must come straight before a shell fence or a text fence that starts with "$ story"`);
    }
  });
  return found;
}

// A scratch home folder, shown in output as ~, with a copy of the examples:
// as ~/stories, for a sample run in one of them (or, with ".", in ~/stories
// itself) beside the books it links to, or, for a sample with no example, as
// ~/story-skills/examples, so it runs from the repository root.
function scratchHome(example) {
  const home = fs.realpathSync(makeTempDir("story-doc-samples-"));
  const examples = example === undefined ? path.join(home, "story-skills", "examples") : path.join(home, "stories");
  fs.cpSync(path.join(repoRoot, "examples"), examples, { recursive: true });
  return { home, cwd: example === undefined ? path.dirname(examples) : path.join(examples, example) };
}

// Runs one command with stdout and stderr sharing a file, so their lines
// keep the order the CLI printed them in.
function replay(args, cwd, home) {
  const capture = path.join(home, "output.txt");
  const fd = fs.openSync(capture, "w");
  try {
    spawnSync(process.execPath, [storyBin, ...args], { cwd, stdio: ["ignore", fd, fd] });
  } finally {
    fs.closeSync(fd);
  }
  return fs.readFileSync(capture, "utf8").split(home).join("~");
}

// The output with trailing blank lines dropped: a sample may leave a blank
// line between one command's output and the next prompt.
function trimmed(text) {
  return text.replace(/\s+$/, "");
}

// The samples show POSIX paths and a POSIX shell, so they run where those
// hold.
describe.skipIf(process.platform === "win32")("replayed doc samples", () => {
  const all = markdownFiles().flatMap(samples);

  test("the docs mark samples to replay", () => {
    expect(all.length).toBeGreaterThan(0);
  });

  for (const sample of all) {
    const shown = sample.steps.flatMap((step) => step.commands).join("; ");
    test(`${sample.where} ${shown}`, () => {
      const { home, cwd } = scratchHome(sample.example);
      expect(fs.existsSync(cwd)).toBe(true);
      for (const step of sample.steps) {
        const actual = step.commands.map((command) => replay(shellWords(command), cwd, home)).join("");
        expect(trimmed(actual)).toBe(trimmed(step.output));
      }
    });
  }
});
