import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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
