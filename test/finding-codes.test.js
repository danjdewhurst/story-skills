import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { severityCodes } from "../src/config.js";
import { CHAPTER_CODES, CONTINUITY_ERROR_CODES, FINDING_CODES, codesAt, err, exemptionCodes, warn } from "../src/findings.js";

const repoRoot = path.join(import.meta.dir, "..");
const srcDir = path.join(repoRoot, "src");

// The first argument of a call, up to the comma that ends it.
function firstArgument(text, index) {
  let depth = 0;
  let quote = null;
  let argument = "";
  for (; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== null) {
      argument += char;
      if (char === quote && text[index - 1] !== "\\") {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
    } else if ("([{".includes(char)) {
      depth += 1;
    } else if (")]}".includes(char)) {
      if (depth === 0) {
        break;
      }
      depth -= 1;
    } else if (char === "," && depth === 0) {
      break;
    }
    argument += char;
  }
  return argument;
}

// The arguments of a call, each up to the comma that ends it.
function callArguments(text, index) {
  const args = [];
  for (;;) {
    const argument = firstArgument(text, index);
    args.push(argument);
    index += argument.length;
    if (text[index] !== ",") {
      return args;
    }
    index += 1;
  }
}

// Every err("code", ...) and warn("code", ...) call in src, as
// { file, level, codes, argument, chapter }, where chapter says whether the
// call passes a chapter. A code chosen by a condition (`passed ? "a" : "b"`)
// lists both.
function raisedInSource() {
  const calls = [];
  for (const name of fs.readdirSync(srcDir).filter((file) => file.endsWith(".js") && file !== "findings.js")) {
    const text = fs.readFileSync(path.join(srcDir, name), "utf8");
    for (const match of text.matchAll(/\b(err|warn)\(/g)) {
      const args = callArguments(text, match.index + match[0].length);
      const argument = args[0];
      calls.push({
        file: name,
        level: match[1] === "err" ? "error" : "warning",
        codes: [...argument.matchAll(/"([^"]*)"/g)].map((literal) => literal[1]),
        argument: argument.trim(),
        chapter: args.length > 3
      });
    }
  }
  return calls;
}

// The code tables under "## Finding codes" in docs/cli-reference.md, as
// [code, level] rows.
function documentedCodes() {
  const text = fs.readFileSync(path.join(repoRoot, "docs", "cli-reference.md"), "utf8");
  const start = text.indexOf("\n## Finding codes\n");
  const section = text.slice(start, text.indexOf("\n## ", start + 1));
  return [...section.matchAll(/^\| `([^`]+)` \| (\w+) \|/gm)].map((row) => [row[1], row[2]]);
}

describe("finding codes", () => {
  test("err and warn build a finding with its code, message, and file", () => {
    expect(err("stale-registry", "a.md broke", "a.md")).toEqual({ code: "stale-registry", message: "a.md broke", file: "a.md", chapter: null });
    expect(warn("todo-markers", "no file")).toEqual({ code: "todo-markers", message: "no file", file: null, chapter: null });
    expect(warn("clock-backward", "late", "a.md", "chapter-02")).toEqual({ code: "clock-backward", message: "late", file: "a.md", chapter: "chapter-02" });
  });

  test("every code is kebab-case and has a level", () => {
    for (const [code, level] of Object.entries(FINDING_CODES)) {
      expect(code).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(["error", "warning"]).toContain(level);
    }
    expect([...codesAt("error"), ...codesAt("warning")].sort()).toEqual(Object.keys(FINDING_CODES).sort());
  });

  test("every finding in src names a listed code as a string literal, at the level it is listed", () => {
    const calls = raisedInSource();
    expect(calls.length).toBeGreaterThan(200);
    for (const call of calls) {
      expect({ ...call, codes: call.codes.length > 0 }).toMatchObject({ codes: true });
      for (const code of call.codes) {
        expect({ file: call.file, code, level: FINDING_CODES[code] }).toEqual({ file: call.file, code, level: call.level });
      }
    }
  });

  test("every listed code is raised somewhere in src", () => {
    const raised = new Set(raisedInSource().flatMap((call) => call.codes));
    expect(Object.keys(FINDING_CODES).filter((code) => !raised.has(code))).toEqual([]);
  });

  test("docs/cli-reference.md documents every code at its level, and no other", () => {
    const rows = documentedCodes();
    expect(rows.filter(([code, level]) => FINDING_CODES[code] !== level)).toEqual([]);
    const documented = new Set(rows.map(([code]) => code));
    expect(Object.keys(FINDING_CODES).filter((code) => !documented.has(code))).toEqual([]);
    // Each table documents a code once.
    const perTable = fs.readFileSync(path.join(repoRoot, "docs", "cli-reference.md"), "utf8").split("\n### Codes: ").slice(1);
    for (const table of perTable) {
      const codes = [...table.matchAll(/^\| `([^`]+)` \|/gm)].map((row) => row[1]);
      expect(codes.length).toBe(new Set(codes).size);
    }
  });

  test("the schemas list the codes", () => {
    const result = JSON.parse(fs.readFileSync(path.join(repoRoot, "schemas", "result.schema.json"), "utf8"));
    expect(result.$defs.diagnostic.properties.code.enum).toEqual(Object.keys(FINDING_CODES));
    const story = JSON.parse(fs.readFileSync(path.join(repoRoot, "schemas", "story.schema.json"), "utf8"));
    expect(story.properties.story.properties.severity.items.properties.warning.enum).toEqual(severityCodes());
    expect(story.$defs.exemption.properties.code.enum).toEqual(exemptionCodes());
  });

  test("CONTINUITY_ERROR_CODES lists the errors story continuity raises, and not its scan's unreadable-file", () => {
    const raised = raisedInSource().filter((call) => call.file === "continuity.js" && call.level === "error").flatMap((call) => call.codes);
    expect([...CONTINUITY_ERROR_CODES].sort()).toEqual([...new Set(raised)].sort());
    expect(CONTINUITY_ERROR_CODES).not.toContain("unreadable-file");
  });

  test("CHAPTER_CODES lists the codes whose every finding carries a chapter, as docs/continuity.md does", () => {
    const calls = raisedInSource().filter((call) => call.codes.length > 0);
    const withChapter = new Set(calls.filter((call) => call.chapter).flatMap((call) => call.codes));
    const without = new Set(calls.filter((call) => !call.chapter).flatMap((call) => call.codes));
    expect([...withChapter].filter((code) => without.has(code))).toEqual([]);
    expect([...CHAPTER_CODES].sort()).toEqual([...withChapter].sort());
    const text = fs.readFileSync(path.join(repoRoot, "docs", "continuity.md"), "utf8");
    const start = text.indexOf("These findings carry a chapter:");
    const listed = [...text.slice(start, text.indexOf("\n\n", start)).matchAll(/`([a-z0-9-]+)`/g)].map((match) => match[1]);
    expect(listed.sort()).toEqual([...CHAPTER_CODES].sort());
  });
});
