import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

// The documentation website (site/) builds every page in docs/, but its
// sidebar and nav are written by hand in site/.vitepress/config.mjs, and
// VitePress checks neither. These tests keep them in step with docs/, so a
// new page is never left out of the sidebar and a renamed one never leaves
// a dead entry. The config is read as text: its imports (vitepress) are
// only installed in site/.
const repoRoot = path.join(import.meta.dir, "..");
const config = fs.readFileSync(path.join(repoRoot, "site", ".vitepress", "config.mjs"), "utf8");

// The page a site link names: "/" is the docs index, and "/cli-reference"
// is docs/cli-reference.md.
function pageFile(link) {
  return link === "/" ? "README.md" : `${link.slice(1)}.md`;
}

function siteLinks(source) {
  return [...source.matchAll(/\blink: "(\/[^"]*)"/g)].map((match) => match[1]);
}

describe("docs site", () => {
  const pages = fs.readdirSync(path.join(repoRoot, "docs")).filter((name) => name.endsWith(".md")).sort();
  const sidebar = config.slice(config.indexOf("sidebar: ["), config.indexOf("outline:"));

  test("the sidebar names every page in docs/ once, and no other", () => {
    const groups = config.slice(0, config.indexOf("export default"));
    const linked = [...siteLinks(groups), ...siteLinks(sidebar)].map(pageFile);
    expect([...linked].sort()).toEqual(pages);
    expect(new Set(linked).size).toBe(linked.length);
  });

  test("every nav link names a page in docs/", () => {
    const nav = config.slice(config.indexOf("nav: ["), config.indexOf("sidebar: ["));
    const links = siteLinks(nav);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect({ link, page: pages.includes(pageFile(link)) }).toEqual({ link, page: true });
    }
  });

  test("the site build reads docs/ and the workflow publishes what it builds", () => {
    expect(config).toContain('srcDir: "../docs"');
    const workflow = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "docs-site.yml"), "utf8");
    expect(workflow).toContain("path: site/.vitepress/dist");
    expect(workflow).toContain("npm ci --ignore-scripts");
  });
});
