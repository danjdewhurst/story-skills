import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { MAX_STDIN_BYTES, decodeUtf8, readStdin, stdinText } from "../src/stdin.js";
import { createStoryProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

const BIN = path.resolve("bin/story.js");

// runCli in process, with `stdin` standing in for piped input.
function invoke(cwd, argv, stdin) {
  const io = memoryIo(cwd);
  if (stdin !== undefined) {
    io.readStdin = () => Buffer.from(stdin);
  }
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

// The real CLI in a child process, with `input` on a real pipe.
function spawnStory(cwd, argv, input) {
  const result = spawnSync(process.execPath, [BIN, ...argv], { cwd, input, encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function writeCharacter(root, id, name, extra = "") {
  writeMarkdown(path.join(root, "characters", `${id}.md`), `
name: ${name}
role: supporting
status: alive
${extra}
`, `# ${name}\n`);
}

function passageProject() {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Piped", force: false });
  writeMarkdown(path.join(root, "style-sheet.md"), "type: style-sheet\nwatch-words:\n  - suddenly", "# Style Sheet\n");
  writeCharacter(root, "mara-quill", "Mara Quill", "voice-avoid:\n  - okay");
  writeCharacter(root, "tom-reed", "Tom Reed");
  return { root, cwd };
}

const PASSAGE = "Suddenly the door opened. \"Okay, come in,\" Mara said. Tom waited by the stove.\n";

// A readSync stand-in that hands out `steps` in turn: a string is data, an
// Error is thrown, and running out means end of input.
function scriptedRead(steps) {
  const queue = [...steps];
  return (fd, buffer) => {
    const step = queue.shift();
    if (step === undefined) {
      return 0;
    }
    if (step instanceof Error) {
      throw step;
    }
    return Buffer.from(step).copy(buffer);
  };
}

function codeError(code, message = code) {
  return Object.assign(new Error(message), { code });
}

const notTty = () => false;

describe("readStdin", () => {
  test("reads a real file descriptor to its end", () => {
    const file = path.join(makeTempDir(), "passage.md");
    // Larger than one read, so the loop joins several chunks.
    const text = "word ".repeat(30000);
    fs.writeFileSync(file, text);
    const fd = fs.openSync(file, "r");
    try {
      expect(readStdin("prose", { fd, isatty: notTty }).toString("utf8")).toBe(text);
    } finally {
      fs.closeSync(fd);
    }
  });

  test("refuses a terminal rather than waiting for keyboard input", () => {
    expect(() => readStdin("prose", { isatty: () => true })).toThrow("story prose - reads from stdin, but stdin is a terminal: pipe the text in, such as story prose - < draft.md");
  });

  test("waits out a non-blocking pipe with no data yet", () => {
    const readSync = scriptedRead([codeError("EAGAIN"), "one ", codeError("EAGAIN"), "two"]);
    expect(readStdin("prose", { isatty: notTty, readSync }).toString("utf8")).toBe("one two");
  });

  test("treats a Windows EOF error as the end of the pipe", () => {
    const readSync = scriptedRead(["all of it", codeError("EOF")]);
    expect(readStdin("voices", { isatty: notTty, readSync }).toString("utf8")).toBe("all of it");
  });

  test("names a closed stdin and other read failures", () => {
    expect(() => readStdin("import", { isatty: notTty, readSync: scriptedRead([codeError("EBADF")]) }))
      .toThrow("story import - reads from stdin, but stdin is closed: pipe the text in, such as story import - < draft.md");
    expect(() => readStdin("prose", { isatty: notTty, readSync: scriptedRead([codeError("EIO", "i/o error, read")]) }))
      .toThrow("Cannot read stdin: i/o error, read");
  });

  test("stops at the size cap", () => {
    const readSync = scriptedRead(["12345", "67890"]);
    expect(() => readStdin("prose", { isatty: notTty, readSync, maxBytes: 8 })).toThrow("Refusing to read more than 8 bytes from stdin");
    expect(MAX_STDIN_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe("stdinText", () => {
  test("strips a byte-order mark and keeps the text", () => {
    expect(stdinText("prose", Buffer.from("﻿A line.\n"))).toBe("A line.\n");
  });

  test("refuses empty or blank input", () => {
    for (const input of ["", " \n\t\n"]) {
      expect(() => stdinText("prose", Buffer.from(input))).toThrow("story prose - read nothing from stdin: pipe the text in, such as story prose - < draft.md");
    }
  });

  test("refuses a zip, a binary, and text that is not UTF-8, as import does for a file", () => {
    expect(() => stdinText("import", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14]))).toThrow("Cannot read stdin: it is a zip archive (such as a .docx or .odt file). Save or export it as markdown or plain text first");
    expect(() => stdinText("import", Buffer.from("h\0i\0", "latin1"))).toThrow("Cannot read stdin: it is a binary or UTF-16 file, not UTF-8 text. Pipe UTF-8 plain text or markdown instead");
    expect(() => stdinText("import", Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toThrow("Cannot read stdin: it is not valid UTF-8 text. Pipe UTF-8 plain text or markdown instead");
  });

  test("decodeUtf8 keeps the caller's wording", () => {
    expect(() => decodeUtf8(Buffer.from([0xff]), "Cannot import draft.txt", "Save it as UTF-8 plain text or markdown first"))
      .toThrow("Cannot import draft.txt: it is not valid UTF-8 text. Save it as UTF-8 plain text or markdown first");
  });
});

describe("story prose -", () => {
  test("lints a piped passage with the project's style sheet from --path", () => {
    const { root } = passageProject();
    const elsewhere = makeTempDir();
    const result = invoke(elsewhere, ["prose", "-", "--path", root], PASSAGE);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Prose report: passage from stdin, 14 words");
    expect(result.out).toContain("stdin: passage (14 words)");
    expect(result.out).toContain("  Watch words: suddenly 1");
    expect(result.out).toContain("Passage:\n  Repeated 4-word phrases: none\n");
    expect(result.out).not.toContain("No style-sheet.md");
    expect(result.out).not.toContain("Similar character names");
    expect(result.err).toContain("Prose check complete: 0 errors");
  });

  test("uses the current directory's project, and runs with the default rules outside one", () => {
    const { root } = passageProject();
    expect(invoke(root, ["prose", "-"], PASSAGE).out).toContain("Watch words: suddenly 1");

    const outside = invoke(makeTempDir(), ["prose", "-"], PASSAGE);
    expect(outside.code).toBe(0);
    expect(outside.out).toContain("No style-sheet.md: spelling and watch-word checks are off");
    expect(outside.out).not.toContain("Watch words");
  });

  test("reports passage findings under the stdin label", () => {
    const passage = `${"She saw the tide. She felt the cold. She heard the gulls. She noticed the boat. ".repeat(10)}\n`;
    const result = invoke(makeTempDir(), ["prose", "-"], passage);
    expect(result.err).toMatch(/warning: stdin sentence lengths are uniform/);
    expect(result.out).toMatch(/Repeated 4-word phrases: "[^"]+" \d+/);
  });

  test("lints only the chapter text of a piped chapter file", () => {
    const chapter = "---\ntitle: Chapter 1\nnumber: 1\nstatus: draft\n---\n# Chapter 1\n\n## Outline\n\n- Suddenly things happen.\n\n## Chapter Text\n\nThe harbour was quiet.\n";
    const result = invoke(makeTempDir(), ["prose", "-"], chapter);
    expect(result.out).toContain("stdin: passage (4 words)");
  });

  test("a --path that is not a project is an error, and a file error in the project fails the run", () => {
    const empty = makeTempDir();
    const missing = invoke(empty, ["prose", "-", "--path", empty], PASSAGE);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("is not a story project: missing story.md");

    const { root } = passageProject();
    fs.writeFileSync(path.join(root, "characters", "broken.md"), "---\nname: Broken\n");
    const broken = invoke(root, ["prose", "-"], PASSAGE);
    expect(broken.code).toBe(1);
    expect(broken.err).toContain("Prose check failed: 1 errors");
  });

  test("a broken chapter or scene file does not fail a passage check", () => {
    const { root } = passageProject();
    fs.writeFileSync(path.join(root, "chapters", "chapter-09.md"), "---\ntitle: Broken\n");
    fs.mkdirSync(path.join(root, "scenes"), { recursive: true });
    fs.writeFileSync(path.join(root, "scenes", "chapter-09-scene-01.md"), "---\ntitle: Broken\n");
    expect(invoke(root, ["prose"]).code).toBe(1);
    for (const command of ["prose", "voices"]) {
      const result = invoke(root, [command, "-"], PASSAGE);
      expect(result.code).toBe(0);
      expect(result.err).toContain("0 errors");
    }
  });

  test("empty input and extra arguments are errors", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["prose", "-"], "").err).toContain("story prose - read nothing from stdin");
    expect(invoke(cwd, ["prose", "-", "extra"], PASSAGE).err).toContain("Unexpected argument for story prose [path|-]: extra");
  });

  test("reads a real pipe", () => {
    const { root } = passageProject();
    const result = spawnStory(root, ["prose", "-"], PASSAGE);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Watch words: suddenly 1");
  });

  test("an empty real pipe is an error", () => {
    const result = spawnStory(makeTempDir(), ["prose", "-"], "");
    expect(result.code).toBe(1);
    expect(result.err).toBe("story prose - read nothing from stdin: pipe the text in, such as story prose - < draft.md\n");
  });
});

describe("story voices -", () => {
  test("attributes a piped passage against the project's characters", () => {
    const { root } = passageProject();
    const result = invoke(root, ["voices", "-"], PASSAGE);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Voices: 1 speaking character, 0 unattributed lines");
    expect(result.out).toContain("mara-quill: 1 line, 3 words");
    expect(result.err).toContain("warning: mara-quill says \"okay\", which is in their voice-avoid list (stdin)");
  });

  test("takes the project from --path and needs one", () => {
    const { root } = passageProject();
    const elsewhere = makeTempDir();
    expect(invoke(elsewhere, ["voices", "-", "--path", root], PASSAGE).out).toContain("mara-quill: 1 line");

    const outside = invoke(elsewhere, ["voices", "-"], PASSAGE);
    expect(outside.code).toBe(1);
    expect(outside.err).toContain("is not a story project: missing story.md");
  });

  test("reads a real pipe", () => {
    const { root } = passageProject();
    const result = spawnStory(root, ["voices", "-"], PASSAGE);
    expect(result.code).toBe(0);
    expect(result.out).toContain("mara-quill: 1 line, 3 words");
  });
});

describe("story import -", () => {
  test("splits a piped manuscript into a new project", () => {
    const cwd = makeTempDir();
    const result = invoke(cwd, ["import", "-", "--title", "Piped Book"], "# Chapter 1: Arrival\n\nThe boat came in.\n\n# Chapter 2: Departure\n\nThe boat went out.\n");
    expect(result.code).toBe(0);
    expect(result.out).toContain("Imported 2 chapters (8 words) into");
    const root = path.join(cwd, "piped-book");
    expect(fs.readFileSync(path.join(root, "chapters", "chapter-02.md"), "utf8")).toContain("title: Departure");
    expect(fs.readFileSync(path.join(root, "story.md"), "utf8")).toContain("Imported from stdin. Replace with a 2-3 sentence synopsis.");
  });

  test("numbers a piped chapter with no heading rather than naming it after a file", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["import", "-", "--title", "Solo"], "Only one chapter here.\n").code).toBe(0);
    expect(fs.readFileSync(path.join(cwd, "solo", "chapters", "chapter-01.md"), "utf8")).toContain("title: Chapter 1");
  });

  test("refuses empty or non-UTF-8 input without creating a project", () => {
    const cwd = makeTempDir();
    expect(invoke(cwd, ["import", "-", "--title", "Empty"], "").err).toBe("story import - read nothing from stdin: pipe the text in, such as story import - < draft.md\n");
    expect(invoke(cwd, ["import", "-", "--title", "Latin"], Buffer.from([0x63, 0x61, 0x66, 0xe9])).err).toContain("Cannot read stdin: it is not valid UTF-8 text");
    expect(fs.readdirSync(cwd)).toEqual([]);
  });

  test("refuses a chapter too large to read back before creating the project", () => {
    const cwd = makeTempDir();
    const prose = `${"word ".repeat(Math.floor(MAX_STDIN_BYTES / 5) - 2)}\n`;
    const result = invoke(cwd, ["import", "-", "--title", "Huge"], prose);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^Cannot import: chapter-01\.md would be \d+ bytes, over the 5242880 byte limit story reads\. Split the manuscript with chapter headings first\n$/);
    expect(fs.readdirSync(cwd)).toEqual([]);
  });

  test("a file named - is still reachable as ./-", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "-"), "A chapter from a file.\n");
    const result = invoke(cwd, ["import", "./-", "--title", "Dash File"]);
    expect(result.code).toBe(0);
    expect(fs.readFileSync(path.join(cwd, "dash-file", "story.md"), "utf8")).toContain("Imported from -.");
  });

  test("reads a real pipe", () => {
    const cwd = makeTempDir();
    const result = spawnStory(cwd, ["import", "-", "--title", "Real Pipe"], "# Chapter 1\n\nFirst.\n\n# Chapter 2\n\nSecond.\n");
    expect(result.code).toBe(0);
    expect(result.out).toContain("Imported 2 chapters (2 words)");
  });
});
