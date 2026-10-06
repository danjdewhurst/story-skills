import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { createStoryProject } from "../src/story.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function writeChapter(root, number, frontmatter = "") {
  const id = `chapter-${String(number).padStart(2, "0")}`;
  writeMarkdown(path.join(root, "chapters", `${id}.md`), `title: Chapter ${number}\nnumber: ${number}\n${frontmatter}`, "## Chapter Text\n\nWords.\n");
}

function writeCharacter(root, id, frontmatter) {
  writeMarkdown(path.join(root, "characters", `${id}.md`), `name: ${id}\n${frontmatter}`, `# ${id}\n`);
}

function sampleProject() {
  const { root } = createStoryProject({ cwd: makeTempDir(), title: "Saved Queries", force: false });
  // Written out of order, and chapter-10 after chapter-09, to check book order.
  writeChapter(root, 10, "status: draft\npov: ilse\ncharacters:\n  - ilse\n  - mara\nhook: cliffhanger\nmy-flag: true");
  writeChapter(root, 2, "status: draft\npov: mara\ncharacters:\n  - mara");
  writeChapter(root, 9, "status: final\npov: ilse\ncharacters:\n  - ilse");
  writeChapter(root, 1, "status: draft\npov: ilse\ncharacters:\n  - ilse\n  - mara\nhook: question");
  writeCharacter(root, "ilse", "role: protagonist\nstatus: alive");
  writeCharacter(root, "mara", "role: antagonist\nstatus: alive");
  return root;
}

describe("story list", () => {
  test("lists every file of a kind in book order, with a count on stderr", () => {
    const root = sampleProject();
    const { code, out, err } = invoke(root, ["list", "chapters"]);
    expect(code).toBe(0);
    expect(out).toBe([
      "chapter-01  Chapter 1   chapters/chapter-01.md",
      "chapter-02  Chapter 2   chapters/chapter-02.md",
      "chapter-09  Chapter 9   chapters/chapter-09.md",
      "chapter-10  Chapter 10  chapters/chapter-10.md",
      ""
    ].join("\n"));
    expect(err).toBe("4 of 4 chapters matched\n");
  });

  test("ANDs every --where, matching lists by membership, and prints the filtered values", () => {
    const root = sampleProject();
    const { code, out, err } = invoke(root, ["list", "chapter", "--where", "status=draft", "--where", "characters=mara", "--where=pov!=mara"]);
    expect(code).toBe(0);
    expect(out).toBe([
      "chapter-01  Chapter 1   chapters/chapter-01.md  status=draft  characters=ilse,mara  pov=ilse",
      "chapter-10  Chapter 10  chapters/chapter-10.md  status=draft  characters=ilse,mara  pov=ilse",
      ""
    ].join("\n"));
    expect(err).toBe("2 of 4 chapters matched\n");
  });

  test("key tests presence and !key absence; numbers, booleans, and custom keys compare as text", () => {
    const root = sampleProject();
    const ids = (argv) => invoke(root, argv).out.split("\n").filter(Boolean).map((line) => line.split(" ")[0]);
    expect(ids(["list", "chapters", "--where", "hook"])).toEqual(["chapter-01", "chapter-10"]);
    expect(ids(["list", "chapters", "--where", "!hook"])).toEqual(["chapter-02", "chapter-09"]);
    expect(ids(["list", "chapters", "--where", "number=9"])).toEqual(["chapter-09"]);
    expect(ids(["list", "chapters", "--where", "my-flag=true"])).toEqual(["chapter-10"]);
    // != also matches a file that leaves the key unset.
    expect(ids(["list", "chapters", "--where", "hook!=question"])).toEqual(["chapter-02", "chapter-09", "chapter-10"]);
  });

  test("no match prints nothing and exits 0", () => {
    const root = sampleProject();
    const { code, out, err } = invoke(root, ["list", "characters", "--where", "role=mentor"]);
    expect(code).toBe(0);
    expect(out).toBe("");
    expect(err).toBe("0 of 2 characters matched\n");
  });

  test("an unknown kind or key is a usage error with the nearest name", () => {
    const root = sampleProject();
    let result = invoke(root, ["list", "chapterz"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("did you mean chapters?");
    result = invoke(root, ["list", "chapters", "--where", "stauts=draft"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain('Unknown key "stauts" for chapters');
    expect(result.err).toContain('did you mean "status"?');
    // A key another kind defines is still unknown here, with no guess.
    result = invoke(root, ["list", "characters", "--where", "pov=ilse"]);
    expect(result.code).toBe(2);
    expect(result.err).not.toContain("did you mean");
    for (const filter of ["status=", "=draft", "a b"]) {
      expect(invoke(root, ["list", "chapters", "--where", filter]).code).toBe(2);
    }
  });

  test("a file that fails to parse stops the list", () => {
    const root = sampleProject();
    fs.writeFileSync(path.join(root, "chapters", "chapter-03.md"), "---\ntitle: [unclosed\n---\n", "utf8");
    const { code, out, err } = invoke(root, ["list", "chapters"]);
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toContain("chapters/chapter-03.md");
  });

  test("--json gives the filters and each match's fields, and matches the result schema", () => {
    const root = sampleProject();
    const { code, out, err } = invoke(root, ["list", "chapters", "--where", "pov=ilse", "--where", "!hook", "--json"]);
    expect(code).toBe(0);
    expect(err).toBe("");
    const envelope = JSON.parse(out);
    expect(validateAgainstSchema(envelope, schema)).toEqual([]);
    expect(envelope.data).toEqual({
      kind: "chapters",
      where: [{ key: "pov", op: "eq", value: "ilse" }, { key: "hook", op: "absent", value: null }],
      total: 4,
      items: [{ id: "chapter-09", file: "chapters/chapter-09.md", title: "Chapter 9", fields: { pov: "ilse", hook: null } }]
    });
  });
});
