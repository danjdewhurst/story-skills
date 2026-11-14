// The post build's episodes: one chapter as a serial site or newsletter
// takes it, an HTML fragment to paste (no <head>, no page wrapper, no
// classes or styles a site would strip) and the same text as plain text.
// The prose goes through the builds' paragraph reader (postBody), so
// italics, bold, scene breaks, block quotes, hard line breaks, verse, and
// footnotes match the review copy. Images are left out, since a serial site
// takes them through its own editor. The heading is left out: a serial site
// takes the title in its own field.
import { escapeHtml, withBlockquotes } from "./html.js";
import { fillLabel } from "./languages/index.js";
import { scanComments } from "./markdown.js";
import { postBody } from "./packaging.js";

// What the plain text sets a scene break as when build-style sets none.
export const DEFAULT_TEXT_SCENE_BREAK = "* * *";

// The rule before the footnotes and the author's note in the plain text.
const TEXT_RULE = "---";

// The episode as an HTML fragment: the chapter's own byline, the prose,
// its footnotes under the `footnotes` label, each linked both ways as the
// review copy links them, and the author's note, each after a rule.
// `episode` is { key, byline, body, verse, authorNote, labels }, where
// `key` (the chapter id) names the footnote anchors; an empty episode is
// an empty file.
export function postHtml(episode) {
  const block = (markup) => ({ quote: false, markup });
  const prose = (paragraphs) => paragraphs.map((paragraph) => (paragraph === null ? block("<hr>") : { quote: paragraph.quote, markup: `<p>${paragraph.html}</p>` }));
  const label = (key) => block(`<p><strong>${escapeHtml(fillLabel(episode.labels, key))}</strong></p>`);
  const { paragraphs, notes } = episodeBody(episode);
  const blocks = [];
  if (episode.byline !== "") {
    blocks.push(block(`<p><em>${escapeHtml(episode.byline)}</em></p>`));
  }
  blocks.push(...prose(paragraphs));
  if (notes.length > 0) {
    blocks.push(block("<hr>"), label("footnotes"), ...notes.flatMap((note) => noteTexts(note.html).map((html, index) => block(index === 0
      ? `<p id="${note.id}"><a href="#${note.backlink}">${note.number}.</a> ${html}</p>`
      : `<p>${html}</p>`))));
  }
  if (episode.authorNote !== "") {
    blocks.push(block("<hr>"), label("author-note"), ...prose(postBody(episode.authorNote, { key: `${episode.key}-note` }).paragraphs));
  }
  return blocks.length === 0 ? "" : `${withBlockquotes(blocks).join("\n")}\n`;
}

// The episode as plain text: paragraphs apart by a blank line, a hard break
// as a line break, a quoted paragraph indented four spaces, a scene break
// as `sceneBreak`, and a footnote marker as [n], with the notes numbered
// after the prose. Emphasis marks go, as plain text has none.
export function postText(episode, sceneBreak = DEFAULT_TEXT_SCENE_BREAK) {
  const prose = (paragraphs) => paragraphs.map((paragraph) => {
    if (paragraph === null) {
      return sceneBreak;
    }
    return paragraph.quote ? paragraph.lines.split("\n").map((line) => `    ${line}`).join("\n") : paragraph.lines;
  });
  const { paragraphs, notes } = episodeBody(episode);
  const blocks = [];
  if (episode.byline !== "") {
    blocks.push(episode.byline);
  }
  blocks.push(...prose(paragraphs));
  if (notes.length > 0) {
    blocks.push(TEXT_RULE, fillLabel(episode.labels, "footnotes"), ...notes.flatMap((note) => noteTexts(note.lines).map((text, index) => (index === 0 ? `${note.number}. ${text}` : text))));
  }
  if (episode.authorNote !== "") {
    blocks.push(TEXT_RULE, fillLabel(episode.labels, "author-note"), ...prose(postBody(episode.authorNote, { key: `${episode.key}-note` }).paragraphs));
  }
  return blocks.length === 0 ? "" : `${blocks.join("\n\n")}\n`;
}

// A note's paragraphs, or one empty paragraph for a note with no text, so
// its number still prints.
function noteTexts(paragraphs) {
  return paragraphs.length === 0 ? [""] : paragraphs;
}

// The episode's paragraphs and footnotes: in a verse chapter, every line
// break kept and each stanza a paragraph, as the other builds set a poem.
// Before the notes or an author's note, a scene break that ends the
// chapter goes, so their own rule does not follow another.
function episodeBody(episode) {
  const { paragraphs, notes } = postBody(episode.body, { key: episode.key, verse: episode.verse === true });
  while ((notes.length > 0 || episode.authorNote !== "") && paragraphs.length > 0 && paragraphs[paragraphs.length - 1] === null) {
    paragraphs.pop();
  }
  return { paragraphs, notes };
}

// A chapter's `author-note` as the post build prints it: text, or "" when
// it is unset, blank, or not text (story validate reports that). Comments
// go, as they do from the prose, so a private note never reaches readers.
// LF only, so a CRLF checkout builds the same bytes.
export function authorNoteText(value) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return "";
  }
  return scanComments(String(value).replace(/\r\n?/g, "\n")).text.trim();
}
