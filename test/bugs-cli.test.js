import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { handleOutputError, parseArgs, runCli } from "../src/cli.js";
import { passChecks, DEFAULT_PASSES } from "../src/passes.js";
import { createEntity, createStoryProject, projectActions, validateLinks, validateProject } from "../src/story.js";
import { findOverlaps } from "../scripts/check-evals.js";
import { bumpVersion, parseReleaseArgs } from "../scripts/release.js";
import { checkDraft } from "../evals/run-evals.js";
import { makeTempDir, memoryIo } from "./helpers.js";

const repoRoot = path.resolve(import.meta.dir, "..");

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function newProject(title = "Gull") {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title, force: false }).root;
}

function fakeProcess(exitCode) {
  const written = [];
  return {
    exitCode,
    exits: [],
    stderr: { write: (text) => written.push(text) },
    exit(code) {
      this.exits.push(code);
    },
    written
  };
}

function actionLines(root, options) {
  return projectActions(root, options).actions.map((item) => `[${item.priority}] ${item.title}: ${item.detail}`).join("\n");
}

describe("#66 output errors", () => {
  test("a closed pipe exits quietly and keeps the exit code", () => {
    const proc = fakeProcess(undefined);
    handleOutputError(Object.assign(new Error("write EPIPE"), { code: "EPIPE", syscall: "write" }), proc);
    expect(proc.exits).toEqual([0]);
    expect(proc.written).toEqual([]);
    const failing = fakeProcess(1);
    handleOutputError(Object.assign(new Error("write EPIPE"), { code: "EPIPE", syscall: "write" }), failing);
    expect(failing.exits).toEqual([1]);
  });

  test("another write failure is one line, and other errors keep their stack", () => {
    const proc = fakeProcess(0);
    handleOutputError(Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC", syscall: "write" }), proc);
    expect(proc.written).toEqual(["Cannot write output: no space left on the device\n"]);
    expect(proc.exits).toEqual([1]);
    const other = fakeProcess(0);
    handleOutputError(new TypeError("boom"), other);
    expect(other.written[0]).toContain("TypeError: boom");
    expect(other.exits).toEqual([1]);
  });

  test.skipIf(!fs.existsSync("/dev/full"))("writing help to a full disk prints one line, not a stack trace", () => {
    const fd = fs.openSync("/dev/full", "w");
    try {
      const result = spawnSync(process.execPath, [path.join(repoRoot, "bin", "story.js"), "--help"], { stdio: ["ignore", fd, "pipe"], encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toBe("Cannot write output: no space left on the device\n");
    } finally {
      fs.closeSync(fd);
    }
  });
});

describe("#94 help parsing", () => {
  test("story help help prints the general usage", () => {
    const result = invoke(makeTempDir(), ["help", "help"]);
    expect(result.code).toBe(0);
    expect(result.out).toStartWith("Usage: story <command> [options]");
  });

  test("--help and --version take a boolean value", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["validate", "--help=true"]).out).toStartWith("Usage: story validate");
    expect(invoke(cwd, ["--version=1"]).out).toMatch(/^\d+\.\d+\.\d+\n$/);
    expect(parseArgs(["--help=false", "--version=no"])).toEqual({ positionals: [], options: {} });
    const bad = invoke(cwd, ["--help=maybe"]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('Unknown value "maybe" for --help');
  });
});

describe("#78 project path errors", () => {
  test("pointing at story.md says to pass the folder", () => {
    const root = newProject();
    const result = invoke(root, ["validate", "story.md"]);
    expect(result.code).toBe(3);
    expect(result.err).toBe(`${path.join(root, "story.md")} is a file; pass the folder that contains it\n`);
  });

  test("a project subfolder hints at the project root", () => {
    const root = newProject();
    const result = invoke(path.join(root, "chapters"), ["report"]);
    expect(result.code).toBe(3);
    expect(result.err).toContain("is not a story project: missing story.md (the project root looks like ");
    expect(result.err).toContain("; pass that path instead)");
    const outside = invoke(makeTempDir(), ["report"]);
    expect(outside.err).not.toContain("project root looks like");
  });
});

describe("#87 positive integer options", () => {
  test("only plain decimal integers within the safe range are accepted", () => {
    const root = newProject();
    for (const value of ["0x10", "1e21", "99999999999999999999", "2.0", "0b11", "-3", "0"]) {
      const result = invoke(root, ["add", "chapter", "Bad", "--number", value]);
      expect(result.code).toBe(2);
      expect(result.err).toContain("chapter number must be a positive integer");
    }
    expect(fs.readdirSync(path.join(root, "chapters")).filter((name) => name !== "_index.md")).toEqual([]);
    expect(invoke(root, ["add", "chapter", "Pad", "--number", " 2 "]).code).toBe(0);
    expect(invoke(root, ["add", "scene", "Hex", "--chapter", "chapter-02", "--scene", "0x2"]).err).toContain("scene number must be a positive integer");
    expect(invoke(root, ["synopsis", "--pages", "0x3"]).err).toContain("Unsupported synopsis length: 0x3");
    expect(invoke(root, ["add", "matter", "Dedication", "--order", "1e1"]).err).toContain("matter order must be a non-negative integer");
    expect(invoke(makeTempDir(), ["init", "N", "--book-number", "1e3"]).err).toContain("Book number must be 0 or a positive number");
  });
});

describe("#76 revision pass checks", () => {
  test("check commands name the project path", () => {
    const structure = DEFAULT_PASSES.find((entry) => entry.pass === "structure");
    expect(passChecks(structure, ".")).toEqual(["story timeline", "story pacing", "story diagram arcs"]);
    expect(passChecks(structure, "book")).toEqual(["story timeline book", "story pacing book", "story diagram arcs --path book"]);
    const proof = DEFAULT_PASSES.find((entry) => entry.pass === "proof");
    expect(passChecks(proof, "book")).toEqual(["story build book --format print", "story build book --format html"]);
  });

  test("story next from the parent folder prints runnable checks", () => {
    const cwd = makeTempDir();
    const root = createStoryProject({ cwd, title: "Book", dir: "book", force: false }).root;
    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace(/^status: \w+/m, "status: revising"));
    expect(invoke(cwd, ["passes", "book", "--init"]).code).toBe(0);
    expect(invoke(cwd, ["next", "book"]).out).toContain("Run story timeline book, story pacing book, story diagram arcs --path book. Mark it with story passes book --done structure.");
  });
});

describe("#109 discovered chapters", () => {
  function reconcile(root) {
    return actionLines(root).split("\n").find((line) => line.includes("Reconcile discovered chapters")) ?? "";
  }

  test("post-hoc notes below ## Chapter Text do not count", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "Relief", number: 1, mode: "discovered" });
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.appendFileSync(chapter, "\nShe climbed.\n\n## Chapter Notes (post-hoc)\n\n- TODO: add Harry Rowe file.\n");
    expect(reconcile(root)).toContain("chapter-01");
    const text = fs.readFileSync(chapter, "utf8").replace("\n## Chapter Notes (post-hoc)\n\n- TODO: add Harry Rowe file.\n", "");
    fs.writeFileSync(chapter, text.replace("## Chapter Text", "## Chapter Notes (post-hoc)\n\n- Reconciled.\n\n## Chapter Text"));
    expect(reconcile(root)).toBe("");
  });

  test("a draft-mode: discovered project flags drafted chapters with no mode", () => {
    const root = newProject();
    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace(/^status: /m, "draft-mode: discovered\nstatus: "));
    createEntity(root, { kind: "chapter", name: "Planned", number: 1 });
    expect(reconcile(root)).toBe("");
    createEntity(root, { kind: "chapter", name: "Two", number: 2 });
    fs.appendFileSync(path.join(root, "chapters", "chapter-02.md"), "\nA boy waved.\n");
    expect(reconcile(root)).toContain("for chapter-02.");
  });

  test("mode and draft-mode are enums", () => {
    const root = newProject();
    expect(() => createEntity(root, { kind: "chapter", name: "Three", number: 3, mode: "pantsed" })).toThrow('Unsupported chapter mode "pantsed"');
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const chapter = path.join(root, "chapters", "chapter-01.md");
    fs.writeFileSync(chapter, fs.readFileSync(chapter, "utf8").replace(/^mode: .*$/m, "mode: discoverd"));
    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace(/^status: /m, "draft-mode: pantsed\nstatus: "));
    const errors = validateProject(root).errors;
    expect(errors).toContain("chapters/chapter-01.md frontmatter field mode has unsupported value discoverd");
    expect(errors).toContain("story.md frontmatter field draft-mode has unsupported value pantsed");
  });
});

describe("#111 validation warnings in next", () => {
  test("validate warnings get an action instead of the healthy fallback", () => {
    const root = newProject();
    createEntity(root, { kind: "matter", name: "Dedication" });
    const lines = actionLines(root);
    expect(lines).toContain("[P1] Review validation warnings: Run story validate . and review 1 warning.");
    expect(lines).not.toContain("mechanically healthy");
  });

  test("stale word counts and missing scenes keep their own actions only", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    fs.appendFileSync(path.join(root, "chapters", "chapter-01.md"), "\nShe climbed the steps.\n");
    const lines = actionLines(root);
    expect(lines).toContain("Refresh word counts");
    expect(lines).toContain("Add scene records");
    expect(lines).not.toContain("Review validation warnings");
  });
});

describe("#112 scheduled chapters in arc bodies", () => {
  test("a planned plot point may name a chapter not yet written", () => {
    const root = newProject();
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const arc = createEntity(root, { kind: "arc", name: "Main", type: "main" });
    fs.appendFileSync(arc.file, "\n| 1 | Harry sees the lights | act-3 | chapter-09 | planned | |\n");
    expect(validateLinks(root).errors).toEqual([]);
    fs.appendFileSync(arc.file, "\nA typo: chapter-1 and chapter-00.\n");
    expect(validateLinks(root).errors).toEqual([
      "plot/arcs/main.md references missing chapter chapter-1",
      "plot/arcs/main.md references missing chapter chapter-00"
    ]);
  });

  test("the timeline still needs chapters that exist", () => {
    const root = newProject();
    fs.appendFileSync(path.join(root, "plot", "timeline.md"), "\n- chapter-09: the lights\n");
    expect(validateLinks(root).errors).toEqual(["plot/timeline.md references missing chapter chapter-09"]);
  });
});

describe("#114 #129 release arguments", () => {
  test("unknown flags and extra positionals are refused", () => {
    expect(parseReleaseArgs(["patch"])).toEqual({ bump: "patch", dryRun: false });
    expect(parseReleaseArgs(["--dry-run", "minor"])).toEqual({ bump: "minor", dryRun: true });
    for (const flag of ["--dryrun", "--dry", "--dry_run", "--dryRun", "-n"]) {
      expect(() => parseReleaseArgs(["patch", flag])).toThrow(`Unknown option ${flag}`);
    }
    expect(() => parseReleaseArgs(["patch", "minor"])).toThrow("Expected one version bump, got patch minor");
    expect(() => parseReleaseArgs([])).toThrow("Missing version bump");
    expect(() => parseReleaseArgs(["--dry-run"])).toThrow("Missing version bump");
  });

  test("the release script exits before any check on a mistyped flag", () => {
    const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "release.js"), "patch", "--dryrun"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown option --dryrun");
    expect(result.stdout).toBe("");
  });

  test("versions with leading zeros are rejected", () => {
    expect(() => bumpVersion("0.11.0", "0.11.01")).toThrow("without leading zeros");
    expect(() => bumpVersion("0.11.0", "01.0.0")).toThrow("without leading zeros");
    expect(() => bumpVersion("0.011.0", "patch")).toThrow("not a plain MAJOR.MINOR.PATCH");
    expect(bumpVersion("0.11.0", "0.11.10")).toBe("0.11.10");
    expect(bumpVersion("0.9.0", "0.10.0")).toBe("0.10.0");
  });
});

describe("#131 eval overlap direction", () => {
  test("only a required phrase containing a banned one is an overlap", () => {
    const found = findOverlaps({ banned: ["it was Ana", "brass key"], required: ["Ana", "Petra's brass key"] }, "");
    expect(found.with_required).toEqual([["brass key", "Petra's brass key"]]);
  });
});

describe("#98 banned-phrase inflection", () => {
  function trapResults(banned, draft) {
    return checkDraft({ banned, required: [] }, "", draft).filter(([, label]) => label.startsWith("trap avoided"));
  }

  test("silent-e and y-to-ies forms are caught", () => {
    expect(trapResults(["delve"], "We kept delving deeper.")).toEqual([[false, 'trap avoided: "delve"']]);
    expect(trapResults(["delve"], "She delved and delves.")).toEqual([[false, 'trap avoided: "delve"']]);
    expect(trapResults(["tapestry"], "Rich tapestries hung there.")).toEqual([[false, 'trap avoided: "tapestry"']]);
    expect(trapResults(["rich tapestry"], "A rich tapestries hall.")).toEqual([[false, 'trap avoided: "rich tapestry"']]);
    expect(trapResults(["key"], "They carved the turkey.")).toEqual([[true, 'trap avoided: "key"']]);
    expect(trapResults(["delve"], "The delft plates.")).toEqual([[true, 'trap avoided: "delve"']]);
  });
});

describe("eval checker line count", () => {
  function lineResult(draft) {
    return checkDraft({ lines: 5, required: [] }, "", draft).filter(([, label]) => label.includes(" line(s), "));
  }

  test("counts nonblank verse lines, not paragraphs", () => {
    expect(lineResult("Tomas brought paraffin.")).toEqual([[false, "structure: 1 line(s), brief asks for 5"]]);
    expect(lineResult("one\ntwo\n\n  three\nfour\nfive\n")).toEqual([[true, "structure: 5 line(s), brief asks for 5"]]);
    expect(lineResult("one\ntwo\nthree\nfour\nfive\n```\nsix\n```\n")).toEqual([[true, "structure: 5 line(s), brief asks for 5"]]);
  });
});
