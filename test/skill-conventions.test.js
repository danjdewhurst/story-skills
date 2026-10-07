import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "../src/frontmatter.js";
import { takesValue } from "../src/options.js";
import { TERM_CATEGORIES } from "../src/scan.js";

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
const TEXT_OPTIONS = new Set(["--title", "--synopsis", "--dilemma", "--anchor", "--source", "--genre", "--sub-genre", "--setting-era", "--date", "--follows", "--precedes", "--against", "--path", "--dir"]);
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
    expect(strict("story add arc '{Name}' --type main --character {id} --theme {theme}")).toEqual([]);
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
      "pitch": "submission"
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
      ["submission", "pitching a series", "series-continuity"]
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

// Registries are generated (#553): `story reindex` rebuilds every `_index.md`
// table from the entity files, and `story add`, `rename`, `move`, and
// `remove` reindex for you, so a row added by hand is thrown away. No skill
// may tell an agent to add or edit one. A sentence that names an `_index.md`
// file and gives an edit instruction outside its code spans is one, unless
// it says not to, or it is about a hand-written section reindex keeps.

// "add" before an option (`add --region`) or "add up" is no edit.
const EDIT_VERB = /\b(?:update|edit|keep|maintain|add(?! up\b)(?!\s+`))\b/i;
const NOT_AN_EDIT = /\b(?:do not|don't|never|leave)\b/i;
const HAND_WRITTEN_SECTION = /relationship map|family trees|world overview|story structure|theme tracking|`structure`/i;

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

function registryEditProblems(text) {
  return sentences(text)
    .filter(({ sentence }) => /_index\.md/.test(sentence))
    .filter(({ sentence }) => {
      const prose = sentence.replace(/`[^`]*`/g, (span) => (HAND_WRITTEN_SECTION.test(span) ? span : "`…`"));
      return EDIT_VERB.test(prose) && !NOT_AN_EDIT.test(prose) && !HAND_WRITTEN_SECTION.test(prose);
    })
    .map(({ line, sentence }) => `line ${line}: ${sentence}`);
}

describe("generated registries", () => {
  test("flags an instruction to edit a registry table", () => {
    const flagged = (text) => registryEditProblems(text).length;
    for (const text of [
      "7. Update `characters/_index.md` registry table",
      "8. Without the CLI, update the `worldbuilding/_index.md` locations table",
      "Otherwise create the file, and add a row to the Registry table in `glossary/_index.md`",
      "If no CLI is\navailable, keep `research/_index.md` and the `used-in` lists current by\nhand.",
      "- **Update:** `plot/timeline.md`, arc plot-point tables, and\n  `chapters/_index.md` when chapters move, merge, or split."
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
  for (const entry of entries.filter((candidate) => "target" in candidate)) {
    expect(entry.target).not.toContain("character");
  }
});
