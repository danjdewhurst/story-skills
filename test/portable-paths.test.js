import { describe, expect, test } from "bun:test";
import path from "node:path";
import { exemptionFile, exemptionMatches } from "../src/exemptions.js";
import { portablePath, projectPath } from "../src/files.js";
import { warn } from "../src/findings.js";

// These tests run on every system, so they build Windows paths with
// path.win32 rather than relying on the platform the suite runs on.
describe("portable project paths", () => {
  test("a Windows relative path is shown with forward slashes", () => {
    const root = "C:\\Users\\me\\book";
    const file = "C:\\Users\\me\\book\\chapters\\chapter-01.md";
    expect(path.win32.relative(root, file)).toBe("chapters\\chapter-01.md");
    expect(projectPath(root, file, path.win32)).toBe("chapters/chapter-01.md");
    expect(projectPath(root, "C:\\Users\\me\\book\\worldbuilding\\locations\\harbour.md", path.win32)).toBe("worldbuilding/locations/harbour.md");
  });

  test("a POSIX path is left as it is", () => {
    expect(projectPath("/home/me/book", "/home/me/book/chapters/chapter-01.md", path.posix)).toBe("chapters/chapter-01.md");
    // A backslash is an ordinary file-name character on POSIX systems.
    expect(portablePath("odd\\name.md", "/")).toBe("odd\\name.md");
  });

  test("portablePath converts only the separator it is given, and passes non-strings through", () => {
    expect(portablePath("plot\\arcs\\main.md", "\\")).toBe("plot/arcs/main.md");
    expect(portablePath(null, "\\")).toBeNull();
    expect(portablePath(undefined, "\\")).toBeUndefined();
    expect(portablePath("", "\\")).toBe("");
  });

  test("a registry link from a Windows path uses forward slashes", () => {
    const registry = "C:\\book\\worldbuilding\\_index.md";
    const file = "C:\\book\\worldbuilding\\locations\\harbour.md";
    expect(projectPath(path.win32.dirname(registry), file, path.win32)).toBe("locations/harbour.md");
  });

  test("an exemption written with forward slashes matches a finding about a Windows path", () => {
    const file = projectPath("C:\\book", "C:\\book\\chapters\\chapter-03.md", path.win32);
    const finding = warn("clock-backward", "chapters/chapter-03.md goes back in time", file);
    expect(finding.file).toBe("chapters/chapter-03.md");
    expect(exemptionMatches({ code: "clock-backward", file: exemptionFile("chapters/chapter-03.md") }, finding)).toBe(true);
    expect(exemptionMatches({ code: "clock-backward", file: exemptionFile("chapters\\chapter-03.md") }, finding)).toBe(true);
  });
});
