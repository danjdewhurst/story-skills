import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { COMMANDS } from "../src/commands.js";
import { EXIT_CODES, exitCodeFor, projectError, refusedError, usageError, withDefaultExitCode, withExitCode } from "../src/exit-codes.js";
import { LOCK_FILE } from "../src/lock.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

const { ok, findings, usage, project, refused } = EXIT_CODES;
const isRoot = process.getuid?.() === 0;

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

// A small valid project: one chapter, one character.
function newProject() {
  const cwd = makeTempDir();
  expect(invoke(cwd, ["init", "Exit Codes", "--dir", "book"]).code).toBe(ok);
  const root = path.join(cwd, "book");
  expect(invoke(root, ["add", "chapter", "One"]).code).toBe(ok);
  expect(invoke(root, ["add", "character", "Mara Quill"]).code).toBe(ok);
  return root;
}

// A chapter whose frontmatter fails to parse is an error finding.
function breakChapter(root) {
  fs.writeFileSync(path.join(root, "chapters", "chapter-01.md"), "---\ntitle: One\ntitle: Again\n---\nText.\n", "utf8");
}

// The arguments that make each command succeed in a project made by
// newProject(), run from its root.
const OK_ARGS = {
  init: (cwd) => ["init", "Fresh", "--dir", path.join(cwd, "..", "fresh")],
  import: (cwd) => {
    const draft = path.join(cwd, "..", "draft.md");
    fs.writeFileSync(draft, "# Chapter 1\n\nThe tide came in.\n", "utf8");
    return ["import", draft, "--title", "Imported", "--dir", path.join(cwd, "..", "imported")];
  },
  validate: () => ["validate"],
  reindex: () => ["reindex"],
  wordcount: () => ["wordcount", "--write"],
  links: () => ["links"],
  continuity: () => ["continuity"],
  knowledge: () => ["knowledge", "mara-quill", "--at", "chapter-01"],
  compare: () => ["compare", "--against", "."],
  progress: () => ["progress"],
  timeline: () => ["timeline"],
  prose: () => ["prose"],
  diagram: () => ["diagram", "relationships"],
  names: () => ["names", "Tobin"],
  pacing: () => ["pacing"],
  clues: () => ["clues"],
  voices: () => ["voices"],
  series: () => ["series"],
  passes: () => ["passes", "--init"],
  report: () => ["report"],
  next: () => ["next"],
  doctor: () => ["doctor"],
  migrate: () => ["migrate"],
  add: () => ["add", "character", "Tobin Reed"],
  rename: () => ["rename", "character", "mara-quill", "Mara Vell"],
  remove: () => ["remove", "character", "mara-quill"],
  move: () => ["move", "chapter", "chapter-01", "--number", "2"],
  export: () => ["export"],
  build: () => ["build"],
  synopsis: () => ["synopsis"]
};

// Commands whose report counts error findings: a chapter that fails to
// parse (or, for names, a clashing name) exits 1.
const FINDINGS_ARGS = {
  validate: ["validate"],
  links: ["links"],
  continuity: ["continuity"],
  compare: ["compare", "--against", "../clean"],
  progress: ["progress"],
  timeline: ["timeline"],
  prose: ["prose"],
  diagram: ["diagram", "arcs"],
  names: ["names", "Mara Quill"],
  pacing: ["pacing"],
  clues: ["clues"],
  voices: ["voices"],
  series: ["series"]
};

// A write each command refuses, with the project left as it was.
const REFUSED = {
  init: (root) => ["init", "Exit Codes", "--dir", root],
  import: (root) => {
    const draft = path.join(root, "..", "draft.md");
    fs.writeFileSync(draft, "# Chapter 1\n\nText.\n", "utf8");
    return ["import", draft, "--title", "Imported", "--dir", root];
  },
  add: () => ["add", "character", "Mara Quill"],
  rename: (root) => {
    invoke(root, ["add", "character", "Tobin Reed"]);
    return ["rename", "character", "tobin-reed", "Mara Quill"];
  },
  move: (root) => {
    invoke(root, ["add", "chapter", "Two"]);
    return ["move", "chapter", "chapter-01", "--number", "2"];
  },
  export: () => ["export", "--out", "chapters/chapter-01.md"],
  build: () => ["build", "--out", "story.md"],
  synopsis: () => ["synopsis", "--out", "story.md"],
  diagram: () => ["diagram", "arcs", "--out", "characters/mara-quill.md"]
};

// Commands that change project files hold the project lock, so a held lock
// refuses them.
const LOCKED = {
  reindex: ["reindex"],
  wordcount: ["wordcount", "--write"],
  migrate: ["migrate"],
  remove: ["remove", "character", "mara-quill"]
};

const savedLockWait = process.env.STORY_LOCK_WAIT_MS;
afterEach(() => {
  if (savedLockWait === undefined) {
    delete process.env.STORY_LOCK_WAIT_MS;
  } else {
    process.env.STORY_LOCK_WAIT_MS = savedLockWait;
  }
});

describe("exit codes", () => {
  test("the codes are stable", () => {
    expect(EXIT_CODES).toEqual({ ok: 0, findings: 1, usage: 2, project: 3, refused: 4 });
    expect(Object.isFrozen(EXIT_CODES)).toBe(true);
  });

  test("every command is covered by the contract tables", () => {
    const names = COMMANDS.map((command) => command.name).sort();
    expect(Object.keys(OK_ARGS).sort()).toEqual(names);
    for (const name of [...Object.keys(FINDINGS_ARGS), ...Object.keys(REFUSED), ...Object.keys(LOCKED)]) {
      expect(names).toContain(name);
    }
  });

  for (const command of COMMANDS) {
    test(`${command.name} exits 0 on success`, () => {
      const root = newProject();
      const result = invoke(root, OK_ARGS[command.name](root));
      expect(result.err).not.toContain("error:");
      expect(result.code).toBe(ok);
    });

    test(`${command.name} exits 2 on a usage error`, () => {
      const root = newProject();
      expect(invoke(root, [command.name, "--no-such-flag"]).code).toBe(usage);
      expect(invoke(root, [command.name, "--path"]).code).toBe(usage);
      expect(invoke(root, ["help", `${command.name}x`]).code).toBe(usage);
    });

    if (command.project !== "none") {
      test(`${command.name} exits 3 outside a story project`, () => {
        const empty = makeTempDir();
        const args = OK_ARGS[command.name](empty);
        const result = invoke(empty, [...args, "--path", empty]);
        expect(result.err).toContain("is not a story project: missing story.md");
        expect(result.code).toBe(project);
      });
    }
  }

  for (const [name, args] of Object.entries(FINDINGS_ARGS)) {
    test(`${name} exits 1 on findings`, () => {
      const root = newProject();
      fs.cpSync(root, path.join(root, "..", "clean"), { recursive: true });
      if (name === "compare") {
        // compare refuses a broken chapter outright; a broken progress log
        // is reported as a finding.
        fs.writeFileSync(path.join(root, "progress.md"), "---\na: 1\na: 2\n---\n", "utf8");
      } else if (name !== "names") {
        breakChapter(root);
      }
      const result = invoke(root, args);
      expect(result.err).toContain("error:");
      expect(result.code).toBe(findings);
    });
  }

  for (const [name, args] of Object.entries(REFUSED)) {
    test(`${name} exits 4 on a refused write`, () => {
      const root = newProject();
      const argv = args(root);
      const story = fs.readFileSync(path.join(root, "story.md"), "utf8");
      const result = invoke(root, argv);
      expect(result.code).toBe(refused);
      expect(fs.readFileSync(path.join(root, "story.md"), "utf8")).toBe(story);
    });
  }

  for (const [name, args] of Object.entries(LOCKED)) {
    test(`${name} exits 4 while another command holds the lock`, () => {
      const root = newProject();
      fs.writeFileSync(path.join(root, LOCK_FILE), `${process.pid}\nhost\n`);
      process.env.STORY_LOCK_WAIT_MS = "0";
      const result = invoke(root, args);
      expect(result.err).toContain("is modifying this project");
      expect(result.code).toBe(refused);
    });
  }

  test.skipIf(isRoot)("a write the file system refuses exits 4", () => {
    const root = newProject();
    const story = path.join(root, "story.md");
    fs.chmodSync(story, 0o444);
    try {
      const result = invoke(root, ["passes", "--init"]);
      expect(result.err).toContain("permission denied");
      expect(result.code).toBe(refused);
    } finally {
      fs.chmodSync(story, 0o644);
    }
  });

  test.skipIf(isRoot)("a folder migrate cannot create exits 4", () => {
    const root = newProject();
    const parent = path.join(root, "worldbuilding");
    fs.rmSync(path.join(parent, "factions"), { recursive: true, force: true });
    fs.chmodSync(parent, 0o555);
    try {
      const result = invoke(root, ["migrate"]);
      expect(result.err).toContain("permission denied");
      expect(result.code).toBe(refused);
    } finally {
      fs.chmodSync(parent, 0o755);
    }
  });

  test("a project that cannot be built or updated exits 3", () => {
    const root = newProject();
    breakChapter(root);
    for (const args of [["reindex"], ["export"], ["build"], ["add", "character", "Tobin"], ["wordcount", "--write"]]) {
      const result = invoke(root, args);
      expect(result.err).toContain("chapters/chapter-01.md");
      expect(result.code).toBe(project);
    }
    writeMarkdown(path.join(root, "story.md"), "title: Newer\nschema-version: 99");
    expect(invoke(root, ["migrate"]).code).toBe(project);
  });

  test("a bad value or an unknown id is a usage error", () => {
    const root = newProject();
    for (const args of [
      ["build", "--format", "pdf"],
      ["diagram", "weather"],
      ["knowledge", "nobody", "--at", "chapter-01"],
      ["knowledge", "mara-quill"],
      ["rename", "character", "nobody", "Someone"],
      ["add", "glass", "Pane"],
      ["compare"],
      ["synopsis", "--pages", "2"],
      ["validate", ".", "extra"]
    ]) {
      expect(invoke(root, args).code).toBe(usage);
    }
  });
});

describe("exitCodeFor", () => {
  test("uses the code an error carries", () => {
    expect(exitCodeFor(usageError("x"))).toBe(usage);
    expect(exitCodeFor(projectError("x"))).toBe(project);
    expect(exitCodeFor(refusedError("x"))).toBe(refused);
  });

  test("sorts raw file-system errors into reads and writes", () => {
    expect(exitCodeFor(Object.assign(new Error("x"), { code: "EACCES", syscall: "open" }))).toBe(project);
    expect(exitCodeFor(Object.assign(new Error("x"), { code: "EACCES", syscall: "rename" }))).toBe(refused);
    expect(exitCodeFor(Object.assign(new Error("x"), { code: "ENOSPC", syscall: "open" }))).toBe(refused);
  });

  test("anything else is a plain failure", () => {
    expect(exitCodeFor(new Error("x"))).toBe(findings);
    expect(exitCodeFor(Object.assign(new Error("x"), { code: "ERR_SOMETHING" }))).toBe(findings);
    expect(exitCodeFor(undefined)).toBe(findings);
  });

  test("withExitCode replaces a code and withDefaultExitCode keeps one", () => {
    expect(withExitCode(usageError("x"), refused).exitCode).toBe(refused);
    expect(withDefaultExitCode(usageError("x"), refused).exitCode).toBe(usage);
    expect(withDefaultExitCode(new Error("x"), refused).exitCode).toBe(refused);
    expect(withExitCode("text", refused)).toBe("text");
    expect(withDefaultExitCode(null, refused)).toBe(null);
  });
});
