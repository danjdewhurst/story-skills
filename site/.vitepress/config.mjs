// The documentation website. Its pages are the markdown files in ../docs,
// read as they are: the same files render on GitHub and ship in the npm
// package, so nothing here may need a change to them. The rules below make
// plain GitHub markdown safe for VitePress, which compiles each page as a
// Vue template.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";

const REPO = "https://github.com/danjdewhurst/story-skills";
const siteRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const docsRoot = path.resolve(siteRoot, "../docs");
const repoRoot = path.resolve(siteRoot, "..");

// HTML elements the docs may write inline. Anything else that looks like a
// tag, such as `<id>` in a sentence, is text, as GitHub shows it.
const HTML_TAGS = new Set([
  "a", "abbr", "b", "br", "code", "del", "details", "div", "em", "i", "img", "kbd", "mark",
  "p", "picture", "pre", "s", "samp", "small", "source", "span", "strong", "sub", "summary",
  "sup", "table", "tbody", "td", "th", "thead", "tr", "u", "var"
]);

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// A link or image path that leaves docs/ (`../examples/the-last-ember/`,
// `../CHANGELOG.md`) points at the file on GitHub instead.
function outsideDocsUrl(href, env) {
  if (!href || /^[a-z][a-z0-9+.-]*:|^#|^\//i.test(href)) {
    return null;
  }
  const [target, hash] = href.split("#");
  const page = env.realPath ?? env.path ?? path.join(docsRoot, env.relativePath ?? "");
  const resolved = path.resolve(path.dirname(page), decodeURI(target));
  if (resolved === docsRoot || resolved.startsWith(docsRoot + path.sep)) {
    return null;
  }
  const fromRepo = path.relative(repoRoot, resolved).split(path.sep).join("/");
  const kind = target.endsWith("/") ? "tree" : "blob";
  return `${REPO}/${kind}/main/${fromRepo}${target.endsWith("/") ? "/" : ""}${hash === undefined ? "" : `#${hash}`}`;
}

function githubMarkdown(md) {
  // Inline code is printed as written, so `${{ inputs.name }}` is not a
  // Vue interpolation.
  const code = md.renderer.rules.code_inline;
  md.renderer.rules.code_inline = (tokens, index, options, env, self) => code(tokens, index, options, env, self).replace(/^<code/, "<code v-pre");

  // A tag-like word in prose that is not an HTML element is text.
  const inline = md.renderer.rules.html_inline ?? ((tokens, index) => tokens[index].content);
  md.renderer.rules.html_inline = (tokens, index, options, env, self) => {
    const content = tokens[index].content;
    const tag = content.match(/^<\/?([a-z][a-z0-9-]*)/i)?.[1]?.toLowerCase();
    if (tag !== undefined && !HTML_TAGS.has(tag)) {
      return escapeHtml(content);
    }
    return inline(tokens, index, options, env, self);
  };

  // Links and images that leave docs/ go to GitHub.
  md.core.ruler.push("outside-docs-links", (state) => {
    for (const block of state.tokens) {
      for (const token of block.children ?? []) {
        const attribute = token.type === "link_open" ? "href" : token.type === "image" ? "src" : null;
        if (attribute === null) {
          continue;
        }
        const url = outsideDocsUrl(token.attrGet(attribute), state.env);
        if (url !== null) {
          token.attrSet(attribute, attribute === "src" ? url.replace(`${REPO}/blob/`, `${REPO}/raw/`) : url);
        }
      }
    }
  });
}

const guides = [
  { text: "Writers: start here", link: "/writers-start-here" },
  { text: "Getting started", link: "/getting-started" },
  { text: "Core concepts", link: "/concepts" },
  { text: "Writing workflows", link: "/writing-workflows" },
  { text: "Continuity and analysis", link: "/continuity" },
  { text: "Writing in other languages", link: "/languages" },
  { text: "Series", link: "/series" },
  { text: "Import, export, and builds", link: "/manuscripts" },
  { text: "Editor integration", link: "/editors" },
  { text: "Automation and CI", link: "/automation" }
];

const reference = [
  { text: "Skills catalogue", link: "/skills" },
  { text: "CLI reference", link: "/cli-reference" },
  { text: "Project format reference", link: "/project-format" }
];

export default withMermaid(defineConfig({
  title: "Story Skills",
  description: "Plan, track, and draft fiction in markdown, with a continuity checker that catches mistakes before readers do.",
  lang: "en",
  base: process.env.DOCS_BASE ?? "/story-skills/",
  srcDir: "../docs",
  rewrites: { "README.md": "index.md" },
  cleanUrls: true,
  lastUpdated: true,
  head: [["link", { rel: "icon", href: "https://raw.githubusercontent.com/danjdewhurst/story-skills/main/assets/logo.png" }]],
  markdown: {
    config: githubMarkdown
  },
  // The pages live outside this folder, so the modules a compiled page
  // imports resolve from this folder's node_modules.
  vite: {
    resolve: {
      alias: {
        vue: path.join(siteRoot, "node_modules/vue")
      }
    }
  },
  themeConfig: {
    nav: [
      { text: "Getting started", link: "/getting-started" },
      { text: "CLI reference", link: "/cli-reference" },
      { text: "Project format", link: "/project-format" },
      { text: "Changelog", link: `${REPO}/blob/main/CHANGELOG.md` }
    ],
    sidebar: [
      { text: "Overview", items: [{ text: "Documentation home", link: "/" }] },
      { text: "Guides", items: guides },
      { text: "Reference", items: reference },
      { text: "For contributors", items: [{ text: "Development guide", link: "/development" }] }
    ],
    outline: { level: [2, 3] },
    search: { provider: "local" },
    socialLinks: [
      { icon: "github", link: REPO },
      { icon: "npm", link: "https://www.npmjs.com/package/story-skills" }
    ],
    editLink: {
      pattern: `${REPO}/edit/main/docs/:path`,
      text: "Edit this page on GitHub"
    },
    footer: {
      message: "Released under the MIT License.",
      copyright: "Story Skills"
    }
  }
}));
