import { afterEach, describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { COMMANDS } from "../src/commands.js";
import { EXIT_CODES, exitCodeFor, projectError, refusedError, usageError, withDefaultExitCode, withExitCode } from "../src/exit-codes.js";
import { LOCK_FILE } from "../src/lock.js";
import { CHMOD_IGNORED, makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

const { ok, findings, usage, project, refused } = EXIT_CODES;

function invoke(cwd, argv, stdin) {
  const io = memoryIo(cwd);
  if (stdin !== undefined) {
    io.readStdin = () => Buffer.from(stdin);
  }
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

// A --json run: stdout must be one envelope whose `ok` is true exactly when
// the exit code is 0, and nothing goes to stderr.
function invokeJson(cwd, argv, stdin) {
  const result = invoke(cwd, [...argv, "--json"], stdin);
  expect(result.err).toBe("");
  const envelope = JSON.parse(result.out);
  expect(envelope.ok).toBe(result.code === ok);
  return { ...result, envelope };
}

const JSON_COMMANDS = COMMANDS.filter((command) => command.options?.includes("json")).map((command) => command.name);

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
  check: () => ["check"],
  knowledge: () => ["knowledge", "mara-quill", "--at", "chapter-01"],
  context: () => ["context", "chapter-01"],
  compare: () => ["compare", "--against", "."],
  similarity: (cwd) => {
    const reference = path.join(cwd, "..", "reference.txt");
    fs.writeFileSync(reference, "The tide came in over the rocks and the lamp was lit.\n", "utf8");
    return ["similarity", "--against", reference];
  },
  progress: () => ["progress"],
  timeline: () => ["timeline"],
  prose: () => ["prose"],
  diagram: () => ["diagram", "relationships"],
  names: () => ["names", "Tobin"],
  mentions: () => ["mentions", "character", "mara-quill"],
  pacing: () => ["pacing"],
  clues: () => ["clues"],
  grid: () => ["grid"],
  list: () => ["list", "characters", "--where", "name"],
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
  check: ["check"],
  compare: ["compare", "--against", "../clean"],
  progress: ["progress"],
  timeline: ["timeline"],
  prose: ["prose"],
  diagram: ["diagram", "arcs"],
  names: ["names", "Mara Quill"],
  mentions: ["mentions"],
  pacing: ["pacing"],
  clues: ["clues"],
  grid: ["grid"],
  list: ["list", "chapters"],
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
  doctor: ["doctor", "--fix"],
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

  test.skipIf(CHMOD_IGNORED)("a write the file system refuses exits 4", () => {
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

  test.skipIf(CHMOD_IGNORED)("a folder migrate cannot create exits 4", () => {
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

  test("a symlinked project file exits 3; writing through a symlink exits 4", () => {
    const root = newProject();
    const outside = makeTempDir();
    const registry = path.join(root, "characters", "_index.md");
    fs.renameSync(registry, path.join(outside, "_index.md"));
    fs.symlinkSync(path.join(outside, "_index.md"), registry);
    const reindex = invoke(root, ["reindex"]);
    expect(reindex.err).toContain("Refusing to read through symlink");
    expect(reindex.code).toBe(project);

    const target = path.join(outside, "book.md");
    fs.writeFileSync(target, "old\n");
    fs.mkdirSync(path.join(root, "dist"), { recursive: true });
    fs.symlinkSync(target, path.join(root, "dist", "book.md"));
    const exported = invoke(root, ["export", "--out", "dist/book.md"]);
    expect(exported.err).toContain("Refusing to write through symlink");
    expect(exported.code).toBe(refused);
    expect(fs.readFileSync(target, "utf8")).toBe("old\n");
  });

  test.skipIf(CHMOD_IGNORED)("an import source that cannot be read exits 2", () => {
    const cwd = makeTempDir();
    const draft = path.join(cwd, "draft.md");
    fs.writeFileSync(draft, "# Chapter 1\n\nText.\n", "utf8");
    fs.chmodSync(draft, 0o000);
    try {
      const result = invoke(cwd, ["import", draft, "--title", "Locked"]);
      expect(result.err).toContain("permission denied");
      expect(result.code).toBe(usage);
    } finally {
      fs.chmodSync(draft, 0o644);
    }
  });

  test("a project that cannot be built or updated exits 3", () => {
    const root = newProject();
    breakChapter(root);
    for (const args of [["reindex"], ["export"], ["build"], ["add", "character", "Tobin"], ["wordcount", "--write"], ["context", "chapter-02"]]) {
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
      ["grid", "--format", "pdf"],
      ["grid", "--from", "chapter-09"],
      ["list"],
      ["list", "glass"],
      ["list", "chapters", "--where", "stauts=draft"],
      ["list", "chapters", "--where", "status="],
      ["knowledge", "nobody", "--at", "chapter-01"],
      ["knowledge", "mara-quill"],
      ["context", "chapter-09"],
      ["context"],
      ["rename", "character", "nobody", "Someone"],
      ["mentions", "character"],
      ["mentions", "character", "nobody"],
      ["mentions", "arc", "mara-quill"],
      ["mentions", "glass", "pane"],
      ["add", "glass", "Pane"],
      ["compare"],
      ["similarity"],
      ["similarity", "--against", "no-such-reference"],
      ["synopsis", "--pages", "2"],
      ["validate", ".", "extra"]
    ]) {
      expect(invoke(root, args).code).toBe(usage);
    }
  });
});

describe("exit codes with --json", () => {
  test("the JSON commands are the ones the contract covers", () => {
    expect(JSON_COMMANDS.length).toBeGreaterThan(0);
    for (const name of JSON_COMMANDS) {
      expect(Object.keys(OK_ARGS)).toContain(name);
    }
  });

  for (const name of JSON_COMMANDS) {
    test(`${name} --json exits as the text run does: 0, 2, and 3`, () => {
      const root = newProject();
      const success = invokeJson(root, OK_ARGS[name](root));
      expect(success.code).toBe(ok);

      const misuse = invokeJson(root, [name, "--no-such-flag"]);
      expect(misuse.envelope.diagnostics[0].message).toContain("Unknown option --no-such-flag");
      expect(misuse.code).toBe(usage);

      const empty = makeTempDir();
      const missing = invokeJson(empty, [...OK_ARGS[name](empty), "--path", empty]);
      expect(missing.envelope.diagnostics[0].message).toContain("is not a story project");
      expect(missing.code).toBe(project);
    });
  }

  for (const [name, args] of Object.entries(FINDINGS_ARGS).filter(([command]) => JSON_COMMANDS.includes(command))) {
    test(`${name} --json exits 1 on findings`, () => {
      const root = newProject();
      if (name === "compare") {
        // As in the text run: compare refuses a broken chapter outright, so
        // a broken progress log is the finding.
        fs.cpSync(root, path.join(root, "..", "clean"), { recursive: true });
        fs.writeFileSync(path.join(root, "progress.md"), "---\na: 1\na: 2\n---\n", "utf8");
      } else if (name !== "names") {
        breakChapter(root);
      }
      const result = invokeJson(root, args);
      expect(result.envelope.diagnostics.some((entry) => entry.severity === "error")).toBe(true);
      expect(result.code).toBe(findings);
    });
  }

  test.skipIf(CHMOD_IGNORED)("progress --log --json exits 4 when the log cannot be written", () => {
    const root = newProject();
    const log = path.join(root, "progress.md");
    if (!fs.existsSync(log)) {
      writeMarkdown(log, "type: progress-log\nsessions: []");
    }
    fs.chmodSync(log, 0o444);
    try {
      const result = invokeJson(root, ["progress", "--log"]);
      expect(result.envelope.diagnostics[0].message).toContain("permission denied");
      expect(result.code).toBe(refused);
    } finally {
      fs.chmodSync(log, 0o644);
    }
  });
});

describe("exit codes for stdin", () => {
  const bad = [
    ["empty", ""],
    ["blank", "  \n\n"],
    ["binary", "a\u0000b"],
    ["a zip archive", "PK\u0003\u0004rest"]
  ];

  for (const [label, stdin] of bad) {
    test(`${label} stdin is a usage error for prose, voices, and import`, () => {
      const root = newProject();
      expect(invoke(root, ["prose", "-"], stdin).code).toBe(usage);
      expect(invoke(root, ["voices", "-"], stdin).code).toBe(usage);
      expect(invoke(path.dirname(root), ["import", "-", "--title", "Piped"], stdin).code).toBe(usage);
      expect(invokeJson(root, ["prose", "-"], stdin).code).toBe(usage);
      expect(invokeJson(root, ["voices", "-"], stdin).code).toBe(usage);
    });
  }

  test("a passage on stdin succeeds", () => {
    const root = newProject();
    expect(invoke(root, ["prose", "-"], "The tide came in slowly.\n").code).toBe(ok);
    expect(invokeJson(root, ["voices", "-"], "\"Go,\" Mara said.\n").code).toBe(ok);
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
    expect(exitCodeFor(Object.assign(new Error("x"), { code: "EACCES", syscall: "mkdtemp" }))).toBe(refused);
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
