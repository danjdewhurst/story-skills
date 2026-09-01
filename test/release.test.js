import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { bumpVersion, replaceVersion } from "../scripts/release.js";

describe("release script", () => {
  test("bumps patch, minor, and major", () => {
    expect(bumpVersion("0.3.1", "patch")).toBe("0.3.2");
    expect(bumpVersion("0.3.1", "minor")).toBe("0.4.0");
    expect(bumpVersion("0.3.1", "major")).toBe("1.0.0");
  });

  test("accepts an explicit version only when it is greater than the current one", () => {
    expect(bumpVersion("0.3.1", "1.2.3")).toBe("1.2.3");
    expect(() => bumpVersion("0.3.1", "0.3.1")).toThrow("not greater");
    expect(() => bumpVersion("0.3.1", "0.2.9")).toThrow("not greater");
    expect(() => bumpVersion("0.3.1", "banana")).toThrow("Expected patch, minor, major");
    expect(() => bumpVersion("0.3.1-beta", "patch")).toThrow("not a plain MAJOR.MINOR.PATCH");
  });

  test("replaces only the version field and preserves formatting", () => {
    const json = '{\n  "name": "story-skills",\n  "version": "0.3.1",\n  "keywords": ["a", "b"]\n}\n';
    expect(replaceVersion(json, "0.4.0")).toBe('{\n  "name": "story-skills",\n  "version": "0.4.0",\n  "keywords": ["a", "b"]\n}\n');
    expect(() => replaceVersion('{\n  "name": "x"\n}\n', "1.0.0")).toThrow('No top-level "version"');
  });

  test("every release-managed file has a replaceable version field", () => {
    const repoRoot = path.resolve(import.meta.dir, "..");
    for (const relativePath of ["package.json", ".codex-plugin/plugin.json", ".claude-plugin/plugin.json"]) {
      const original = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
      const updated = replaceVersion(original, "9.9.9");
      expect(JSON.parse(updated).version).toBe("9.9.9");
      expect(updated.replace("9.9.9", JSON.parse(original).version)).toBe(original);
    }
  });
});
