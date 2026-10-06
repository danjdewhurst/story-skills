import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "./helpers.js";

const repoRoot = path.resolve(import.meta.dir, "..");
const readRepo = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

// The `with:` block directly under each actions/checkout step.
function checkoutBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  lines.forEach((line, index) => {
    if (!/uses: actions\/checkout@/.test(line)) return;
    const indent = line.search(/\S/);
    const block = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      const current = lines[next];
      if (current.trim() === "" || current.search(/\S/) < indent) break;
      if (current.search(/\S/) === indent && !current.trim().startsWith("with:")) break;
      block.push(current.trim());
    }
    blocks.push(block);
  });
  return blocks;
}

// The shell body of the review-copy "Look for chapters" step.
function chapterGuardScript() {
  const text = readRepo("templates/github/review-copy.yml");
  const match = /- name: Look for chapters\n(?:.*\n)*? {8}run: \|\n((?: {10}.*\n)+)/.exec(text);
  expect(match).not.toBeNull();
  return match[1].replace(/^ {10}/gm, "");
}

describe("checkouts drop the token: only draft-next-chapter pushes, with its own (#137, #294)", () => {
  for (const relativePath of [".github/workflows/ci.yml", "templates/github/story-checks.yml", "templates/github/review-copy.yml", "templates/github/draft-next-chapter.yml"]) {
    test(relativePath, () => {
      const blocks = checkoutBlocks(readRepo(relativePath));
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(block).toContain("persist-credentials: false");
      }
    });
  }

});

describe("review copy skips the build until a chapter exists (#140)", () => {
  function runGuard(storyDir) {
    const output = path.join(makeTempDir(), "github-output");
    fs.writeFileSync(output, "");
    const result = spawnSync("bash", ["-c", chapterGuardScript()], {
      encoding: "utf8",
      env: { ...process.env, STORY_DIR: storyDir, GITHUB_OUTPUT: output }
    });
    expect(result.status).toBe(0);
    return fs.readFileSync(output, "utf8").trim();
  }

  test("a fresh project has no chapters and an example does", () => {
    const root = makeTempDir();
    const fresh = path.join(root, "fresh");
    const init = spawnSync(process.execPath, [path.join(repoRoot, "bin", "story.js"), "init", "Fresh", "--dir", fresh], { encoding: "utf8" });
    expect(init.status).toBe(0);
    expect(runGuard(fresh)).toBe("has-chapters=false");
    expect(runGuard(path.join(root, "missing"))).toBe("has-chapters=false");
    expect(runGuard(path.join(repoRoot, "examples", "the-last-ember"))).toBe("has-chapters=true");
  });

  test("build, uploads, and deploy are conditional on chapters", () => {
    const text = readRepo("templates/github/review-copy.yml");
    for (const step of ["Build the review copy", "Keep the review copy as a workflow artifact", "Upload the Pages site"]) {
      expect(text).toContain(`- name: ${step}\n        if: steps.chapters.outputs.has-chapters == 'true'`);
    }
    expect(text).toContain("has-chapters: ${{ steps.chapters.outputs.has-chapters }}");
    expect(text).toContain("needs: build\n    if: needs.build.outputs.has-chapters == 'true'");
    expect(readRepo("docs/automation.md")).toContain("`story build` needs at least one chapter");
  });
});

describe("the packed tarball is smoke-tested (#136)", () => {
  test("ci and publish install and run the packed tarball", () => {
    expect(JSON.parse(readRepo("package.json")).scripts["check:package"]).toBe("node scripts/check-package.js");
    expect(readRepo(".github/workflows/ci.yml")).toContain("run: node scripts/check-package.js");
    const publish = readRepo(".github/workflows/publish.yml");
    expect(publish.indexOf("node scripts/check-package.js")).toBeGreaterThan(0);
    expect(publish.indexOf("node scripts/check-package.js")).toBeLessThan(publish.indexOf("npm publish"));
  });

  test("the check installs the tarball and runs the installed bin", () => {
    const script = readRepo("scripts/check-package.js");
    for (const fragment of ['"pack"', '"install"', '"--version"', '"validate"', "node_modules"]) {
      expect(script).toContain(fragment);
    }
  });
});

describe("series docs say every linked book must be checked out (#242)", () => {
  test("series and automation docs cover the CI checkout", () => {
    expect(readRepo("docs/series.md")).toContain("Every linked book must be on disk at that path");
    const automation = readRepo("docs/automation.md");
    expect(automation).toContain("Every book a linked series names in `follows` or `precedes` must be in the checkout");
    expect(automation).toContain("is not a story project: missing story.md");
  });
});
