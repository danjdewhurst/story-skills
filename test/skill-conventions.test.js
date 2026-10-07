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

// When `story` is not installed, every skill gives the same fallback: run
// bin/story.js from a Story Skills checkout, or the bundled
// story-maintenance/scripts/story.js, by absolute path from the folder the
// agent would run `story` from. A package script such as `bun run story` is
// never the fallback: Bun runs it from the checkout's root, so the `.` that
// every skill's commands pass would name the checkout, not the story.

const repoRoot = path.join(import.meta.dir, "..");
const FALLBACK_LEAD = "If `story` is not installed,";
const FALLBACK = `${FALLBACK_LEAD} use \`node <checkout>/bin/story.js\` (or \`bun <checkout>/bin/story.js\`), where \`<checkout>\` is the path to a Story Skills repository checkout, or the bundled fallback \`node ../story-maintenance/scripts/story.js\`, with the same arguments. Write the script as an absolute path (resolve the fallback relative to this skill folder) and run the command from the folder you would run \`story\` from, so \`.\` and other relative paths keep their meaning.`;
const PACKAGE_SCRIPT = /\b(?:bun|npm|pnpm|yarn) run story\b/;

function markdownFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return markdownFiles(full);
    }
    return entry.name.endsWith(".md") ? [full] : [];
  }).sort();
}

// The line numbers of a markdown text that run the CLI as a package script.
function packageScriptLines(text) {
  return text.split("\n").flatMap((line, index) => (PACKAGE_SCRIPT.test(line) ? [index + 1] : []));
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
  test("detects package-script runs and a reworded fallback", () => {
    expect(packageScriptLines("use `bun run story --` from the checkout")).toEqual([1]);
    expect(packageScriptLines("intro\n```shell\nnpm run story -- validate .\n```")).toEqual([3]);
    expect(packageScriptLines("run `node <checkout>/bin/story.js`, not the `story` package script")).toEqual([]);
    expect(fallbackProblems(`Use the Story CLI. ${FALLBACK} If no CLI is available, check by hand.`)).toEqual([]);
    expect(fallbackProblems(FALLBACK.replace(/ (?=with|absolute|story)/g, "\n"))).toEqual([]);
    expect(fallbackProblems(`${FALLBACK}\n\n${FALLBACK_LEAD} use \`bun run story --\` with the same arguments.`)).toEqual([
      `${FALLBACK_LEAD} use \`bun run story --\` with the same arguments.`
    ]);
  });

  test("no markdown file under skills/ runs the CLI through `bun run story`", () => {
    const problems = markdownFiles(skillsDir).flatMap((file) => packageScriptLines(fs.readFileSync(file, "utf8")).map((line) => `${path.relative(skillsDir, file)}:${line}`));
    expect(problems).toEqual([]);
  });

  test("every skill that names the bundled CLI gives the same fallback sentence", () => {
    let named = 0;
    for (const name of skills.filter((skill) => skill !== "story-maintenance")) {
      const text = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
      if (!text.includes("../story-maintenance/scripts/story.js")) {
        continue;
      }
      named += 1;
      expect(fallbackProblems(text), `${name} words the CLI fallback differently`).toEqual([]);
      expect(text.replace(/\s+/g, " ").includes(FALLBACK), `${name} has no CLI fallback sentence`).toBe(true);
    }
    // Guard against a matcher that silently stops finding skills.
    expect(named).toBeGreaterThan(20);
    const maintenance = fs.readFileSync(path.join(skillsDir, "story-maintenance", "SKILL.md"), "utf8");
    expect(maintenance).toContain("`node <checkout>/bin/story.js <command>`");
    expect(maintenance).toContain("as an absolute path and run the command from the folder you would run `story` from");
  });

  test("the fallback forms run in the story project folder", () => {
    const project = path.join(repoRoot, "examples", "harbor-of-second-light");
    const forms = [[process.execPath, path.join(repoRoot, "bin", "story.js")]];
    // process.execPath is Bun under `bun test`; the Node forms need node on PATH.
    if (spawnSync("node", ["--version"], { encoding: "utf8" }).status === 0) {
      forms.push(["node", path.join(repoRoot, "bin", "story.js")], ["node", path.join(skillsDir, "story-maintenance", "scripts", "story.js")]);
    }
    for (const [runtime, script] of forms) {
      const result = spawnSync(runtime, [script, "validate", "."], { cwd: project, encoding: "utf8" });
      expect(result.stderr, `${runtime} ${script}`).toContain("Project is valid");
      expect(result.status).toBe(0);
    }
  });
});
