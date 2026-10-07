import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "./helpers.js";
import {
  DEFAULT_WEIGHT_SECONDS,
  FILE_WEIGHT_SECONDS,
  auditAssignment,
  main,
  parseShardArgs,
  testFiles,
  timingsDocument
} from "../scripts/test-shards.js";

const repoRoot = path.resolve(import.meta.dir, "..");
const testDir = path.join(repoRoot, "test");

function capture(argv) {
  const logs = [];
  const errors = [];
  const code = main(argv, {
    log: (line) => logs.push(line),
    error: (line) => errors.push(line)
  });
  return { code, logs, errors };
}

// `--update-timings` rewrites the timings file with only the files this
// shard ran. That is a list bun writes on purpose, so it does not change
// with the reporter or the platform the way console output does. A key may
// use either slash; a file outside test/ keeps its path, so the audit
// reports it.
function shardFilesFromTimings(document) {
  return Object.keys(document.files).map((key) => {
    const relative = path.relative(repoRoot, path.resolve(repoRoot, key.replaceAll("\\", "/"))).split(path.sep).join("/");
    return relative.startsWith("test/") && !relative.slice("test/".length).includes("/") ? relative.slice("test/".length) : relative;
  });
}

// Files bun runs for one shard. `--test-name-pattern '^$'` loads each file
// and runs nothing, which is enough to read the assignment. Each shard gets
// its own copy of the timings, since bun rewrites the file it reads.
function bunShardFiles(shard, shards, timingsPath) {
  const shardTimings = path.join(path.dirname(timingsPath), `shard-${shard}.json`);
  fs.copyFileSync(timingsPath, shardTimings);
  const result = spawnSync(
    "bun",
    ["run", "test", "--", `--shard=${shard}/${shards}`, `--timings=${shardTimings}`, "--update-timings", "--test-name-pattern", "^$", "--pass-with-no-tests"],
    { encoding: "utf8", cwd: repoRoot }
  );
  expect(result.status, result.stderr).toBe(0);
  const files = shardFilesFromTimings(JSON.parse(fs.readFileSync(shardTimings, "utf8")));
  expect(files.length).toBeGreaterThan(0);
  expect(new Set(files).size).toBe(files.length);
  return files;
}

describe("test shards", () => {
  test("timings name every test file, and a new file is included", () => {
    const files = testFiles(testDir);
    expect(files.length).toBeGreaterThan(100);
    const document = timingsDocument(files);
    expect(document.version).toBe(1);
    for (const file of files) {
      expect(document.files[`test/${file}`], file).toBeNumber();
      expect(document.files[`test\\${file}`], file).toBe(document.files[`test/${file}`]);
    }
    expect(document.files["test/split-merge.test.js"]).toBe(80500);
    expect(document.files["test\\split-merge.test.js"]).toBe(80500);
    expect(document.files["test/helpers.test.js"]).toBe(DEFAULT_WEIGHT_SECONDS * 1000);

    const dir = makeTempDir("shards-");
    fs.writeFileSync(path.join(dir, "brand-new.test.js"), "");
    fs.writeFileSync(path.join(dir, "notes.txt"), "");
    fs.mkdirSync(path.join(dir, "nested.test.js"));
    expect(testFiles(dir)).toEqual(["brand-new.test.js"]);
    const fresh = timingsDocument(testFiles(dir), { "gone.test.js": 100 });
    expect(fresh.files["test/brand-new.test.js"]).toBe(DEFAULT_WEIGHT_SECONDS * 1000);
    expect(fresh.files["test/gone.test.js"]).toBeUndefined();
  });

  test("a bad weight is refused", () => {
    expect(() => timingsDocument(["a.test.js"], { "a.test.js": -1 })).toThrow(/Weight for a\.test\.js/);
    expect(() => timingsDocument(["a.test.js"], {}, Number.NaN)).toThrow(/default weight/);
  });

  test("auditAssignment reports overlap, a missing file, and an extra file", () => {
    expect(auditAssignment(["a.test.js"], [["a.test.js"], ["a.test.js"]])).toEqual([
      "a.test.js is assigned to shard 1 and shard 2"
    ]);
    expect(auditAssignment(["a.test.js", "b.test.js"], [["a.test.js"]])).toEqual([
      "b.test.js is not assigned to a shard"
    ]);
    expect(auditAssignment(["a.test.js"], [["a.test.js", "c.test.js"]])).toEqual([
      "c.test.js is assigned but is not a test file"
    ]);
  });

  test("reads shard files from either slash, and keeps a path outside test/", () => {
    const document = {
      version: 1,
      files: {
        "test/a.test.js": 1,
        "test\\b.test.js": 1,
        "./test/c.test.js": 1,
        [path.join(repoRoot, "test", "d.test.js")]: 1,
        "plugins/story-skills/test/e.test.js": 1
      }
    };
    expect(shardFilesFromTimings(document)).toEqual([
      "a.test.js",
      "b.test.js",
      "c.test.js",
      "d.test.js",
      "plugins/story-skills/test/e.test.js"
    ]);
  });

  test("bun --shard with these timings runs every test file exactly once", () => {
    const timingsPath = path.join(makeTempDir("shards-timings-"), "timings.json");
    const written = capture(["--write-timings", timingsPath]);
    expect(written.code).toBe(0);
    const files = testFiles(testDir);
    const shards = [1, 2, 3, 4].map((shard) => bunShardFiles(shard, 4, timingsPath));
    expect(auditAssignment(files, shards)).toEqual([]);
    const loads = shards.map((shard) => shard.reduce((sum, file) => sum + (FILE_WEIGHT_SECONDS[file] ?? DEFAULT_WEIGHT_SECONDS), 0));
    const total = loads.reduce((sum, load) => sum + load, 0);
    expect(Math.max(...loads)).toBeLessThan(total * 0.4);
    const slowest = ["split-merge.test.js", "rename-remove.test.js", "undo.test.js", "validate-schema-property.test.js"];
    const homes = new Set(slowest.map((file) => shards.findIndex((shard) => shard.includes(file))));
    expect(homes.size).toBeGreaterThan(1);
  });

  test("the CLI writes timings for every test file", () => {
    const timingsPath = path.join(makeTempDir("shards-cli-"), "nested", "timings.json");
    const written = capture(["--write-timings", timingsPath]);
    expect(written.code).toBe(0);
    expect(written.logs).toEqual([`Wrote timings for ${testFiles(testDir).length} test files to ${timingsPath}`]);
    expect(JSON.parse(fs.readFileSync(timingsPath, "utf8"))).toEqual(timingsDocument(testFiles(testDir)));
  });

  test("arguments are refused when a value is missing", () => {
    expect(parseShardArgs(["--dir", "test", "--write-timings", "out.json"])).toEqual({
      writeTimings: "out.json",
      dir: "test"
    });
    for (const argv of [["--write-timings"], ["--dir"], ["--nope"], ["--audit"], [], ["--dir", "missing-dir", "--write-timings", "out.json"]]) {
      const result = capture(argv);
      expect(result.code, argv.join(" ")).toBe(1);
      expect(result.errors[0].length).toBeGreaterThan(0);
    }
  });
});
