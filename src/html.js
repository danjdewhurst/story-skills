// Single-file HTML builds. The review copy is for readers who never open a
// terminal: every paragraph has a label (ch03-p12) they can cite. A label is
// the chapter and the paragraph's position in this build, so an earlier edit
// renumbers it; `stamp` names the build so a note can say which one it means.
// The print interior is HTML with CSS paged media, rendered to PDF by a
// paged-media engine such as Paged.js, WeasyPrint, or Prince.
import { typesetting } from "./typesetting.js";
import { CLASSIC_STYLE, styleFonts } from "./build-style.js";
import { usageError } from "./exit-codes.js";
import { fillLabel } from "./languages/index.js";
import { creditLines, leadNames } from "./publishing.js";
import { wordSpans } from "./words.js";

// Trim sizes and how much text a typical page holds, for the page estimate.
// charactersPerPage is for a book counted in characters (Chinese, Japanese)
// set horizontally in this layout: a full page of the text block, less the
// short lines of dialogue and paragraph ends, as wordsPerPage allows.
export const TRIM_SIZES = new Map([
  ["5x8", { width: "5in", height: "8in", wordsPerPage: 230, charactersPerPage: 480 }],
  ["5.25x8", { width: "5.25in", height: "8in", wordsPerPage: 250, charactersPerPage: 520 }],
  ["5.5x8.5", { width: "5.5in", height: "8.5in", wordsPerPage: 275, charactersPerPage: 580 }],
  ["6x9", { width: "6in", height: "9in", wordsPerPage: 300, charactersPerPage: 640 }],
  ["a5", { width: "148mm", height: "210mm", wordsPerPage: 270, charactersPerPage: 560 }]
]);
export const DEFAULT_TRIM = "5.5x8.5";

// A part's paragraphs with their review-copy labels: `<key>-p<n>`, counting
// prose paragraphs only, so a scene break (null) takes no number. The review
// copy and `story compare --anchor` both label paragraphs with this, so the
// two can never disagree.
export function labelledParagraphs(part) {
  let count = 0;
  return part.paragraphs.map((paragraph) => {
    if (paragraph === null) {
      return null;
    }
    count += 1;
    return { label: `${part.key}-p${count}`, paragraph };
  });
}

// Every labelled paragraph in the book, in reading order, as
// { label, key, text } with the paragraph's plain text.
export function paragraphLabels(book) {
  return book.parts.flatMap((part) => labelledParagraphs(part)
    .filter((entry) => entry !== null)
    .map((entry) => ({ label: entry.label, key: part.key, text: entry.paragraph.text })));
}

// The first few words of a paragraph, with an ellipsis when there are more:
// enough for the author to search for it. A word is a space-separated run
// with a letter or digit in it, or a word of Chinese, Japanese, Thai, Lao,
// Khmer, or Burmese, so those quote a few words rather than the paragraph.
export function openingWords(text, count = 6) {
  const source = String(text);
  const words = wordSpans(source, /\S*[\p{L}\p{N}]\S*/gu);
  const opening = words.length > count ? source.slice(0, words[count].start) : source;
  const collapsed = opening.split(/\s+/).filter((word) => word !== "").join(" ");
  return words.length > count ? `${collapsed}\u2026` : collapsed;
}

// A prefilled link to the note form for one paragraph: the issue title and
// the form's anchor, build, and quote fields.
function noteHref(noteUrl, label, stamp, text) {
  const params = [["title", `[${label}] `], ["anchor", label]];
  if (stamp !== "") {
    params.push(["build", stamp]);
  }
  params.push(["quote", openingWords(text)]);
  const query = params.map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("&");
  // The prefill belongs in the query string, before any #fragment.
  const hash = noteUrl.indexOf("#");
  const base = hash === -1 ? noteUrl : noteUrl.slice(0, hash);
  const fragment = hash === -1 ? "" : noteUrl.slice(hash);
  return `${base}${base.includes("?") ? "&" : "?"}${query}${fragment}`;
}

// Whether a build's stylesheet indents the first line of a paragraph
// itself: the print interior unless build-style asks for block paragraphs,
// the review copy only when it asks for indented ones (see printHtml and
// reviewStyleRules). htmlBook then drops a typed indent rather than add it
// to the build's own.
export function indentsFirstLines(format, style = CLASSIC_STYLE) {
  return format === "print" ? style.paragraphs !== "block" : style.paragraphs === "indented";
}

// Each part is { key, kind, title, heading, words, paragraphs } where each
// paragraph is { html, text, quote } with pre-rendered inline HTML and its
// plain text, or null for a scene break. Consecutive quoted paragraphs share
// one <blockquote>. With `noteUrl`, each label gets a "Note" link to that
// form, prefilled with the label, the stamp, and the paragraph's first words.
// `style` is story.md build-style (build-style.js), with the extra
// stylesheet's text as `cssText`.
export function reviewHtml(book, { stamp = "", noteUrl = "", style = CLASSIC_STYLE } = {}) {
  const labels = book.labels;
  const label = (key, values) => fillLabel(labels, key, values);
  const contents = label("contents");
  const type = typesetting(book.language, book.writingMode);
  const rtl = type.rtl;
  const fonts = styleFonts(style, type);
  const toc = [];
  const sections = [];
  for (const part of book.parts) {
    // Paragraph anchors are `<key>-p<n>`, so a matter section id carries a
    // prefix no anchor has; otherwise matter "note" paragraph 1 and matter
    // "note-p1" would share an id.
    const sectionId = part.kind === "chapter" ? part.key : `matter-${part.key}`;
    toc.push(`<li><a href="#${sectionId}">${escapeHtml(part.title)}</a></li>`);
    const body = [];
    for (const entry of labelledParagraphs(part)) {
      if (entry === null) {
        body.push({ quote: false, markup: `<hr class="scene-break" aria-label="${escapeHtml(label("scene-break"))}">` });
        continue;
      }
      const { label: anchor, paragraph } = entry;
      const note = noteUrl === ""
        ? ""
        : `<a class="note-link" href="${escapeHtml(noteHref(noteUrl, anchor, stamp, paragraph.text))}" title="${escapeHtml(label("note-title", { label: anchor }))}" target="_blank" rel="noopener">${escapeHtml(label("note"))}</a>`;
      body.push({ quote: paragraph.quote, markup: `<p id="${anchor}"><a class="anchor" href="#${anchor}" title="${escapeHtml(label("anchor-title", { label: anchor }))}">${anchor}</a>${note}${paragraph.html}</p>` });
    }
    const heading = part.heading ? `<h2>${escapeHtml(part.title)}</h2>` : `<h2 class="visually-hidden">${escapeHtml(part.title)}</h2>`;
    const partByline = (part.byline ?? "") === "" ? "" : `<p class="byline">${escapeHtml(part.byline)}</p>\n`;
    sections.push(`<section id="${sectionId}" class="${part.kind}">${heading}\n${partByline}${withBlockquotes(body).join("\n")}\n</section>`);
  }
  const byline = bookCredits(book).map((line) => `<p class="byline">${escapeHtml(line)}</p>`).join("\n");
  // The note under the title, a sentence at a time: the labels' text is
  // escaped and the code spans they place are markup.
  const sentence = (key, values) => fillLabel(labels, key, values, escapeHtml);
  const code = (text) => `<code>${escapeHtml(text)}</code>`;
  const intro = joinSentences([
    stamp === "" ? sentence("review-intro") : sentence("review-intro-build", { build: code(stamp) }),
    sentence("review-labels", { label: code("ch03-p12") }),
    sentence(stamp === "" ? "review-quote" : "review-quote-build"),
    noteUrl === "" ? "" : sentence("review-note-link")
  ]);
  return `<!DOCTYPE html>
${htmlRoot(book.language)}
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(label("review-title", { title: book.title }))}</title>
<style>
:root { --bg: #fdfcf8; --fg: #1d1b16; --muted: #6b665c; --rule: #ddd6c8; --accent: #7c3aed; }
@media (prefers-color-scheme: dark) { :root { --bg: #16150f; --fg: #ece8dd; --muted: #a39e92; --rule: #3a372f; --accent: #b794f4; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 1.1rem/1.65 ${fonts.body}; }
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
blockquote { margin: 0 0 1rem; margin-inline-start: 1.5rem; }
.scene-break { border: 0; text-align: center; margin: 2rem 0; }
.scene-break::after { content: "${cssString(style.sceneBreak ?? "* * *")}"; color: var(--muted); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media (max-width: 52rem) { .anchor { position: static; display: block; width: auto; text-align: left; line-height: 1.4; opacity: 0.6; } }
${noteUrl === "" ? "" : `.note-link { position: absolute; left: -5.5rem; top: 1.5rem; width: 5rem; text-align: right; font: 0.7rem/1.4 system-ui, sans-serif; color: var(--accent); text-decoration: none; opacity: 0.35; }
p:hover .note-link, p:target .note-link, .note-link:focus { opacity: 1; }
@media (max-width: 52rem) { .note-link { position: static; display: block; width: fit-content; margin-top: -1.4em; margin-inline-start: auto; opacity: 0.6; } }
`}${rtl ? `[dir="rtl"] .note { border-left: 0; padding-left: 0; border-right: 3px solid var(--accent); padding-right: 0.75rem; }
[dir="rtl"] nav ol { padding-left: 0; padding-right: 1.25rem; }
[dir="rtl"] .anchor { left: auto; right: -5.5rem; text-align: left; }
@media (max-width: 52rem) { [dir="rtl"] .anchor { text-align: right; } }
${noteUrl === "" ? "" : `[dir="rtl"] .note-link { left: auto; right: -5.5rem; text-align: left; }
`}` : ""}${type.vertical ? REVIEW_VERTICAL : ""}${reviewStyleRules(style, type, fonts, hasBylines(book))}</style>
${extraStyle(style)}</head>
<body>
<main>
<header>
<h1>${escapeHtml(book.title)}</h1>
${byline}
<p class="note">${intro}</p>
</header>
<nav aria-label="${escapeHtml(contents)}"><h2>${escapeHtml(contents)}</h2><ol>
${toc.join("\n")}
</ol></nav>
${sections.join("\n")}
</main>
</body>
</html>
`;
}

// The review copy set in vertical columns, right to left: lines run down
// the page, so the reading column becomes a band across it, and spacing,
// rules, and labels move from the top and left to the right and top.
const REVIEW_VERTICAL = `html { writing-mode: vertical-rl; }
main { max-width: none; max-height: 38rem; margin: auto 0; padding: 1rem 2rem 1rem 6rem; }
header h1 { margin: 0; margin-block: 2rem 0.25rem; }
.byline, .note, p { margin: 0; margin-block-end: 1rem; }
.note { border-left: 0; padding-left: 0; border-top: 3px solid var(--accent); padding-top: 0.75rem; }
nav ol { padding-left: 0; padding-top: 1.25rem; }
section { border-top: 0; margin-top: 0; padding-top: 0; border-right: 1px solid var(--rule); margin-right: 3rem; padding-right: 1rem; }
h2 { margin: 0; margin-block: 1rem 1.5rem; }
.anchor, .note-link { position: static; display: block; width: auto; margin: 0; text-align: start; opacity: 0.6; }
blockquote { margin: 0; margin-inline-start: 1.5rem; margin-block-end: 1rem; }
.scene-break { margin: 0 2rem; }
`;

// The print interior set in vertical columns, right to left. The chapter
// sink drops the heading down its column; quotations indent from the top.
const PRINT_VERTICAL = `html { writing-mode: vertical-rl; }
h1 { margin: 1in 0 0 0.5in; }
blockquote { margin: 1.5em 0.8em; }
p.scene-break { margin: 0 0.8em; }
`;

// story.md build-style rules for the review copy, after its own: "" when
// the style leaves every choice to the review copy's defaults.
function reviewStyleRules(style, type, fonts, bylines = false) {
  // A story's byline (chapter `author`) sits between a chapter's heading
  // and its first paragraph, so the rules that start a chapter look past it.
  const opening = bylines ? ["section > h2 + p:not(.byline)", "section > h2 + p.byline + p"] : ["section > h2 + p"];
  const rules = [];
  if (fonts.heading !== null) {
    rules.push(`header h1, section > h2 { font-family: ${fonts.heading}; }`);
  }
  // A byline keeps its own spacing and no first-line indent, whatever the
  // paragraphs below it do.
  if (bylines && style.paragraphs === "indented") {
    rules.push("section > p.byline { text-indent: 0; margin-block-end: 1rem; }");
  }
  const heading = headingRule(style.headingStyle, type);
  if (heading !== "") {
    rules.push(`section > h2 { ${heading} }`);
  }
  if (style.paragraphs === "indented") {
    rules.push(
      "section p { margin-block-end: 0; text-indent: 1.5em; }",
      `${opening.join(", ")}, .scene-break + p, blockquote p, section.front p, section.back p { text-indent: 0; }`,
      "section.front p, section.back p { margin-block-end: 1rem; }"
    );
  }
  if (style.dropCaps === true && type.cased && !type.vertical) {
    // Only beside the margin labels: on a narrow screen a label opens the
    // paragraph and would take the initial.
    rules.push(`@media (min-width: 52.01rem) { ${opening.map((selector) => `section.chapter > ${selector.replace(/^section > /, "")}::first-letter`).join(", ")} { ${DROP_CAP_RULE} } }`);
  }
  return rules.length === 0 ? "" : `${rules.join("\n")}\n`;
}

// The declarations for a heading-style, or "" for the build's own heading.
// `left` sets the heading flush with the start of the line: the right in a
// right-to-left book.
export function headingRule(headingStyle, type) {
  if (headingStyle === "centered") {
    return "text-align: center; font-weight: normal;";
  }
  if (headingStyle === "small-caps") {
    return `text-align: center; font-weight: normal;${type.cased ? " font-variant: small-caps; letter-spacing: 0.08em;" : ""}`;
  }
  if (headingStyle === "left") {
    return `text-align: ${type.rtl ? "right" : "left"}; font-weight: bold;`;
  }
  return "";
}

// A drop cap about three lines deep. Only a script with capitals sets one,
// and every such script runs left to right.
export const DROP_CAP_RULE = "float: left; font-size: 3.2em; line-height: 0.8; margin: 0.08em 0.08em 0 0;";

// The extra stylesheet as a second <style> element, after the build's own
// rules so it can override them.
function extraStyle(style) {
  return style.cssText ? `<style>\n${style.cssText}</style>\n` : "";
}

// story.md build-style rules for the print interior, after its own: ""
// when the style leaves every choice to the interior's defaults.
function printStyleRules(style, type, fonts, bylines = false) {
  const rules = [];
  if (fonts.heading !== null) {
    rules.push(`h1 { font-family: ${fonts.heading}; }`);
  }
  const heading = headingRule(style.headingStyle, type);
  if (heading !== "") {
    rules.push(`section.chapter > h1, section.front > h1, section.back > h1 { ${heading} }`);
  }
  if (style.paragraphs === "block") {
    rules.push(`p { text-indent: 0; ${type.vertical ? "margin-left" : "margin-bottom"}: 0.7em; }`);
  }
  if (style.dropCaps === true && type.cased && !type.vertical) {
    rules.push(`${bylines ? "section.chapter > h1 + p.first::first-letter, section.chapter > h1 + p.byline + p.first::first-letter" : "section.chapter > h1 + p.first::first-letter"} { ${DROP_CAP_RULE} }`);
  }
  return rules.length === 0 ? "" : `${rules.join("\n")}\n`;
}

// `style` is story.md build-style, as for reviewHtml.
export function printHtml(book, trimName = DEFAULT_TRIM, style = CLASSIC_STYLE) {
  const trim = TRIM_SIZES.get(trimName);
  if (!trim) {
    throw usageError(`Unsupported trim size: ${trimName}. Supported sizes: ${[...TRIM_SIZES.keys()].join(", ")}`);
  }
  const pages = estimateBookPages(book, trimName);
  const inside = insideMargin(pages);
  const author = leadNames(bookMeta(book));
  const credits = bookCredits(book);
  const bylines = hasBylines(book);
  // An RTL or vertical book opens from the other side: its recto pages are
  // left-hand pages, so chapters start on the left and the running heads
  // swap. The margins follow the physical page, so the spine side does not
  // change.
  const type = typesetting(book.language, book.writingMode);
  const fonts = styleFonts(style, type);
  const rtl = type.rtl;
  const recto = rtl || type.vertical ? "left" : "right";
  const verso = rtl || type.vertical ? "right" : "left";
  // Running heads are italic, and small caps and the raised initial set,
  // only in a script with capitals and italics to set them in.
  const heads = `${type.cased ? "italic " : ""}9pt ${fonts.heads}`;
  const sceneBreak = style.sceneBreak === null ? "*&#8195;*&#8195;*" : escapeHtml(style.sceneBreak);
  const toc = [];
  const sections = [];
  for (const part of book.parts) {
    const paragraphs = [];
    let first = true;
    for (const paragraph of part.paragraphs) {
      if (paragraph === null) {
        paragraphs.push({ quote: false, markup: `<p class="scene-break" aria-label="${escapeHtml(fillLabel(book.labels, "scene-break"))}">${sceneBreak}</p>` });
        first = true;
        continue;
      }
      paragraphs.push({ quote: paragraph.quote, markup: first ? `<p class="first">${paragraph.html}</p>` : `<p>${paragraph.html}</p>` });
      first = false;
    }
    if (part.kind === "chapter") {
      toc.push(`<li><a href="#${part.key}">${escapeHtml(part.title)}</a></li>`);
    }
    // A back page without a heading still resets the running head, so it
    // does not carry the previous section's title.
    const heading = part.heading
      ? `<h1>${escapeHtml(part.title)}</h1>${(part.byline ?? "") === "" ? "" : `\n<p class="byline">${escapeHtml(part.byline)}</p>`}`
      : part.placement === "back" ? `<div class="running-head" aria-hidden="true"></div>` : "";
    // Matter kinds already carry their placement (front, back copyright-page).
    sections.push(`<section id="${part.key}" class="${part.kind}">${heading}\n${withBlockquotes(paragraphs).join("\n")}\n</section>`);
  }
  // Only the copyright page moves ahead of the contents; other front matter
  // keeps its order after it.
  const copyrightIndex = book.parts.findIndex((part) => part.copyright && part.placement === "front");
  const beforeToc = copyrightIndex === -1 ? [] : [sections[copyrightIndex]];
  const afterToc = sections.filter((_, index) => index !== copyrightIndex);
  // The page number after each contents entry. Left to right, it floats to
  // the right margin; vertical text runs it on after the title. A
  // right-to-left book sets it at the left margin, on the title's last line
  // as the float would be, without a float: WeasyPrint drops a float that
  // follows text on a right-to-left line and does not read
  // `float: inline-end`. The padding keeps a long title clear of it.
  const tocPageNumbers = rtl
    ? `.toc li { position: relative; padding-left: 2.5em; }
.toc a::after { content: target-counter(attr(href), page); position: absolute; left: 0; bottom: 0; }`
    : `.toc a::after { content: " " target-counter(attr(href), page); float: ${type.vertical ? "none" : "right"}; }`;

  return `<!DOCTYPE html>
${htmlRoot(book.language)}
<head>
<meta charset="utf-8">
<title>${escapeHtml(book.title)}</title>
<!-- Print interior for ${trimName} trim (${trim.width} x ${trim.height}), about ${pages} pages.
     Render to PDF with a CSS paged-media engine, for example:
       npx pagedjs-cli book.print.html -o book.pdf
       weasyprint book.print.html book.pdf
       prince book.print.html -o book.pdf
${type.vertical ? "     Vertical text needs an engine that sets it, such as Vivliostyle or Prince.\n" : ""}     Check the printer's current specs for margins, bleed, and fonts before upload. -->
<style>
@page { size: ${trim.width} ${trim.height}; margin: 0.75in 0.5in 0.75in ${inside}; }
@page :left { margin-left: 0.5in; margin-right: ${inside}; }
@page :${verso} {
  @top-center { content: "${cssString(author || book.title)}"; font: ${heads}; } }
@page :${recto} {
  @top-center { content: string(chapter-title, first-except); font: ${heads}; } }
@page chapter { @bottom-center { content: counter(page); font: 9pt ${fonts.heads}; } }
@page :blank { @top-center { content: none; } @bottom-center { content: none; } }
@page front { @top-center { content: none; } @bottom-center { content: none; } }
html { font: 11pt/1.4 ${fonts.body}; }
body { margin: 0; hyphens: auto; }
.title-page, .toc, section.front { page: front; break-before: ${recto}; }
section.front.copyright-page { break-before: page; font-size: 9pt; }
.title-page { text-align: center; padding-top: 30%; }
.title-page h1 { font-size: 26pt; font-weight: normal; margin: 0 0 1em; }
.title-page .author { font-size: 14pt${type.cased ? "; font-variant: small-caps; letter-spacing: 0.05em" : ""}; }
.toc h1 { font-size: 14pt; font-weight: normal; text-align: center${type.cased ? "; font-variant: small-caps" : ""}; }
.toc ol { list-style: none; padding: 0; }
.toc a { color: inherit; text-decoration: none; }
${tocPageNumbers}
section.chapter, section.back { page: chapter; break-before: ${recto}; }
section.chapter > h1, section.back > h1, section.back > .running-head { string-set: chapter-title content(text); }
.running-head { height: 0; margin: 0; }
h1 { font-size: 16pt; font-weight: normal; text-align: center; margin: 1.5in 0 0.5in; break-after: avoid; }
p { margin: 0; text-indent: 1.5em; text-align: justify; widows: 2; orphans: 2; }
p.first, p.scene-break + p { text-indent: 0; }
${bylines ? `p.byline { text-align: center; text-indent: 0; margin: -0.3in 0 0.4in;${type.cased ? " font-style: italic;" : ""} break-after: avoid; }
` : ""}${type.cased && style.dropCaps === null ? `/* A raised initial: floated drop caps render inconsistently across engines. */
${bylines ? "section.chapter > h1 + p.first::first-letter, section.chapter > h1 + p.byline + p.first::first-letter" : "section.chapter > h1 + p.first::first-letter"} { font-size: 2.4em; line-height: 1; }
` : ""}p.scene-break { text-align: center; text-indent: 0; margin: 0.8em 0; break-after: avoid; }
blockquote { margin: 0.8em 1.5em; }
blockquote p { text-indent: 0; text-align: start; }
section.front p, section.back p { text-indent: 0; margin-bottom: 0.6em; text-align: ${rtl ? "right" : "left"}; }
section.front:not(.copyright-page) p { text-align: center; }
@media screen { body { max-width: ${trim.width}; margin: 2rem auto; padding: 0 1rem; } section { margin-top: 3rem; } }
${type.vertical ? `${PRINT_VERTICAL}@media screen { body { max-width: none; max-height: ${trim.height}; margin: auto 2rem; padding: 1rem 0; } section { margin-top: 0; margin-right: 3rem; } }
` : ""}${printStyleRules(style, type, fonts, bylines)}</style>
${extraStyle(style)}</head>
<body>
<section class="title-page"><h1>${escapeHtml(book.title)}</h1>${credits.map((line) => `<p class="author">${escapeHtml(line)}</p>`).join("")}</section>
${beforeToc.join("\n")}
<nav class="toc"><h1>${escapeHtml(fillLabel(book.labels, "contents"))}</h1><ol>
${toc.join("\n")}
</ol></nav>
${afterToc.join("\n")}
</body>
</html>
`;
}

// The book's authors, editors, and labels, as publishing.js reads them.
function bookMeta(book) {
  return { authors: book.authors ?? [], editors: book.editors ?? [], labels: book.labels };
}

// The title page's credit lines: the authors, then "Edited by" the editors.
function bookCredits(book) {
  return creditLines(bookMeta(book));
}

// Whether any chapter prints its own author under its heading.
function hasBylines(book) {
  return book.parts.some((part) => (part.byline ?? "") !== "");
}

// Sentences joined with a space, except after a full stop that carries its
// own spacing (。！？), as Chinese and Japanese set them. Empty ones go.
function joinSentences(sentences) {
  return sentences.filter((sentence) => sentence !== "").reduce((text, sentence) => (text === "" || /[。！？]$/u.test(text) ? `${text}${sentence}` : `${text} ${sentence}`), "");
}

// The root element: `dir="rtl"` for a right-to-left language, since
// browsers and paged-media engines do not infer direction from `lang`.
export function htmlRoot(language) {
  const dir = typesetting(language).rtl ? ` dir="rtl"` : "";
  return `<html lang="${escapeHtml(language)}"${dir}>`;
}

export function estimatePages(words, trimName = DEFAULT_TRIM) {
  const trim = TRIM_SIZES.get(trimName) ?? TRIM_SIZES.get(DEFAULT_TRIM);
  return Math.max(1, Math.ceil(words / trim.wordsPerPage));
}

// The chapter heading's 1.5in sink and heading take about this much of a
// section's first page.
const OPENING_SINK_PAGES = 0.3;
const CONTENTS_ENTRIES_PER_PAGE = 25;

// Pages of the print interior as printHtml lays it out, which sets the
// gutter: the title page and its verso (the copyright page or a blank), the
// contents, and every other section starting on a recto below the heading
// sink, so each rounds up to whole pages and adds half a blank page on
// average. Still an estimate: fonts and the engine decide the real count.
export function estimateBookPages(book, trimName = DEFAULT_TRIM) {
  const trim = TRIM_SIZES.get(trimName) ?? TRIM_SIZES.get(DEFAULT_TRIM);
  // A book counted in characters (`book.unit`) is measured in characters.
  const [perPage, length] = book.unit === "characters" ? [trim.charactersPerPage, (part) => part.characters] : [trim.wordsPerPage, (part) => part.words];
  const chapters = book.parts.filter((part) => part.kind === "chapter").length;
  let pages = 2 + Math.max(1, Math.ceil(chapters / CONTENTS_ENTRIES_PER_PAGE)) + 0.5;
  for (const part of book.parts.filter((entry) => !(entry.copyright && entry.placement === "front"))) {
    const sink = part.heading ? OPENING_SINK_PAGES : 0;
    pages += Math.max(1, Math.ceil((length(part) ?? 0) / perPage + sink)) + 0.5;
  }
  return Math.ceil(pages);
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

// Element markup with each run of quoted paragraphs wrapped in one
// <blockquote>, so a letter of several paragraphs is one quotation.
export function withBlockquotes(items) {
  const out = [];
  let open = false;
  for (const item of items) {
    if (item.quote && !open) {
      out.push("<blockquote>");
    } else if (!item.quote && open) {
      out.push("</blockquote>");
    }
    open = item.quote;
    out.push(item.markup);
  }
  if (open) {
    out.push("</blockquote>");
  }
  return out;
}

export function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// The text of a double-quoted CSS string. A quote or a line break ends the
// string, and CSS reads CR, LF, and form feed all as line breaks, so each
// run of them becomes a space and a quote or backslash is escaped. "<",
// ">", and "&" are hex escapes, so the text cannot close the style element,
// and so is every other control character, so none reaches the stylesheet.
export function cssString(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/</g, "\\3C ")
    .replace(/>/g, "\\3E ")
    .replace(/&/g, "\\26 ")
    .replace(/[\r\n\f]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, (char) => `\\${char.charCodeAt(0).toString(16).toUpperCase()} `);
}
