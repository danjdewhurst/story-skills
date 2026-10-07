import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "./helpers.js";
import {
  auditAssignment,
  filesForShard,
  main,
  parseShardArgs,
  shardPlan,
  testFiles
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

describe("test shards", () => {
  test("the real suite is a partition, and the slowest files take different shards", () => {
    const files = testFiles(testDir);
    expect(files.length).toBeGreaterThan(100);
    expect(files).toEqual([...files].sort());
    const plan = shardPlan(files, 4);
    expect(auditAssignment(files, plan.map((shard) => shard.files))).toEqual([]);
    expect(plan.flatMap((shard) => shard.files).sort()).toEqual(files);
    const slowest = [
      "split-merge.test.js",
      "rename-remove.test.js",
      "undo.test.js",
      "validate-schema-property.test.js"
    ];
    const homes = slowest.map((file) => plan.findIndex((shard) => shard.files.includes(file)));
    expect(new Set(homes).size).toBe(slowest.length);
    const counts = plan.map((shard) => shard.files.length);
    expect(Math.max(...counts)).toBeLessThanOrEqual(Math.min(...counts) * 2);
    expect(shardPlan(files, 4)).toEqual(plan);
  });

  test("a file that is not in the weight table is still assigned", () => {
    const dir = makeTempDir("shards-");
    fs.writeFileSync(path.join(dir, "brand-new.test.js"), "");
    fs.writeFileSync(path.join(dir, "notes.txt"), "");
    fs.mkdirSync(path.join(dir, "nested.test.js"));
    const files = testFiles(dir);
    expect(files).toEqual(["brand-new.test.js"]);
    const plan = shardPlan(files, 4, { "gone.test.js": 100 });
    expect(plan.some((shard) => shard.files.includes("brand-new.test.js"))).toBe(true);
    expect(plan.some((shard) => shard.files.includes("gone.test.js"))).toBe(false);
    expect(auditAssignment(files, plan.map((shard) => shard.files))).toEqual([]);
  });

  test("heavier files spread across shards, and equal weights follow file name", () => {
    const plan = shardPlan(
      ["heavy.test.js", "light.test.js", "other.test.js"],
      2,
      { "heavy.test.js": 100 },
      1
    );
    expect(plan[0].files).toEqual(["heavy.test.js"]);
    expect(plan[1].files).toEqual(["light.test.js", "other.test.js"]);
    const tied = shardPlan(["b.test.js", "a.test.js"], 2, {}, 1);
    expect(tied[0].files).toEqual(["a.test.js"]);
    expect(tied[1].files).toEqual(["b.test.js"]);
  });

  test("a bad weight or shard count is refused", () => {
    expect(() => shardPlan(["a.test.js"], 0)).toThrow(/shard count/);
    expect(() => shardPlan(["a.test.js"], 1.5)).toThrow(/shard count/);
    expect(() => shardPlan(["a.test.js"], 1, { "a.test.js": -1 })).toThrow(/Weight for a\.test\.js/);
    expect(() => shardPlan(["a.test.js"], 1, {}, Number.NaN)).toThrow(/default weight/);
    expect(() => filesForShard(shardPlan(["a.test.js"], 1), 0)).toThrow(/shard must be an integer/);
    expect(() => filesForShard(shardPlan(["a.test.js"], 1), 2)).toThrow(/shard must be an integer/);
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

  test("the CLI prints one shard as repo-relative paths", () => {
    const { code, logs, errors } = capture(["--shards", "4", "--shard", "1"]);
    expect(code).toBe(0);
    expect(errors).toEqual([]);
    const printed = logs[0].split("\n");
    const expected = filesForShard(shardPlan(testFiles(testDir), 4), 1);
    expect(printed).toEqual(expected.map((file) => `test/${file}`));
    expect(printed.every((file) => file.startsWith("test/") && file.endsWith(".test.js"))).toBe(true);
  });

  test("--audit reports the whole directory, and an empty shard fails", () => {
    const audit = capture(["--audit", "--shards", "4"]);
    expect(audit.code).toBe(0);
    expect(audit.logs[0]).toBe(`All ${testFiles(testDir).length} test files are assigned across 4 shards.`);
    const dir = makeTempDir("shards-empty-");
    fs.writeFileSync(path.join(dir, "only.test.js"), "");
    const empty = capture(["--shard", "4", "--shards", "4", "--dir", dir]);
    expect(empty.code).toBe(1);
    expect(empty.errors[0]).toContain("has no test files");
  });

  test("arguments are refused when a shard or a value is missing", () => {
    expect(parseShardArgs(["--audit", "--shards", "4"]).audit).toBe(true);
    expect(parseShardArgs(["--dir", "test", "--shard", "2", "--shards", "4"])).toEqual({
      shard: 2,
      shards: 4,
      audit: false,
      dir: "test"
    });
    for (const argv of [
      ["--shards", "4"],
      ["--shard", "1"],
      ["--shard", "1", "--shards", "4.5"],
      ["--shard"],
      ["--dir"],
      ["--nope"],
      ["--audit", "--shards", "0"]
    ]) {
      const result = capture(argv);
      expect(result.code, argv.join(" ")).toBe(1);
      expect(result.errors[0].length).toBeGreaterThan(0);
    }
  });
});
