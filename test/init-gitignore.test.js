import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { importManuscript } from "../src/import.js";
import { buildBook, createStoryProject } from "../src/story.js";
import { makeTempDir, memoryIo } from "./helpers.js";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

const NOTE = "note: .gitignore was kept and does not list dist/";

describe("init .gitignore", () => {
  test("a new project ignores dist/, story leftovers, and OS and editor files", () => {
    const cwd = makeTempDir();
    const result = invoke(cwd, ["init", "Salt Road"]);
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    const lines = fs.readFileSync(path.join(cwd, "salt-road", ".gitignore"), "utf8").split("\n");
    for (const entry of ["dist/", ".story.lock", ".*.story-*.tmp", ".DS_Store", "Thumbs.db", "*.swp", "*~"]) {
      expect(lines).toContain(entry);
    }
    expect(createStoryProject({ cwd, title: "Other Road" }).gitignore).toBe("created");
  });

  test("the build folder a default build writes to is the one ignored", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "draft.md"), "# Chapter 1\n\nThe tide came in.\n");
    const { root } = importManuscript({ cwd, source: "draft.md", title: "Salt Road" });
    const { outFile } = buildBook(root);
    expect(path.relative(root, outFile).split(path.sep)[0]).toBe("dist");
  });

  test("--force adds a missing .gitignore to an existing project", () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Salt Road" });
    fs.rmSync(path.join(root, ".gitignore"));
    const result = invoke(cwd, ["init", "Salt Road", "--force"]);
    expect(result.code).toBe(0);
    expect(fs.readFileSync(path.join(root, ".gitignore"), "utf8")).toContain("dist/\n");
  });

  test("an existing .gitignore is kept byte for byte, with a note when it misses dist/", () => {
    const cwd = makeTempDir();
    const root = path.join(cwd, "salt-road");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\r\n# dist/\n");
    const result = invoke(cwd, ["init", "Salt Road", "--force"]);
    expect(result.code).toBe(0);
    expect(result.err).toContain(NOTE);
    expect(fs.readFileSync(path.join(root, ".gitignore"), "utf8")).toBe("node_modules/\r\n# dist/\n");
  });

  test("any common spelling of the dist rule counts, so no note is printed", () => {
    for (const rule of ["dist", "dist/", "/dist", "/dist/", "dist/*", "dist/**", "**/dist/", "  dist/  "]) {
      const cwd = makeTempDir();
      const root = path.join(cwd, "salt-road");
      fs.mkdirSync(root);
      fs.writeFileSync(path.join(root, ".gitignore"), `*.swp\r\n${rule}\r\n`);
      const result = invoke(cwd, ["init", "Salt Road", "--force"]);
      expect(result.code).toBe(0);
      expect(result.err).toBe("");
    }
  });

  test("a symlinked, unreadable, or non-file .gitignore is left alone", () => {
    const cwd = makeTempDir();
    const shared = path.join(cwd, "shared-ignore");
    fs.writeFileSync(shared, "*.log\n");
    const linked = path.join(cwd, "linked");
    fs.mkdirSync(linked);
    fs.symlinkSync(shared, path.join(linked, ".gitignore"));
    expect(createStoryProject({ cwd, title: "Linked", force: true }).gitignore).toBe("kept");
    expect(fs.readFileSync(shared, "utf8")).toBe("*.log\n");

    const binary = path.join(cwd, "binary");
    fs.mkdirSync(binary);
    fs.writeFileSync(path.join(binary, ".gitignore"), Buffer.from([0xff, 0xfe, 0x00, 0x80]));
    expect(createStoryProject({ cwd, title: "Binary", force: true }).gitignore).toBe("kept");

    const odd = path.join(cwd, "odd");
    fs.mkdirSync(path.join(odd, ".gitignore"), { recursive: true });
    expect(createStoryProject({ cwd, title: "Odd", force: true }).gitignore).toBe("kept");
  });

  test("a sequel started with --follows gets its own .gitignore", () => {
    const cwd = makeTempDir();
    createStoryProject({ cwd, title: "First Book" });
    const result = invoke(cwd, ["init", "Second Book", "--follows", "first-book"]);
    expect(result.code).toBe(0);
    expect(fs.existsSync(path.join(cwd, "second-book", ".gitignore"))).toBe(true);
  });

  test("import writes the same .gitignore and notes one that misses dist/", () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, "draft.md"), "# Chapter 1\n\nThe tide came in.\n");
    const created = invoke(cwd, ["import", "draft.md", "--title", "Tide Book"]);
    expect(created.code).toBe(0);
    expect(fs.readFileSync(path.join(cwd, "tide-book", ".gitignore"), "utf8")).toContain("dist/\n");

    fs.writeFileSync(path.join(cwd, "tide-book", ".gitignore"), "*.swp\n");
    const again = invoke(cwd, ["import", "draft.md", "--title", "Tide Book", "--force"]);
    expect(again.code).toBe(0);
    expect(again.err).toContain(NOTE);
    expect(fs.readFileSync(path.join(cwd, "tide-book", ".gitignore"), "utf8")).toBe("*.swp\n");
  });
});
