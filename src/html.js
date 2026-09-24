// Single-file HTML builds. The review copy is for readers who never open a
// terminal: every paragraph has a stable anchor (ch03-p12) they can cite.
// The print interior is HTML with CSS paged media, rendered to PDF by a
// paged-media engine such as Paged.js, WeasyPrint, or Prince.

export const TRIM_SIZES = new Map([
  ["5x8", { width: "5in", height: "8in", wordsPerPage: 230 }],
  ["5.25x8", { width: "5.25in", height: "8in", wordsPerPage: 250 }],
  ["5.5x8.5", { width: "5.5in", height: "8.5in", wordsPerPage: 275 }],
  ["6x9", { width: "6in", height: "9in", wordsPerPage: 300 }],
  ["a5", { width: "148mm", height: "210mm", wordsPerPage: 270 }]
]);
export const DEFAULT_TRIM = "5.5x8.5";

// Each part is { key, kind, title, heading, paragraphs } where paragraphs
// are pre-rendered inline HTML strings, or null for a scene break.
export function reviewHtml(book) {
  const toc = [];
  const sections = [];
  for (const part of book.parts) {
    toc.push(`<li><a href="#${part.key}">${escapeHtml(part.title)}</a></li>`);
    const body = [];
    let count = 0;
    for (const paragraph of part.paragraphs) {
      if (paragraph === null) {
        body.push(`<hr class="scene-break" aria-label="Scene break">`);
        continue;
      }
      count += 1;
      const anchor = `${part.key}-p${count}`;
      body.push(`<p id="${anchor}"><a class="anchor" href="#${anchor}" title="Link to ${anchor}">${anchor}</a>${paragraph}</p>`);
    }
    const heading = part.heading ? `<h2>${escapeHtml(part.title)}</h2>` : `<h2 class="visually-hidden">${escapeHtml(part.title)}</h2>`;
    sections.push(`<section id="${part.key}" class="${part.kind}">${heading}\n${body.join("\n")}\n</section>`);
  }
  const byline = book.authors.length === 0 ? "" : `<p class="byline">${escapeHtml(book.authors.join(" and "))}</p>`;
  return `<!DOCTYPE html>
<html lang="${escapeHtml(book.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(book.title)}: review copy</title>
<style>
:root { --bg: #fdfcf8; --fg: #1d1b16; --muted: #6b665c; --rule: #ddd6c8; --accent: #7c3aed; }
@media (prefers-color-scheme: dark) { :root { --bg: #16150f; --fg: #ece8dd; --muted: #a39e92; --rule: #3a372f; --accent: #b794f4; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 1.1rem/1.65 Georgia, "Iowan Old Style", "Palatino Linotype", serif; }
main { max-width: 38rem; margin: 0 auto; padding: 2rem 1rem 6rem; }
header h1 { font-size: 2rem; line-height: 1.2; margin: 2rem 0 0.25rem; }
.byline, .note { color: var(--muted); margin: 0 0 1rem; }
.note { font: 0.9rem/1.5 system-ui, sans-serif; border-left: 3px solid var(--accent); padding-left: 0.75rem; }
nav ol { padding-left: 1.25rem; }
nav a, .anchor { color: var(--accent); }
section { border-top: 1px solid var(--rule); margin-top: 3rem; padding-top: 1rem; }
h2 { font-size: 1.4rem; margin: 1rem 0 1.5rem; }
p { position: relative; margin: 0 0 1rem; }
.anchor { position: absolute; left: -5.5rem; width: 5rem; text-align: right; font: 0.7rem/2.2 system-ui, sans-serif; text-decoration: none; opacity: 0.35; }
p:hover .anchor, p:target .anchor, .anchor:focus { opacity: 1; }
p:target { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.scene-break { border: 0; text-align: center; margin: 2rem 0; }
.scene-break::after { content: "* * *"; color: var(--muted); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media (max-width: 52rem) { .anchor { position: static; display: block; width: auto; text-align: left; line-height: 1.4; opacity: 0.6; } }
</style>
</head>
<body>
<main>
<header>
<h1>${escapeHtml(book.title)}</h1>
${byline}
<p class="note">Review copy. Every paragraph has a label such as <code>ch03-p12</code> (chapter 3, paragraph 12). Quote the label with each note so the author can find the exact spot.</p>
</header>
<nav aria-label="Contents"><h2>Contents</h2><ol>
${toc.join("\n")}
</ol></nav>
${sections.join("\n")}
</main>
</body>
</html>
`;
}

export function printHtml(book, trimName = DEFAULT_TRIM) {
  const trim = TRIM_SIZES.get(trimName);
  if (!trim) {
    throw new Error(`Unsupported trim size: ${trimName}. Supported sizes: ${[...TRIM_SIZES.keys()].join(", ")}`);
  }
  const pages = estimatePages(book.words, trimName);
  const inside = insideMargin(pages);
  const author = book.authors.join(" and ");
  const toc = [];
  const sections = [];
  for (const part of book.parts) {
    const paragraphs = [];
    let first = true;
    for (const paragraph of part.paragraphs) {
      if (paragraph === null) {
        paragraphs.push(`<p class="scene-break" aria-label="Scene break">*&#8195;*&#8195;*</p>`);
        first = true;
        continue;
      }
      paragraphs.push(first ? `<p class="first">${paragraph}</p>` : `<p>${paragraph}</p>`);
      first = false;
    }
    if (part.kind === "chapter") {
      toc.push(`<li><a href="#${part.key}">${escapeHtml(part.title)}</a></li>`);
    }
    const heading = part.heading ? `<h1>${escapeHtml(part.title)}</h1>` : "";
    sections.push(`<section id="${part.key}" class="${part.kind}${part.kind === "chapter" ? "" : ` ${part.placement}`}">${heading}\n${paragraphs.join("\n")}\n</section>`);
  }
  const copyrightIndex = book.parts.findIndex((part) => part.key === "front-copyright");
  const beforeToc = copyrightIndex === -1 ? [] : sections.slice(0, copyrightIndex + 1);
  const afterToc = copyrightIndex === -1 ? sections : sections.slice(copyrightIndex + 1);

  return `<!DOCTYPE html>
<html lang="${escapeHtml(book.language)}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(book.title)}</title>
<!-- Print interior for ${trimName} trim (${trim.width} x ${trim.height}), about ${pages} pages.
     Render to PDF with a CSS paged-media engine, for example:
       npx pagedjs-cli book.print.html -o book.pdf
       weasyprint book.print.html book.pdf
       prince book.print.html -o book.pdf
     Check the printer's current specs for margins, bleed, and fonts before upload. -->
<style>
@page { size: ${trim.width} ${trim.height}; margin: 0.75in 0.5in 0.75in ${inside}; }
@page :left { margin-left: 0.5in; margin-right: ${inside};
  @top-left { content: counter(page); font: 9pt Georgia, serif; }
  @top-center { content: "${cssString(author || book.title)}"; font: italic 9pt Georgia, serif; } }
@page :right {
  @top-right { content: counter(page); font: 9pt Georgia, serif; }
  @top-center { content: string(chapter-title, first-except); font: italic 9pt Georgia, serif; } }
@page :blank { @top-left { content: none; } @top-center { content: none; } @top-right { content: none; } }
@page chapter:first { @top-left { content: none; } @top-center { content: none; } @top-right { content: none; }
  @bottom-center { content: counter(page); font: 9pt Georgia, serif; } }
@page front { @top-left { content: none; } @top-center { content: none; } @top-right { content: none; } }
html { font: 11pt/1.4 Georgia, "Iowan Old Style", "Palatino Linotype", serif; }
body { margin: 0; hyphens: auto; }
.title-page, .toc, section.front { page: front; break-before: right; }
section.front.copyright-page, #front-copyright { break-before: page; font-size: 9pt; }
.title-page { text-align: center; padding-top: 30%; }
.title-page h1 { font-size: 26pt; font-weight: normal; margin: 0 0 1em; }
.title-page .author { font-size: 14pt; font-variant: small-caps; letter-spacing: 0.05em; }
.toc h1 { font-size: 14pt; font-weight: normal; text-align: center; font-variant: small-caps; }
.toc ol { list-style: none; padding: 0; }
.toc a { color: inherit; text-decoration: none; }
.toc a::after { content: " " target-counter(attr(href), page); float: right; }
section.chapter, section.back { page: chapter; break-before: right; }
section.chapter > h1, section.back > h1 { string-set: chapter-title content(text); }
h1 { font-size: 16pt; font-weight: normal; text-align: center; margin: 1.5in 0 0.5in; break-after: avoid; }
p { margin: 0; text-indent: 1.5em; text-align: justify; widows: 2; orphans: 2; }
p.first, p.scene-break + p { text-indent: 0; }
/* A raised initial: floated drop caps render inconsistently across engines. */
section.chapter > h1 + p.first::first-letter { font-size: 2.4em; line-height: 1; }
p.scene-break { text-align: center; text-indent: 0; margin: 0.8em 0; break-after: avoid; }
section.front p, section.back p { text-indent: 0; margin-bottom: 0.6em; text-align: left; }
section.front:not(.copyright-page) p { text-align: center; }
@media screen { body { max-width: ${trim.width}; margin: 2rem auto; padding: 0 1rem; } section { margin-top: 3rem; } }
</style>
</head>
<body>
<section class="title-page"><h1>${escapeHtml(book.title)}</h1>${author === "" ? "" : `<p class="author">${escapeHtml(author)}</p>`}</section>
${beforeToc.join("\n")}
<nav class="toc"><h1>Contents</h1><ol>
${toc.join("\n")}
</ol></nav>
${afterToc.join("\n")}
</body>
</html>
`;
}

export function estimatePages(words, trimName = DEFAULT_TRIM) {
  const trim = TRIM_SIZES.get(trimName) ?? TRIM_SIZES.get(DEFAULT_TRIM);
  return Math.max(1, Math.ceil(words / trim.wordsPerPage));
}

// Longer books need a deeper inside margin so text does not vanish into the
// spine. Bands follow common print-on-demand minimums plus a reading
// allowance; confirm against the printer's current guide.
function insideMargin(pages) {
  if (pages <= 150) {
    return "0.625in";
  }
  if (pages <= 300) {
    return "0.75in";
  }
  if (pages <= 500) {
    return "0.875in";
  }
  return "1in";
}

export function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function cssString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, " ");
}
