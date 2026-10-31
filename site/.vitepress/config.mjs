// The documentation website. Its pages are the markdown files in ../docs,
// read as they are: the same files render on GitHub and ship in the npm
// package, so nothing here may need a change to them. The rules below make
// plain GitHub markdown build and behave in VitePress, which compiles each
// page as a Vue template, and keep the page as inert as GitHub shows it:
// raw HTML keeps only safe elements and attributes, and no text or
// attribute is read as Vue.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";

const REPO = "https://github.com/danjdewhurst/story-skills";
const siteRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const docsRoot = path.resolve(siteRoot, "../docs");
const repoRoot = path.resolve(siteRoot, "..");

// HTML elements the docs may write. Anything else that looks like a tag,
// such as `<id>` in a sentence or a `<script>`, is text, as GitHub shows it.
const HTML_TAGS = new Set([
  "a", "abbr", "b", "blockquote", "br", "caption", "cite", "code", "dd", "del", "details", "div", "dl", "dt",
  "em", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li",
  "mark", "ol", "p", "picture", "pre", "q", "s", "samp", "small", "source", "span", "strong", "sub",
  "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul", "var"
]);

// The attributes an allowed element keeps. Event handlers, styles, and Vue
// directives (`v-html`, `:href`, `@click`) are dropped, and a URL must not
// run script.
const ATTRIBUTES = new Set(["align", "alt", "class", "colspan", "dir", "height", "href", "id", "lang", "media", "name", "open", "rowspan", "src", "srcset", "start", "title", "type", "width"]);
const SCRIPT_URL = /^\s*(?:javascript|vbscript|data):/i;

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Each tag in a run of raw HTML: an element the docs may use keeps its safe
// attributes, and anything else is escaped as text. Comments stay.
const RAW_TAG = /<!--[\s\S]*?-->|<\/?([a-z][a-z0-9-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|</gi;
const RAW_ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;

function safeHtml(html) {
  return html.replace(RAW_TAG, (tag, name, attributes = "", selfClosing) => {
    if (tag.startsWith("<!--")) {
      return tag;
    }
    if (name === undefined || !HTML_TAGS.has(name.toLowerCase())) {
      return escapeHtml(tag);
    }
    if (tag.startsWith("</")) {
      return `</${name.toLowerCase()}>`;
    }
    const kept = [];
    for (const [, key, quoted] of attributes.matchAll(RAW_ATTRIBUTE)) {
      const lower = key.toLowerCase();
      const value = quoted === undefined ? "" : quoted.replace(/^["']|["']$/g, "");
      if (!ATTRIBUTES.has(lower) || ((lower === "href" || lower === "src" || lower === "srcset") && SCRIPT_URL.test(value))) {
        continue;
      }
      kept.push(quoted === undefined ? ` ${lower}` : ` ${lower}="${value.replace(/"/g, "&quot;").replace(/\{\{/g, "&#123;&#123;")}"`);
    }
    return `<${name.toLowerCase()}${kept.join("")}${selfClosing ? " /" : ""}>`;
  });
}

// A link or image path that leaves docs/ (`../examples/the-last-ember/`,
// `../CHANGELOG.md`) points at the file on GitHub instead, and a link to
// the docs index (README.md) points at the home page it becomes.
function siteUrl(href, page) {
  if (!href || /^[a-z][a-z0-9+.-]*:|^#|^\//i.test(href)) {
    return null;
  }
  const hashAt = href.indexOf("#");
  const target = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  let resolved;
  try {
    resolved = path.resolve(path.dirname(page), decodeURI(target));
  } catch {
    return null;
  }
  if (resolved === docsRoot || resolved.startsWith(docsRoot + path.sep)) {
    return path.relative(docsRoot, resolved) === "README.md" ? `./index.md${hash}` : null;
  }
  const fromRepo = path.relative(repoRoot, resolved).split(path.sep).join("/");
  // A path outside the repository, such as an example of a link between
  // two story projects, has no file on GitHub to point at.
  if (fromRepo === ".." || fromRepo.startsWith("../")) {
    return null;
  }
  const folder = target.endsWith("/") || fs.statSync(resolved, { throwIfNoEntry: false })?.isDirectory() === true;
  const encoded = encodeURI(fromRepo);
  return `${REPO}/${folder ? "tree" : "blob"}/main/${encoded}${folder && encoded !== "" ? "/" : ""}${hash}`;
}

// GitHub's heading ids, so the docs' own anchors (`#1-download-the-skills`,
// `#defaults-and-severity-from-storymd`) work on the site: lower case,
// punctuation and symbols dropped except `-` and `_`, and each space a `-`.
// The anchor plugin adds `-1`, `-2` to a repeated id, as GitHub does.
function githubSlug(text) {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "").replace(/ /g, "-");
}

function githubMarkdown(md) {
  // Inline code is printed as written, so `${{ inputs.name }}` is not a
  // Vue interpolation.
  const code = md.renderer.rules.code_inline;
  md.renderer.rules.code_inline = (tokens, index, options, env, self) => code(tokens, index, options, env, self).replace(/^<code/, "<code v-pre");

  // `{{` in prose is text too.
  const text = md.renderer.rules.text;
  md.renderer.rules.text = (tokens, index, options, env, self) => text(tokens, index, options, env, self).replace(/\{\{/g, "&#123;&#123;");

  // Raw HTML keeps only safe elements and attributes.
  md.renderer.rules.html_inline = (tokens, index) => safeHtml(tokens[index].content);
  md.renderer.rules.html_block = (tokens, index) => safeHtml(tokens[index].content);

  // Links and images that leave docs/ go to GitHub.
  md.core.ruler.push("site-links", (state) => {
    const page = state.env.realPath ?? state.env.path ?? path.join(docsRoot, state.env.relativePath ?? "");
    for (const block of state.tokens) {
      for (const token of block.children ?? []) {
        const attribute = token.type === "link_open" ? "href" : token.type === "image" ? "src" : null;
        if (attribute === null) {
          continue;
        }
        const url = siteUrl(token.attrGet(attribute), page);
        if (url !== null) {
          token.attrSet(attribute, attribute === "src" ? url.replace(`${REPO}/blob/`, `${REPO}/raw/`) : url);
        }
      }
    }
  });
}

// The sidebar, in the order of the docs index. test/docs-site.test.js
// checks that it names every page in docs/ and no other.
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
    anchor: { slugify: githubSlug },
    config: githubMarkdown
  },
  // A diagram's links and labels cannot run script.
  mermaid: { securityLevel: "strict" },
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
