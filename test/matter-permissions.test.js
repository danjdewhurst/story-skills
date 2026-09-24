import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { createStoryProject, validateProject } from "../src/story.js";
import { makeTempDir, writeMarkdown } from "./helpers.js";

function project(status = "drafting") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Quoted", force: false });
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("status: planning", `status: ${status}`), "utf8");
  return root;
}

function writeEpigraph(root, fields) {
  writeMarkdown(path.join(root, "matter", "epigraph.md"), `title: Epigraph\nplacement: front\nheading: false\n${fields}`, "\nA line of a song.\n");
}

function matterFindings(result) {
  return result.filter((finding) => finding.startsWith("matter/epigraph.md"));
}

describe("matter permissions", () => {
  test("recorded permissions validate cleanly", () => {
    const root = project("complete");
    writeEpigraph(root, "permission: granted\nrights-holder: Tide Music Ltd\ncredit: Lyrics from \"Lamp\" by A. Singer, used by permission.");
    const result = validateProject(root);
    expect(matterFindings(result.errors)).toEqual([]);
    expect(matterFindings(result.warnings)).toEqual([]);
  });

  test("pending permission on a complete story and granted without a holder are warnings", () => {
    const root = project("complete");
    writeEpigraph(root, "permission: pending");
    expect(matterFindings(validateProject(root).warnings)).toEqual(["matter/epigraph.md permission is still pending and the story is complete"]);

    writeEpigraph(root, "permission: granted");
    expect(matterFindings(validateProject(root).warnings)).toEqual(["matter/epigraph.md permission is granted but no rights-holder is recorded"]);

    const drafting = project();
    writeEpigraph(drafting, "permission: pending");
    expect(matterFindings(validateProject(drafting).warnings)).toEqual([]);
  });

  test("unknown permission values and non-text holders are errors", () => {
    const root = project();
    writeEpigraph(root, "permission: maybe\nrights-holder:\n  - A\n  - B");
    expect(matterFindings(validateProject(root).errors)).toEqual([
      "matter/epigraph.md frontmatter field permission has unsupported value maybe",
      "matter/epigraph.md frontmatter field rights-holder must be a scalar"
    ]);
  });
});
