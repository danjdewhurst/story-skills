// The post build's episodes: one chapter as a serial site or newsletter
// takes it, an HTML fragment to paste (no <head>, no page wrapper, no
// classes or styles a site would strip) and the same text as plain text.
// The prose goes through the HTML builds' renderer (htmlParagraphs), so
// italics, bold, scene breaks, block quotes, and hard line breaks match
// the review copy. The heading is left out: a serial site takes the title
// in its own field.
import { escapeHtml, withBlockquotes } from "./html.js";
import { fillLabel } from "./languages/index.js";
import { scanComments } from "./markdown.js";
import { htmlParagraphs } from "./packaging.js";

// What the plain text sets a scene break as when build-style sets none.
export const DEFAULT_TEXT_SCENE_BREAK = "* * *";

// The rule between the episode and its author's note in the plain text.
const TEXT_NOTE_RULE = "---";

// The episode as an HTML fragment: the chapter's own byline, the prose, and
// the author's note after a rule under its label. `episode` is
// { byline, body, authorNote, labels }; an empty episode is an empty file.
export function postHtml(episode) {
  const block = (markup) => ({ quote: false, markup });
  const prose = (paragraphs) => paragraphs.map((paragraph) => (paragraph === null ? block("<hr>") : { quote: paragraph.quote, markup: `<p>${paragraph.html}</p>` }));
  const blocks = [];
  if (episode.byline !== "") {
    blocks.push(block(`<p><em>${escapeHtml(episode.byline)}</em></p>`));
  }
  blocks.push(...prose(episodeParagraphs(episode)));
  if (episode.authorNote !== "") {
    blocks.push(block("<hr>"), block(`<p><strong>${escapeHtml(fillLabel(episode.labels, "author-note"))}</strong></p>`), ...prose(htmlParagraphs(episode.authorNote)));
  }
  return blocks.length === 0 ? "" : `${withBlockquotes(blocks).join("\n")}\n`;
}

// The episode as plain text: paragraphs apart by a blank line, a hard break
// as a line break, a quoted paragraph indented four spaces, and a scene
// break as `sceneBreak`. Emphasis marks go, as plain text has none.
export function postText(episode, sceneBreak = DEFAULT_TEXT_SCENE_BREAK) {
  const prose = (paragraphs) => paragraphs.map((paragraph) => {
    if (paragraph === null) {
      return sceneBreak;
    }
    return paragraph.quote ? paragraph.lines.split("\n").map((line) => `    ${line}`).join("\n") : paragraph.lines;
  });
  const blocks = [];
  if (episode.byline !== "") {
    blocks.push(episode.byline);
  }
  blocks.push(...prose(episodeParagraphs(episode)));
  if (episode.authorNote !== "") {
    blocks.push(TEXT_NOTE_RULE, fillLabel(episode.labels, "author-note"), ...prose(htmlParagraphs(episode.authorNote)));
  }
  return blocks.length === 0 ? "" : `${blocks.join("\n\n")}\n`;
}

// The episode's paragraphs. Before an author's note, a scene break that
// ends the chapter goes, so the note's own rule does not follow another.
function episodeParagraphs(episode) {
  const paragraphs = htmlParagraphs(episode.body);
  while (episode.authorNote !== "" && paragraphs.length > 0 && paragraphs[paragraphs.length - 1] === null) {
    paragraphs.pop();
  }
  return paragraphs;
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
