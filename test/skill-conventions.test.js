import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { COMMANDS } from "../src/commands.js";
import { parseFrontmatter } from "../src/frontmatter.js";
import { takesValue } from "../src/options.js";
import { TERM_CATEGORIES } from "../src/scan.js";
import { makeTempDir, memoryIo } from "./helpers.js";

// Every skill links the shared conventions file and repeats the same short
// summary, so a skill installed without story-maintenance still has them.

const skillsDir = path.join(import.meta.dir, "..", "skills");
const skills = fs.readdirSync(skillsDir).filter((name) => fs.existsSync(path.join(skillsDir, name, "SKILL.md"))).sort();
const sharedSection = (name) => {
  const text = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
  const match = text.match(/\n## Shared Conventions\n\n([\s\S]*?)(?=\n## |\s*$)/);
  return match ? match[1] : null;
};
const summary = (section) => section.match(/(kebab-case ids[\s\S]*?\(run only the installed or bundled Story CLI\)\.)/)?.[1];

describe("shared story conventions", () => {
  test("the conventions reference exists", () => {
    expect(fs.existsSync(path.join(skillsDir, "story-maintenance", "references", "conventions.md"))).toBe(true);
  });

  test("every SKILL.md links the conventions reference with the same summary", () => {
    const expected = summary(sharedSection("story-maintenance"));
    expect(expected).toBeString();
    for (const name of skills) {
      const section = sharedSection(name);
      expect(section, `${name} has no Shared Conventions section`).toBeString();
      const link = name === "story-maintenance" ? "references/conventions.md" : "../story-maintenance/references/conventions.md";
      expect(section).toContain(`](${link})`);
      expect(fs.existsSync(path.resolve(skillsDir, name, link))).toBe(true);
      expect(summary(section), `${name} summary differs from story-maintenance`).toBe(expected);
    }
  });
});

// When `story` is not installed, every skill gives the same fallback: the
// bundled story-maintenance/scripts/story.js, or a Story Skills checkout's
// bin/story.js only when the user names one, run with Node by absolute path
// from the folder the agent would run `story` from. Package scripts and Bun
// are never the fallback: a package script (`bun run story`, `yarn story`)
// runs from the checkout's root, so the `.` every skill passes would name the
// checkout, and Bun loads the story folder's bunfig.toml (whose `preload`
// runs code) and .env.

const repoRoot = path.join(import.meta.dir, "..");
const FALLBACK_LEAD = "If `story` is not installed,";
const FALLBACK = `${FALLBACK_LEAD} use the bundled fallback \`node ../story-maintenance/scripts/story.js\` with the same arguments. Use \`node <checkout>/bin/story.js\` instead only when the user names a Story Skills repository checkout or you are working in one. Write the script as an absolute path (resolve the fallback relative to this skill folder) and run it from the folder you would run \`story\` from, so \`.\` and other relative paths keep their meaning. Use Node, not Bun or a package script: Bun would load that folder's \`bunfig.toml\` (which can run code) and \`.env\`, and a package script runs from the checkout's root.`;
const FENCE = /^\s*(```|~~~)/;
// A package manager running the `story` script, with or without `run` and
// options such as `--cwd <dir>` before it.
const PACKAGE_SCRIPT = /\b(?:bun|npm|pnpm|yarn)(?:\s+-[^\s`]+(?:\s+[^\s`-][^\s`]*)?)*\s+(?:run(?:-script)?\s+)?story(?![\w./-])/;
const BUN_SCRIPT = /\bbun(?:\s+-[^\s`]+)*\s+(?:run\s+)?[^\s`]*story\.js\b/;
const CD_THEN_CLI = /\b(?:cd|pushd)\s+[^\s;&|`]+\s*(?:&&|;)\s*(?:node|bun|deno|npm|pnpm|yarn)\b[^`\n]*\bstory\b/;
const SCRIPT_RUN = /\b(?:node|bun|deno)(?:\s+-[^\s`]+)*\s+([^\s`]*story\.js)\b/g;
const ABSOLUTE = /^(?:\/|~|<|\$|%|\{|[A-Za-z]:[\\/])/;
// The bundled fallback's paths relative to a skill folder, which the fallback
// sentence says to resolve; prose may name them, a code block may not.
const SKILL_RELATIVE = new Set(["../story-maintenance/scripts/story.js", "scripts/story.js"]);
const RUNS_STORY = /`story [a-z]|^\s*story [a-z]/m;

function markdownFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return markdownFiles(full);
    }
    return entry.name.endsWith(".md") ? [full] : [];
  }).sort();
}

// Each line of a markdown text that runs the CLI somewhere other than the
// folder the agent would run `story` from, or with Bun, as "line N: why".
function cliRunProblems(text) {
  const problems = [];
  let fence = null;
  text.split("\n").forEach((line, index) => {
    const open = line.match(FENCE);
    if (fence && line.trim().startsWith(fence)) {
      fence = null;
      return;
    }
    if (!fence && open) {
      fence = open[1];
      return;
    }
    const why = [];
    if (PACKAGE_SCRIPT.test(line)) {
      why.push("runs the `story` package script, which starts in the checkout's root");
    }
    if (BUN_SCRIPT.test(line)) {
      why.push("runs the CLI with Bun, which loads the folder's bunfig.toml and .env");
    }
    if (CD_THEN_CLI.test(line)) {
      why.push("changes folder before running the CLI");
    }
    for (const [, script] of line.matchAll(SCRIPT_RUN)) {
      if (!ABSOLUTE.test(script) && (fence || !SKILL_RELATIVE.has(script))) {
        why.push(`runs \`${script}\` by a relative path${fence ? " in a code block" : ""}`);
      }
    }
    problems.push(...why.map((reason) => `line ${index + 1}: ${reason}`));
  });
  return problems;
}

// The start of each fallback sentence in a text that is not the shared one.
// Line breaks count as spaces, so a hard-wrapped skill matches too.
function fallbackProblems(text) {
  return text.replace(/\s+/g, " ").split(FALLBACK_LEAD).slice(1)
    .map((rest) => `${FALLBACK_LEAD}${rest}`)
    .filter((sentence) => !sentence.startsWith(FALLBACK))
    .map((sentence) => sentence.slice(0, 120));
}

describe("CLI fallback", () => {
  test("detects CLI runs outside the story folder and a reworded fallback", () => {
    const reasons = (text) => cliRunProblems(text).map((problem) => problem.replace(/^line \d+: /, ""));
    for (const run of ["bun run story -- validate .", "bun story validate .", "yarn story check .", "pnpm story check .", "npm run-script story -- check .", "npm run story", "bun --cwd <checkout> run story -- check ."]) {
      expect(reasons(`use \`${run}\``), run).toEqual(["runs the `story` package script, which starts in the checkout's root"]);
    }
    expect(cliRunProblems("intro\n```shell\nyarn run story check .\n```")).toEqual(["line 3: runs the `story` package script, which starts in the checkout's root"]);
    expect(reasons("`bun <checkout>/bin/story.js check .`")).toEqual(["runs the CLI with Bun, which loads the folder's bunfig.toml and .env"]);
    expect(reasons("`cd <checkout> && node bin/story.js check .`")).toEqual(["changes folder before running the CLI", "runs `bin/story.js` by a relative path"]);
    expect(reasons("```shell\nnode ../story-maintenance/scripts/story.js init 'T'\n```")).toEqual(["runs `../story-maintenance/scripts/story.js` by a relative path in a code block"]);
    expect(cliRunProblems([
      "use `node ../story-maintenance/scripts/story.js` or `node <checkout>/bin/story.js`",
      "`npm install -g story-skills`, `npx story-skills check .`, `story check .`, `bunfig.toml`",
      "```shell",
      "node <skills>/story-maintenance/scripts/story.js check .",
      "node ~/skills/story-maintenance/scripts/story.js check .",
      "node C:\\skills\\story-maintenance\\scripts\\story.js check .",
      "```"
    ].join("\n"))).toEqual([]);
    expect(fallbackProblems(`Use the Story CLI. ${FALLBACK} If no CLI is available, check by hand.`)).toEqual([]);
    expect(fallbackProblems(FALLBACK.replace(/ (?=with|absolute|Node)/g, "\n"))).toEqual([]);
    expect(fallbackProblems(`${FALLBACK}\n\n${FALLBACK_LEAD} use \`bun run story --\` with the same arguments.`)).toEqual([
      `${FALLBACK_LEAD} use \`bun run story --\` with the same arguments.`
    ]);
  });

  test("no markdown file under skills/ runs the CLI outside the story folder or with Bun", () => {
    const problems = markdownFiles(skillsDir).flatMap((file) => cliRunProblems(fs.readFileSync(file, "utf8")).map((problem) => `${path.relative(skillsDir, file)} ${problem}`));
    expect(problems).toEqual([]);
  });

  test("every skill that runs a story command gives the same fallback sentence", () => {
    const runners = skills.filter((name) => name !== "story-maintenance" && RUNS_STORY.test(fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8")));
    // Guard against a matcher that silently stops finding skills.
    expect(runners.length).toBeGreaterThan(20);
    for (const name of runners) {
      const text = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
      expect(fallbackProblems(text), `${name} words the CLI fallback differently`).toEqual([]);
      expect(text.replace(/\s+/g, " ").includes(FALLBACK), `${name} has no CLI fallback sentence`).toBe(true);
    }
    const maintenance = fs.readFileSync(path.join(skillsDir, "story-maintenance", "SKILL.md"), "utf8").replace(/\s+/g, " ");
    expect(maintenance).toContain("2. `node scripts/story.js <command>` - bundled fallback");
    expect(maintenance).toContain("3. `node <checkout>/bin/story.js <command>` - only when the user names a Story Skills repository checkout or you are working in one");
    expect(maintenance).toContain("as an absolute path and run the command from the folder you would run `story` from");
    expect(maintenance).toContain("Use Node, not Bun");
  });

  test("the fallback forms run in the story project folder", () => {
    const project = path.join(repoRoot, "examples", "harbor-of-second-light");
    // process.execPath is Bun under `bun test`. Without node on PATH, the
    // forms still run, under Bun, so the folder they resolve `.` against is
    // still checked.
    const hasNode = spawnSync("node", ["--version"], { encoding: "utf8" }).status === 0;
    if (!hasNode) {
      console.warn("node is not on PATH: running the Node fallback forms with Bun instead.");
    }
    const runtime = hasNode ? "node" : process.execPath;
    for (const script of [path.join(skillsDir, "story-maintenance", "scripts", "story.js"), path.join(repoRoot, "bin", "story.js")]) {
      const result = spawnSync(runtime, [script, "validate", "."], { cwd: project, encoding: "utf8" });
      expect(result.stderr, `${runtime} ${script}`).toContain("Project is valid");
      expect(result.status).toBe(0);
    }
  });
});

// Skills put the user's own words (a title, a name, a synopsis, a label from
// a reader's note) into a story command in single quotes (#556). Inside double
// quotes a POSIX shell still runs `$(...)` and backticks and expands `$name`,
// so a title such as `The $5 Fix` loses text and a synopsis with a backtick
// runs a command; unquoted, the words split and `;` or `&` runs a command.
//
// A story command is a line of a fenced block (joined across `\` line ends)
// or an inline code span that runs `story` or a `story.js` with Node, after
// any `$ ` prompt, `NAME=value` prefix, or `cd x &&`. Under skills/, which
// agents copy, no story command double-quotes an argument, and a placeholder
// (`{Title}`, `<name>`) where the CLI takes the user's text is single-quoted.
// In docs/ and the README, which show literal examples too, only a
// double-quoted placeholder is an error.

const docsDir = path.join(repoRoot, "docs");
const STORY_COMMAND = /^(?:story|node\s+\S*story\.js)\s/;
const PLACEHOLDER = /(?<!\$)\{[^{}\s]+(?:\s[^{}\s]+)*\}|<[^<>\s]+(?:\s[^<>\s]+)*>/;
const PLACEHOLDER_WORDS = new Set(["...", "…", "Title", "Name", "New Name"]);
// Options whose value is the user's text, or a path that can hold spaces,
// for every command and for one command only (`knowledge --at` takes a
// chapter id).
const TEXT_OPTIONS = new Set(["--title", "--synopsis", "--dilemma", "--anchor", "--source", "--genre", "--sub-genre", "--setting-era", "--theme", "--themes", "--date", "--follows", "--precedes", "--against", "--path", "--dir"]);
const COMMAND_TEXT_OPTIONS = { split: new Set(["--at"]) };
// Positional arguments that are the user's text: each command's text
// positions, counted from 0 after the command word.
const TEXT_POSITIONS = { init: [0], add: [1], names: "all", rename: [2], import: [0] };
// An inline span that is one option and its value (`--title '<Title>'`) is
// part of a story command named in prose; a longer span such as an error
// message that starts with an option is not.
const OPTION_FRAGMENT = /^--[a-z][\w-]*[ =](?:'[^']*'|"(?:[^"\\]|\\.)*"|[^\s'"]+)$/;

// The code spans of a markdown text, as CommonMark reads them: a run of n
// backticks closes only at the next run of exactly n, and a run with no
// match is literal text.
function codeSpans(text) {
  const spans = [];
  let index = 0;
  while (index < text.length) {
    const open = text.slice(index).match(/`+/);
    if (!open) {
      break;
    }
    const start = index + open.index;
    const ticks = open[0].length;
    const close = new RegExp(`(?<!\`)\`{${ticks}}(?!\`)`, "g");
    close.lastIndex = start + ticks;
    const end = close.exec(text);
    if (!end) {
      index = start + ticks;
      continue;
    }
    let content = text.slice(start + ticks, end.index).replace(/\n/g, " ");
    if (/^ .*\S.* $/.test(content)) {
      content = content.slice(1, -1);
    }
    spans.push({ start, end: end.index + ticks, content });
    index = end.index + ticks;
  }
  return spans;
}

// The shell words of a command line. Each word is a list of parts with the
// quote that wrapped them: `'`, `"`, or "" for none.
function shellWords(line) {
  const words = [];
  let word = null;
  let index = 0;
  const add = (text, quote) => {
    word ??= [];
    word.push({ text, quote });
  };
  while (index < line.length) {
    const char = line[index];
    if (/\s/.test(char)) {
      if (word) {
        words.push(word);
        word = null;
      }
      index += 1;
    } else if (char === "'") {
      const end = line.indexOf("'", index + 1);
      const stop = end < 0 ? line.length : end;
      add(line.slice(index + 1, stop), "'");
      index = stop + 1;
    } else if (char === '"') {
      let end = index + 1;
      while (end < line.length && line[end] !== '"') {
        end += line[end] === "\\" ? 2 : 1;
      }
      add(line.slice(index + 1, end), '"');
      index = end + 1;
    } else {
      const run = line.slice(index).match(/^(?:\\.|[^\s'"\\]|\\$)+/)[0];
      add(run, "");
      index += run.length;
    }
  }
  if (word) {
    words.push(word);
  }
  return words;
}

// A command line split at `&&`, `||`, `;`, and `|` outside quotes and
// placeholders, each piece without its `$ ` prompt or `NAME=value` prefixes.
function commandPieces(line) {
  const pieces = [];
  let current = "";
  let quote = null;
  let depth = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      current += char;
      if (char === quote) {
        quote = null;
      } else if (char === "\\" && quote === '"') {
        current += line[++index] ?? "";
      }
      continue;
    }
    if (char === "\\") {
      current += char + (line[++index] ?? "");
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "{" || char === "<") {
      depth += 1;
    } else if ((char === "}" || char === ">") && depth > 0) {
      depth -= 1;
    } else if (depth === 0 && (char === ";" || char === "|" || (char === "&" && line[index + 1] === "&"))) {
      pieces.push(current);
      current = "";
      if (line[index + 1] === char) {
        index += 1;
      }
      continue;
    }
    current += char;
  }
  pieces.push(current);
  return pieces.map((piece) => piece.trim().replace(/^\$\s+/, "").replace(/^(?:[A-Za-z_]\w*=\S*\s+)+/, "")).filter((piece) => STORY_COMMAND.test(piece));
}

const oneLine = (text) => text.replace(/\s+/g, " ").trim();

// The story commands in a markdown text, each with the line it starts on.
function storyCommands(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const commands = [];
  let fence = null;
  const prose = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    prose.push("");
    if (fence) {
      if (line.trim().startsWith(fence) && /^[`~]+$/.test(line.trim())) {
        fence = null;
        continue;
      }
      let joined = line;
      const first = index + 1;
      while (/\\\s*$/.test(joined) && index + 1 < lines.length && !lines[index + 1].trim().startsWith(fence)) {
        index += 1;
        prose.push("");
        joined = `${joined.replace(/\\\s*$/, "")} ${lines[index].trim()}`;
      }
      commands.push(...commandPieces(oneLine(joined)).map((command) => ({ line: first, command })));
      continue;
    }
    const open = line.match(FENCE);
    if (open) {
      fence = open[1];
      continue;
    }
    prose[prose.length - 1] = line;
  }
  const body = prose.join("\n");
  for (const span of codeSpans(body)) {
    const line = body.slice(0, span.start).split("\n").length;
    const content = oneLine(span.content);
    if (OPTION_FRAGMENT.test(content)) {
      commands.push({ line, command: content, fragment: true });
    }
    commands.push(...commandPieces(content).map((command) => ({ line, command })));
  }
  return { commands: commands.sort((a, b) => a.line - b.line), prose: body };
}

const isPlaceholder = (text) => PLACEHOLDER.test(text) || PLACEHOLDER_WORDS.has(text);

// Why a story command quotes user text unsafely, or [] when it does not.
// `strict` is the skills/ rule; otherwise only double-quoted placeholders
// count. A fragment is checked for double quotes only, since prose names an
// option's value as `--path <project>`.
function quotingProblems(command, strict, fragment = false) {
  const words = shellWords(command);
  const problems = words.flatMap((word) => word.filter((part) => part.quote === '"' && (strict || isPlaceholder(part.text))).map((part) => `double-quotes "${part.text}"`));
  if (!strict || fragment) {
    return problems;
  }
  const subcommand = words[0].map((part) => part.text).join("") === "story" ? words[1] : words[2];
  const name = subcommand?.map((part) => part.text).join("");
  const positions = TEXT_POSITIONS[name];
  let position = -1;
  for (let index = words.indexOf(subcommand) + 1; index < words.length; index += 1) {
    const word = words[index];
    const first = word[0].text;
    let value = null;
    if (first.startsWith("--")) {
      const option = first.split("=")[0];
      if (!TEXT_OPTIONS.has(option) && !COMMAND_TEXT_OPTIONS[name]?.has(option)) {
        // Skip the option's value too, so it is not read as a positional.
        if (!first.includes("=") && takesValue(option.slice(2))) {
          index += 1;
        }
        continue;
      }
      if (first.includes("=")) {
        value = [{ ...word[0], text: first.slice(option.length + 1) }, ...word.slice(1)];
      } else if (words[index + 1] && !words[index + 1][0].text.startsWith("--")) {
        index += 1;
        value = words[index];
      }
    } else {
      position += 1;
      if (positions === "all" || positions?.includes(position)) {
        value = word;
      }
    }
    for (const part of value ?? []) {
      if (part.quote === "" && PLACEHOLDER.test(part.text)) {
        problems.push(`leaves ${part.text} unquoted`);
      }
    }
  }
  return problems;
}

function fileQuotingProblems(text, strict) {
  return storyCommands(text).commands.flatMap(({ line, command, fragment }) => quotingProblems(command, strict, fragment).map((why) => `line ${line}: ${why} in \`${command}\``));
}

describe("user text in story commands", () => {
  test("finds story commands in fences, wrapped spans, double-backtick spans, and shell lines", () => {
    const { commands } = storyCommands([
      "```shell",
      "story add research 'A' --used-in chapter-03 \\",
      "  --method fact",
      "$ story check .",
      "cd book && STORY_LOCK_WAIT_MS=0 story reindex . | tee log; story names 'Mara'",
      "```",
      "A literal fence: `` ``` `` in prose, then `story add",
      "   character 'Ines'` and ``story names 'a`b'``; `--title '<Title>'` names it."
    ].join("\n"));
    expect(commands).toEqual([
      { line: 2, command: "story add research 'A' --used-in chapter-03 --method fact" },
      { line: 4, command: "story check ." },
      { line: 5, command: "story reindex ." },
      { line: 5, command: "story names 'Mara'" },
      { line: 7, command: "story add character 'Ines'" },
      { line: 8, command: "story names 'a`b'" },
      { line: 8, command: "--title '<Title>'", fragment: true }
    ]);
  });

  test("flags double quotes and unquoted text placeholders under skills/", () => {
    const strict = (command) => quotingProblems(command, true);
    expect(strict('story init "{Title}" --synopsis \'{synopsis}\'')).toEqual(['double-quotes "{Title}"']);
    expect(strict('story add chapter "Title" --number 7')).toEqual(['double-quotes "Title"']);
    expect(strict('story split chapter-07 --at "The ferry came at noon."')).toEqual(['double-quotes "The ferry came at noon."']);
    expect(strict("story split chapter-07 --at <marker> --title '<Title>'")).toEqual(["leaves <marker> unquoted"]);
    expect(strict("story names <name> 'Kelvos'")).toEqual(["leaves <name> unquoted"]);
    expect(strict("story init '{Title}' --follows <book-dir>")).toEqual(["leaves <book-dir> unquoted"]);
    expect(strict("story compare . --ref panel-round-{N} --anchor=<label>")).toEqual(["leaves <label> unquoted"]);
    expect(strict("node <skills>/story-maintenance/scripts/story.js add character {Name}")).toEqual(["leaves {Name} unquoted"]);
    expect(strict("story add character 'Mara O'\\''Neill' --role supporting")).toEqual([]);
    expect(strict("story add arc '{Name}' --type main --character {id} --theme {theme}")).toEqual(["leaves {theme} unquoted"]);
    expect(strict("story add arc '{Name}' --type main --character {id} --theme '{theme}' --themes '{a,b}'")).toEqual([]);
    expect(strict("story rename character {id} '{New Name}' --prose --dry-run")).toEqual([]);
    expect(strict("story snapshot --restore <name> --path . --dry-run")).toEqual([]);
    expect(strict('story "{a}" {id} "{b}"')).toEqual(['double-quotes "{a}"', 'double-quotes "{b}"']);
    expect(strict("story knowledge <id> --at <chapter>")).toEqual([]);
    expect(strict("story init --form <form> '{Title}'")).toEqual([]);
    expect(quotingProblems('--title "<Title>"', true, true)).toEqual(['double-quotes "<Title>"']);
    expect(quotingProblems("--path <project>", true, true)).toEqual([]);
    expect(storyCommands('`--at "..." is at the start of the chapter text` and `--source "<URL>"`').commands).toEqual([
      { line: 1, command: '--source "<URL>"', fragment: true }
    ]);
  });

  test("flags only double-quoted placeholders in docs/", () => {
    const lenient = (command) => quotingProblems(command, false);
    expect(lenient('story rename <kind> <id> "<New Name>"')).toEqual(['double-quotes "<New Name>"']);
    expect(lenient('story add clue "..." --planted chapter-02')).toEqual(['double-quotes "..."']);
    expect(lenient('story add chapter "Title"')).toEqual(['double-quotes "Title"']);
    expect(lenient('story add chapter "The Drowned Man" --number 1')).toEqual([]);
    expect(lenient('story build "$STORY_DIR" --stamp "$(date -u +%Y-%m-%d) ${GITHUB_SHA::7}"')).toEqual([]);
    expect(lenient('story "a" {id} "b"')).toEqual([]);
  });

  const files = [
    ...markdownFiles(skillsDir).map((file) => ({ file, strict: true })),
    ...[...markdownFiles(docsDir), path.join(repoRoot, "README.md")].map((file) => ({ file, strict: false }))
  ];

  test("no story command under skills/, docs/, or the README quotes user text unsafely", () => {
    const problems = files.flatMap(({ file, strict }) => fileQuotingProblems(fs.readFileSync(file, "utf8"), strict).map((problem) => `${path.relative(repoRoot, file)} ${problem}`));
    expect(problems).toEqual([]);
  });

  test("every inline story command in each file is inside a code span the parser found", () => {
    // Guard against code-span pairing that silently drops a file's later
    // commands: each `story <command> in prose must start inside a span.
    let checked = 0;
    for (const { file } of files) {
      const { prose } = storyCommands(fs.readFileSync(file, "utf8"));
      const spans = codeSpans(prose);
      for (const match of prose.matchAll(/`(?:\$ )?story [a-z]/g)) {
        checked += 1;
        expect(spans.some((span) => span.start <= match.index && match.index < span.end), `${path.relative(repoRoot, file)} line ${prose.slice(0, match.index).split("\n").length}`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

// Each trigger phrase belongs to one skill. A description's trigger phrases
// are the quoted phrases before its first "NOT for", in any case; a quote
// after it names a request the skill sends elsewhere (theme-craft's
// "character arc").

const descriptions = Object.fromEntries(skills.map((name) => {
  const file = path.join(skillsDir, name, "SKILL.md");
  return [name, parseFrontmatter(fs.readFileSync(file, "utf8"), file).data.description];
}));
const NOT_FOR = /\bnot for\b/i;
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const triggerPhrases = (text) => [...text.split(NOT_FOR)[0].matchAll(/"([^"]+)"/g)].map(([, phrase]) => phrase.trim().toLowerCase());
const redirects = (description) => description.split(NOT_FOR).slice(1).join(" ");
// A skill name as a whole word, so "self-publishing" does not name publishing.
const namesSkill = (text, name) => new RegExp(`(?<![\\w-])${escapeRegExp(name)}(?![\\w-])`).test(text);
// A phrase as whole words, ignoring case and reading hyphens as spaces, so
// "map" is not inside "roadmap" but "picture book" is inside "rhyming
// picture-book text". A plural ending counts: "clues" mentions "clue".
const plain = (text) => text.toLowerCase().replace(/-/g, " ");
const withinWords = (inner, outer) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(plain(inner))}(?:e?s)?(?![\\p{L}\\p{N}])`, "u").test(plain(outer));
// Whether a description's NOT clause sends `phrase` to `skill`: one of its
// parts, each ending at a "(use ...)" note, mentions the phrase and names
// the skill.
const sendsTo = (description, phrase, skill) => redirects(description).split(/(?<=\))/).some((part) => withinWords(phrase, part) && namesSkill(part, skill));

// The trigger problems in a { skill: description } map: a phrase two skills
// claim, and a phrase inside another skill's phrase ("pitch" in "pitch my
// series") when neither NOT clause sends that phrase to the other skill.
function triggerProblems(bySkill) {
  const claims = Object.entries(bySkill).flatMap(([skill, description]) => triggerPhrases(description).map((phrase) => ({ skill, phrase })));
  const problems = [];
  for (const a of claims) {
    for (const b of claims) {
      if (a.skill === b.skill) {
        continue;
      }
      if (a.phrase === b.phrase) {
        if (a.skill < b.skill) {
          problems.push(`"${a.phrase}" is claimed by ${a.skill} and ${b.skill}`);
        }
      } else if (withinWords(a.phrase, b.phrase) && !sendsTo(bySkill[a.skill], a.phrase, b.skill) && !sendsTo(bySkill[b.skill], a.phrase, a.skill)) {
        problems.push(`${a.skill} "${a.phrase}" is inside ${b.skill} "${b.phrase}", and neither NOT clause sends "${a.phrase}" to the other skill`);
      }
    }
  }
  return problems;
}

// Whether a skill file explains installing the review-copy workflow or the
// reader-note issue form: it names their files or the .github folders they
// go in, or names the templates/github folder beside a review copy.
const explainsReviewCopySetup = (text) =>
  /(?:review-copy|manuscript-note)\.yml|\.github\/(?:workflows|ISSUE_TEMPLATE)\//.test(text) ||
  (text.includes("templates/github") && /review[- ]cop(?:y|ies)/i.test(text));

describe("skill triggers", () => {
  test("matches skill names and phrases as whole words", () => {
    expect(namesSkill("NOT for self-publishing production.", "publishing")).toBe(false);
    expect(namesSkill("NOT for a publishing-house contract.", "publishing")).toBe(false);
    expect(namesSkill("NOT for rights deals (use publishing).", "publishing")).toBe(true);
    expect(withinWords("map", "roadmap")).toBe(false);
    expect(withinWords("query", "querying")).toBe(false);
    expect(withinWords("ink", "think in pink")).toBe(false);
    expect(withinWords("pitch", "pitch my series")).toBe(true);
    expect(withinWords("Picture Book", "writing rhyming picture-book text")).toBe(true);
    expect(withinWords("clue", "genre-craft for clues and fair play")).toBe(true);
  });

  test("detects a phrase two skills claim and an overlap no NOT clause sends on", () => {
    expect(triggerProblems({
      alpha: 'Use when the user asks to "pitch", "blurb". Not for a "series pitch" (use gamma).',
      beta: 'Use when the user asks to "Blurb", "pitch my series".',
      gamma: 'Use when the user asks to "series pitch", "pitch my book". NOT for one book (use alpha).',
      publishing: 'Use when the user asks about "rights". NOT for quoting lyrics (use editorial).',
      submission: 'Use when the user asks about "reprint rights". NOT for self-publishing production.',
      plot: 'Use when the user asks about "pacing". NOT for a chapter hook (use scene).',
      revision: 'Use when the user asks for a "pacing check". NOT for planning the structure (use plot).'
    })).toEqual([
      'alpha "pitch" is inside beta "pitch my series", and neither NOT clause sends "pitch" to the other skill',
      '"blurb" is claimed by alpha and beta',
      'publishing "rights" is inside submission "reprint rights", and neither NOT clause sends "rights" to the other skill',
      'plot "pacing" is inside revision "pacing check", and neither NOT clause sends "pacing" to the other skill'
    ]);
  });

  test("every skill description quotes its trigger phrases", () => {
    for (const name of skills) {
      expect(triggerPhrases(descriptions[name]).length, `${name} quotes no trigger phrases`).toBeGreaterThan(0);
    }
  });

  test("no two skills claim the same trigger phrase, and a NOT clause sends each overlapping phrase on", () => {
    expect(triggerProblems(descriptions)).toEqual([]);
  });

  test("each contested request has one owner, and its neighbours send it there", () => {
    const owners = {
      "interactive fiction": "interactive-fiction",
      "choose your own adventure": "interactive-fiction",
      "ink": "interactive-fiction",
      "twine": "interactive-fiction",
      "turn the book into ink or twine": "adaptation",
      "reverse outline": "revision-continuity",
      "cut a subplot": "revision-continuity",
      "review copy": "feedback-triage",
      "character voices": "voice-style",
      "make the voices distinct": "line-editing",
      "add a glossary term": "worldbuilding",
      "pitch my series": "series-continuity",
      "pitch": "submission",
      "retailer description": "submission"
    };
    for (const [phrase, owner] of Object.entries(owners)) {
      expect(skills.filter((name) => triggerPhrases(descriptions[name]).includes(phrase)), phrase).toEqual([owner]);
    }
    const sends = [
      ["adaptation", "choose your own adventure", "interactive-fiction"],
      ["interactive-fiction", "Ink", "adaptation"],
      ["discovery-drafting", "reverse outline", "revision-continuity"],
      ["discovery-drafting", "subplot", "revision-continuity"],
      ["character-management", "character voices", "voice-style"],
      ["character-management", "voices", "line-editing"],
      ["voice-style", "make the voices distinct", "line-editing"],
      ["line-editing", "character voices", "voice-style"],
      ["editorial-review", "review copies", "feedback-triage"],
      ["story-maintenance", "review copy", "feedback-triage"],
      ["worldbuilding", "glossary for translators", "adaptation"],
      ["series-continuity", "pitch", "submission"],
      ["submission", "pitching a series", "series-continuity"],
      ["publishing", "retailer description", "submission"]
    ];
    for (const [from, phrase, to] of sends) {
      expect(sendsTo(descriptions[from], phrase, to), `${from} has no NOT clause sending "${phrase}" to ${to}`).toBe(true);
    }
  });

  test("docs/skills.md lists each description's trigger phrases and NOT clause routes", () => {
    const catalogue = fs.readFileSync(path.join(repoRoot, "docs", "skills.md"), "utf8");
    for (const name of skills) {
      const section = catalogue.split(`\n### ${name}\n`)[1]?.split("\n### ")[0];
      expect(section, `docs/skills.md has no ${name} section`).toBeString();
      const triggers = section.match(/^\*\*Triggers\.\*\* (.*)$/m)?.[1] ?? "";
      expect(triggerPhrases(triggers), `docs/skills.md triggers for ${name}`).toEqual(triggerPhrases(descriptions[name]));
      const notFor = section.match(/^\*\*Not for\.\*\* (.*)$/m)?.[1] ?? "";
      for (const other of skills.filter((skill) => skill !== name && namesSkill(redirects(descriptions[name]), skill))) {
        expect(namesSkill(notFor, other), `docs/skills.md Not for line of ${name} does not name ${other}`).toBe(true);
      }
    }
  });

  test("only feedback-triage explains how to set up the GitHub review copy", () => {
    expect(explainsReviewCopySetup("the Story Skills repository's\n`templates/github/review-copy.yml` workflow rebuilds the HTML copy")).toBe(true);
    expect(explainsReviewCopySetup("copy the review copy workflow from `templates/github/`")).toBe(true);
    expect(explainsReviewCopySetup("copy it into `.github/workflows/`")).toBe(true);
    expect(explainsReviewCopySetup("The `feedback-triage` skill sets up the GitHub Pages workflow that publishes the review copy.")).toBe(false);
    expect(explainsReviewCopySetup("the `story-checks.yml` template from `templates/github/` runs the checks")).toBe(false);
    const explainers = markdownFiles(skillsDir)
      .filter((file) => explainsReviewCopySetup(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(skillsDir, file).split(path.sep).join("/"));
    expect(explainers).toEqual(["feedback-triage/SKILL.md"]);
  });

  test("the glossary steps list the term categories the CLI accepts", () => {
    for (const file of ["skills/worldbuilding/SKILL.md", "docs/skills.md"]) {
      const list = fs.readFileSync(path.join(repoRoot, file), "utf8").match(/story add term '\{Term\}' --category '\{([^}]+)\}'/)?.[1];
      expect(list, `${file} has no story add term step`).toBeString();
      expect(list.split("|"), file).toEqual([...TERM_CATEGORIES]);
    }
  });
});

// CLI detail lives in one skill file (#555, #528), so a CLI change has one
// place to update: the check rules in story-maintenance's
// continuity-checks.md, its command catalogue and import notes in its
// other references, and story-init's manual setup in a reference of its
// own. A phrase is found across line breaks, as a hard-wrapped skill
// writes it.

describe("CLI detail in one place", () => {
  const filesSaying = (phrase) => markdownFiles(skillsDir)
    .filter((file) => fs.readFileSync(file, "utf8").replace(/\s+/g, " ").includes(phrase))
    .map((file) => path.relative(skillsDir, file).split(path.sep).join("/"));

  test("only continuity-checks.md lists the voices attribution and story series rules", () => {
    for (const phrase of ["A name before the verb wins over a name after it", "Two books that share a `book-number`"]) {
      expect(filesSaying(phrase), phrase).toEqual(["story-maintenance/references/continuity-checks.md"]);
    }
  });

  // A phrase from each rule list a skill used to copy: voice-style's and
  // line-editing's voices attribution, premise-workshop's look-alike
  // thresholds, and series-continuity's story series checks.
  test("no SKILL.md copies the voices, names, or story series rules", () => {
    for (const phrase of ["A name before the verb wins over a name after it", "failing that, names exactly one character", "same first four letters", "Two books that share a `book-number`"]) {
      expect(filesSaying(phrase).filter((file) => file.endsWith("/SKILL.md")), phrase).toEqual([]);
    }
  });

  test("story-maintenance keeps its command catalogue and import notes in references", () => {
    expect(filesSaying("<!-- command-reference -->")).toEqual(["story-maintenance/references/commands.md"]);
    expect(filesSaying("Directory sources import in natural file-name order")).toEqual(["story-maintenance/references/editing-commands.md"]);
  });

  test("the command catalogue has an example of every command", () => {
    const catalogue = fs.readFileSync(path.join(skillsDir, "story-maintenance", "references", "commands.md"), "utf8");
    const examples = new Set([...catalogue.matchAll(/^story ([a-z-]+)/gm)].map(([, name]) => name));
    expect(COMMANDS.length).toBeGreaterThan(30);
    expect(COMMANDS.map(({ name }) => name).filter((name) => !examples.has(name))).toEqual([]);
  });

  test("story-init drafts the working premise after story init, which writes neither field", () => {
    expect(filesSaying("Populate each `_index.md` with an empty registry")).toEqual(["story-init/references/manual-setup.md"]);
    const text = fs.readFileSync(path.join(skillsDir, "story-init", "SKILL.md"), "utf8");
    const init = text.indexOf("story init '{Title}'");
    expect(init).toBeGreaterThan(-1);
    const premise = text.indexOf("Draft a working premise");
    expect(premise).toBeGreaterThan(init);
    expect(text.slice(premise).replace(/\s+/g, " ")).toContain("`story init` writes neither `premise` nor `counter-premise`");
    const cwd = makeTempDir("story-init-premise-");
    expect(runCli(["init", "Premise Probe", "--form", "novel", "--synopsis", "A probe."], memoryIo(cwd))).toBe(0);
    const { data } = parseFrontmatter(fs.readFileSync(path.join(cwd, "premise-probe", "story.md"), "utf8"), "story.md");
    expect(Object.keys(data)).not.toContain("premise");
    expect(Object.keys(data)).not.toContain("counter-premise");
  });

  test("submission owns the retailer description, and publishing drafts none of its own", () => {
    const read = (name) => fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8").replace(/\s+/g, " ");
    expect(read("submission")).toContain("This skill owns the retailer description: `submission/blurb.md` is its only draft");
    expect(read("publishing")).toContain("The retailer description has one draft, in `submission/blurb.md`, and the `submission` skill owns it");
    const publishingDir = path.join(skillsDir, "publishing");
    const publishingFiles = ["SKILL.md", ...fs.readdirSync(path.join(publishingDir, "references")).map((name) => path.join("references", name))];
    expect(publishingFiles.length).toBeGreaterThan(1);
    for (const file of publishingFiles) {
      expect(fs.readFileSync(path.join(publishingDir, file), "utf8").replace(/\s+/g, " "), file).not.toMatch(/long description|short description/i);
    }
  });
});

// The review skills' instructions match the CLI they run (#783, #786, #787,
// #793, #806, #807, #808). Each phrase is checked after the whitespace of a
// hard-wrapped line is collapsed, so a sentence is found across line breaks.
describe("review skill instructions match the CLI", () => {
  const read = (file) => fs.readFileSync(path.join(skillsDir, file), "utf8").replace(/\s+/g, " ");

  test("feedback-triage maps a blank reader answer to minor", () => {
    const text = read("feedback-triage/SKILL.md");
    expect(text).toContain("and a blank answer is `minor`. A `Typo or wording` note with a blank answer is a `nit` unless the reader says more.");
    expect(text).not.toContain("no answer is left blank");
  });

  test("reader-panel takes language only from the story context output", () => {
    const text = read("reader-panel/SKILL.md");
    expect(text).toContain("Take `language` only from the Language contract in that same `story context` output");
    expect(text).not.toContain("or from `story.md` frontmatter only");
  });

  test("reader-panel gives the line editor the style sheet and the prose findings", () => {
    expect(read("reader-panel/SKILL.md")).toContain("The line editor's subagent also gets `style-sheet.md` (when the project has one) and the `story prose .` findings for the chapters in range.");
    expect(read("reader-panel/references/line-editor.md")).toContain("Your inputs include `style-sheet.md` when there is one");
  });

  test("the sensitivity persona records the Canon check value that simulated reads use", () => {
    expect(read("reader-panel/references/sensitivity-reader.md")).toContain("Record the note's **Canon check** as `not checked (simulated read)`");
  });

  test("voice-style names the usage error that makes story prose exit 2", () => {
    expect(read("voice-style/SKILL.md")).toContain("or the command line is wrong, such as `--baseline` with no `samples` (exit 2)");
  });

  test("the compare reference names all three sources it accepts", () => {
    expect(read("story-maintenance/references/continuity-checks.md")).toContain("It needs exactly one of `--ref`, `--against`, or `--snapshot`.");
  });

  test("the query letter rounds the complete-at word count", () => {
    expect(read("submission/references/query-letter.md")).toContain("complete at {word count rounded to the nearest thousand}, that will appeal to readers of {Comp A} and {Comp B}.");
  });
});

// Registries are generated (#553): `story reindex` rebuilds every `_index.md`
// table from the entity files, and `story add`, `rename`, `move`, and
// `remove` reindex for you, so a row added by hand is thrown away. No skill
// may tell an agent to add or edit one.
//
// The check reads each sentence as clauses, split at `;`, `:`, a dash, or a
// comma that starts a new subject ("so", "which", "it", a `story` command).
// A clause edits a registry when, after an edit verb in any form ("add",
// "updates", "appending", "fill in", "record"), an item of what it edits
// names an `_index.md` file or a registry, or names a table or row while
// the clause before it or the sentence before it names an `_index.md` file.
// It is no edit when its subject is a `story` command or the CLI ("`story
// add` lists it in ..."), when a negation comes before the verb, or when
// the item is a hand-written section reindex keeps ("the Relationship Map
// section in `characters/_index.md`"). Items are split at "and", "or", and
// commas, and an item that starts with a negation or another verb ("leave",
// "never", "run", "rebuilds") ends what the verb edits. A past participle
// ("added") is an edit verb only in the passive ("a row is added"), so "the
// id recorded in every registry" describes rather than instructs. Only a
// registry's own tables count for the table rule ("the Factions table", "its
// rows"), not "the arc's Plot Points table".

const EDIT_VERB = /\b(?:updat(?:e[sd]?|ing)|edit(?:s|ed|ing)?|keep(?:s|ing)?|kept|maintain(?:s|ed|ing)?|add(?:s|ed|ing)?|append(?:s|ed|ing)?|insert(?:s|ed|ing)?|record(?:s|ed|ing)?|fill(?:s|ed|ing)?\s+in|writ(?:e|es|ing|ten)|wrote)\b/gi;
const PARTICIPLE = /^(?:updated|edited|kept|maintained|added|appended|inserted|recorded|filled\s+in|written)$/i;
const PASSIVE = /\b(?:is|are|was|were|be|been|being|get|gets|got|has|have|had)\s+(?:\w+ly\s+)?$/i;
const ITEM_STOP = /^(?:(?:then|so)\s+)?(?:leave|let|never|not|do not|don't|run|read|check|rebuild|rebuilds|regenerates?|reindex(?:es)?)\b/i;
const REGISTRY_TABLE = /\b(?:registry|locations|systems|factions|artifacts|arcs|chapters|scenes|questions|promises|clues|terms|matter|research|characters)\s+table\b|\b(?:the|its|their)\s+(?:table|rows?)\b/i;
// "add up" and "keep in mind" edit nothing.
const IDIOM = /^(?:add(?:s|ed|ing)?\s+up|keep(?:s|ing)?\s+in\s+mind)\b/i;
const NEGATION = /\b(?:do not|don't|never|not|leave|no one|nobody)\b/i;
const HAND_WRITTEN_SECTION = /relationship map|family trees|world overview|story structure|theme tracking/i;
const SPAN = /\u0001(\d+)\u0001/g;
const CLAUSE_BREAK = /\s*;\s*|:\s+|\s[-—–]\s|,\s+(?=(?:so|then|which|but|because|while|when|where|since|until|unless|it|they|reindex)\b|\u0001\d+\u0001)/i;
const ITEM_BREAK = /,\s*(?:and|or)\s+|,\s+|\s+(?:and|or)\s+/i;
const SUBJECT = /^(?:(?:and|or|so|then|but)\s+)?(?:it|they|which|reindex|the cli)\b/i;
const SUBJECT_BEFORE_VERB = /(?:^|\s)(?:it|they|which|reindex|the cli)\s*$/i;

// The sentences of a markdown text outside code blocks, each with the first
// line of its block. A blank line, heading, list item, or table row starts a
// new block, wrapped lines join with a space, and list markers are dropped.
function sentences(text) {
  const blocks = [];
  let fence = null;
  let block = null;
  text.split("\n").forEach((line, index) => {
    const open = line.match(FENCE);
    if (fence || open) {
      if (fence && line.trim().startsWith(fence)) {
        fence = null;
      } else if (!fence) {
        fence = open[1];
      }
      block = null;
      return;
    }
    if (line.trim() === "" || /^\s*(?:#|\||[-*+] |\d+\. )/.test(line) || block === null) {
      block = { line: index + 1, text: "" };
      blocks.push(block);
    }
    block.text += ` ${line.trim().replace(/^(?:[-*+]|\d+\.)\s+/, "")}`;
  });
  return blocks.flatMap((entry) => entry.text.trim().split(/(?<=[.!?])\s+(?=[A-Z*`])/).map((sentence) => ({ line: entry.line, sentence })));
}

// A sentence with each code span replaced by a numbered marker, so splitting
// and verb matching never look inside a span.
function maskSpans(sentence) {
  const spans = [];
  const text = sentence.replace(/`[^`]*`/g, (span) => `\u0001${spans.push(span.slice(1, -1)) - 1}\u0001`);
  return { text, spans };
}

function registryEditProblems(text) {
  const problems = [];
  let previousNamesIndex = false;
  for (const { line, sentence } of sentences(text)) {
    const { text: masked, spans } = maskSpans(sentence);
    const spanIn = (part) => [...part.matchAll(SPAN)].map(([, index]) => spans[Number(index)]);
    const namesIndex = (part) => spanIn(part).some((span) => /_index\.md/.test(span));
    const namesRegistry = (part) => namesIndex(part) || /\bregistr(?:y|ies)\b/i.test(part);
    const namesFile = (part) => spanIn(part).some((span) => /\.md\b|\//.test(span));
    const handWritten = (part) => HAND_WRITTEN_SECTION.test(part) || spanIn(part).some((span) => span === "structure" || HAND_WRITTEN_SECTION.test(span));
    let contextNamesIndex = previousNamesIndex;
    let flagged = false;
    for (const clause of masked.split(CLAUSE_BREAK)) {
      const verbs = [...clause.matchAll(EDIT_VERB)].filter((verb) => {
        const after = clause.slice(verb.index);
        // A verb naming an option (`add --region`) edits nothing.
        const next = after.slice(verb[0].length).match(/^\s*\u0001(\d+)\u0001/);
        const passive = !PARTICIPLE.test(verb[0]) || PASSIVE.test(clause.slice(0, verb.index));
        return passive && !IDIOM.test(after) && !(next && spans[Number(next[1])].startsWith("--"));
      });
      const verb = verbs[0];
      const before = verb ? clause.slice(0, verb.index) : "";
      const subject = before.replace(SPAN, (marker, index) => (spans[Number(index)].startsWith("story ") ? " it " : marker));
      if (verb && !NEGATION.test(before) && !SUBJECT.test(subject.trim()) && !SUBJECT_BEFORE_VERB.test(subject)) {
        for (const item of clause.slice(verb.index + verb[0].length).split(ITEM_BREAK)) {
          if (ITEM_STOP.test(item.trim())) {
            break;
          }
          if (handWritten(item)) {
            continue;
          }
          if (namesRegistry(item) || (contextNamesIndex && REGISTRY_TABLE.test(item) && !namesFile(item))) {
            flagged = true;
          }
        }
      }
      contextNamesIndex ||= namesIndex(clause);
    }
    if (flagged) {
      problems.push(`line ${line}: ${sentence}`);
    }
    previousNamesIndex = namesIndex(masked);
  }
  return problems;
}

describe("generated registries", () => {
  test("flags an instruction to edit a registry table", () => {
    const flagged = (text) => registryEditProblems(text).length;
    for (const text of [
      "7. Update `characters/_index.md` registry table",
      "8. Without the CLI, update the `worldbuilding/_index.md` locations table",
      "Otherwise create the file, and add a row to the Registry table in `glossary/_index.md`",
      "If no CLI is\navailable, keep `research/_index.md` and the `used-in` lists current by\nhand.",
      "- **Update:** `plot/timeline.md`, arc plot-point tables, and\n  `chapters/_index.md` when chapters move, merge, or split.",
      "Apply the diff: update bible files, registries, `continuity/state.md`, and the scene records.",
      "Add `{character-id}` to `characters/_index.md`.",
      "Update `characters/_index.md`; never skip the status column.",
      "Update the arcs table in `plot/_index.md` and the Story Structure section.",
      "Update the Theme Tracking section and the arcs table in `plot/_index.md`.",
      "Append a row to `characters/_index.md`.",
      "Record the arc in `plot/_index.md`.",
      "Fill in the `glossary/_index.md` table.",
      "The agent adds a row to `characters/_index.md`.",
      "A row is added to `characters/_index.md` by hand.",
      "The agent updates `characters/_index.md` after each character.",
      "Finish by updating `characters/_index.md`.",
      "Each pass edits the rows in `chapters/_index.md`.",
      "The skill keeps `research/_index.md` current by hand.",
      "Open `worldbuilding/_index.md`. Add the faction to the Factions table.",
      "Open `worldbuilding/_index.md`; add the faction to the Factions table."
    ]) {
      expect(flagged(text), text).toBe(1);
    }
    for (const text of [
      "2. Read `characters/_index.md` for existing characters",
      "- Update the Relationship Map section in `characters/_index.md`",
      "4. Update `plot/_index.md` frontmatter `structure` field",
      "Leave the `characters/_index.md` table to the CLI: `story add` and `story reindex .` rebuild it.",
      "Scaffold it with `story add arc 'A'`, which lists the arc in `plot/_index.md`, then fill in the sections.",
      "Create it with `story add location 'L'` (add `--region` as known); it lists it in `worldbuilding/_index.md`.",
      "Add up the chapters' counts and compare the arc's share with its weight in `plot/_index.md`.",
      "Do not add or edit rows in `chapters/_index.md` by hand.",
      "When you add a character, `story add` lists it in `characters/_index.md`.",
      "Keep in mind that `story reindex .` rebuilds `characters/_index.md`.",
      "`story add` adds the row to `characters/_index.md` for you.",
      "Use `story add term 'T'`; it writes `glossary/terms/t.md` and updates `glossary/_index.md`.",
      "Keep the frontmatter fields current by hand, and leave the `research/_index.md` and `matter/_index.md` tables to the next `story reindex .`.",
      "Read `plot/_index.md`. Add the plot point to the arc's Plot Points table in `plot/arcs/a.md`.",
      "Set `structure` in `plot/_index.md`. Record the disasters as the first rows of the arc's Plot Points table.",
      "The story id recorded in every registry is the kebab-case form of the title.",
      "After editing `title`, run `story reindex .` to rewrite the id in every registry.",
      "Records each setup in its record, and rebuilds registries with `story reindex`.",
      "```markdown\nUpdate `characters/_index.md`\n```"
    ]) {
      expect(flagged(text), text).toBe(0);
    }
    expect(registryEditProblems("Intro.\n\n1. Read it.\n2. Update `plot/_index.md` arcs table")).toEqual(["line 4: Update `plot/_index.md` arcs table"]);
  });

  test("no skill tells an agent to edit a generated registry table", () => {
    const problems = markdownFiles(skillsDir).flatMap((file) => registryEditProblems(fs.readFileSync(file, "utf8")).map((problem) => `${path.relative(skillsDir, file)} ${problem}`));
    expect(problems).toEqual([]);
  });
});

// `story continuity` checks only `character` + `knowledge` state changes
// against `knowledge-state`, and `target` names an artifact (#553), so the
// scene template records character knowledge in the shape the CLI reads.
test("the scene template records character knowledge as character + knowledge", () => {
  const template = fs.readFileSync(path.join(skillsDir, "chapter-writing", "references", "scene-template.md"), "utf8");
  const block = template.match(/^state-changes:\n((?: {2}.*\n)+)/m)?.[1];
  expect(block).toBeString();
  const entries = block.split(/^ {2}- /m).filter((entry) => entry.trim()).map((entry) =>
    Object.fromEntries(entry.split("\n").filter((line) => line.trim()).map((line) => {
      const [key, ...value] = line.trim().split(":");
      return [key, value.join(":").trim()];
    })));
  expect(entries.some((entry) => "character" in entry && "knowledge" in entry)).toBe(true);
  for (const entry of entries) {
    // Knowledge belongs to a character entry, and `target` to an artifact.
    if ("knowledge" in entry) {
      expect(Object.keys(entry), JSON.stringify(entry)).toContain("character");
      expect(Object.keys(entry), JSON.stringify(entry)).not.toContain("target");
    }
    if ("target" in entry) {
      expect(entry.target).not.toContain("character");
      expect(Object.keys(entry)).not.toContain("character");
    }
  }
});

// Skills name each other's reference files in inline code
// (`scene-craft/references/try-fail.md`), which check:links skips, so a
// renamed or mistyped reference would go unnoticed. And each skill's
// reference files are listed in its SKILL.md and in the skills catalogue, so
// a new reference, such as a genre-craft pack, is not left out of either.

const REFERENCE_PATH = /`((?:\.\.\/)*([a-z0-9-]+)\/references\/([A-Za-z0-9._-]+\.md))`/g;

// The text with every fenced block blanked, so only prose is scanned.
function outsideFences(text) {
  let fence = null;
  return text.split("\n").map((line) => {
    if (fence) {
      if (line.trim().startsWith(fence)) {
        fence = null;
      }
      return "";
    }
    const open = line.match(FENCE);
    if (open) {
      fence = open[1];
      return "";
    }
    return line;
  }).join("\n");
}

// Each inline-code `<skill>/references/<file>.md` path in prose that names
// no file under skills/.
function referencePathProblems(text) {
  return [...outsideFences(text).matchAll(REFERENCE_PATH)]
    .filter(([, , skill, file]) => !fs.existsSync(path.join(skillsDir, skill, "references", file)))
    .map(([, code]) => code);
}

describe("skill references", () => {
  test("detects an inline reference path that names no file", () => {
    expect(referencePathProblems("see `scene-craft/references/try-fail.md` and `../line-editing/references/read-aloud-guide.md`")).toEqual([]);
    expect(referencePathProblems("see `scene-craft/references/no-such.md` or `../nowhere/references/a.md`")).toEqual([
      "scene-craft/references/no-such.md",
      "../nowhere/references/a.md"
    ]);
    expect(referencePathProblems("```text\n`scene-craft/references/no-such.md`\n```")).toEqual([]);
  });

  test("every inline reference path under skills/ names a file", () => {
    let paths = 0;
    const problems = markdownFiles(skillsDir).flatMap((file) => {
      const text = fs.readFileSync(file, "utf8");
      paths += [...outsideFences(text).matchAll(REFERENCE_PATH)].length;
      return referencePathProblems(text).map((problem) => `${path.relative(skillsDir, file)}: ${problem}`);
    });
    // Guard against a matcher that silently stops finding paths.
    expect(paths).toBeGreaterThan(50);
    expect(problems).toEqual([]);
  });

  test("every reference file is listed in its SKILL.md and in docs/skills.md", () => {
    const catalogue = fs.readFileSync(path.join(repoRoot, "docs", "skills.md"), "utf8");
    const missing = [];
    for (const name of skills) {
      const dir = path.join(skillsDir, name, "references");
      if (!fs.existsSync(dir)) {
        continue;
      }
      const skill = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
      for (const file of fs.readdirSync(dir).filter((entry) => entry.endsWith(".md")).sort()) {
        if (!skill.includes(`\`references/${file}\``) && !skill.includes(`](references/${file})`)) {
          missing.push(`skills/${name}/SKILL.md does not list references/${file}`);
        }
        if (!catalogue.includes(`](../skills/${name}/references/${file})`)) {
          missing.push(`docs/skills.md does not list skills/${name}/references/${file}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
