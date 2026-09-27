import crypto from "node:crypto";

// Twee 3 source for Twine and Tweego: StoryTitle, StoryData, then one
// passage per chapter, named by its chapter id, with the chapter's choices
// as [[text->target]] links. No story format is named, so Twine uses its
// default and Tweego its default or -f; the prose is left as markdown.

// Characters a Twine link cannot carry in its text: they end the link or
// split it into text and target; a final < would join the -> after it.
export const TWEE_LINK_UNSAFE = /[[\]|\r\n]|->|<-|<$/;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isIfid(value) {
  return typeof value === "string" && UUID_V4.test(value);
}

// A version 4 UUID from a hash of the story id, so every rebuild of the book
// carries the same IFID and two books with different ids never share one.
export function derivedIfid(storyId) {
  const hex = crypto.createHash("sha256").update(`story-skills-ifid:${storyId}`).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const text = hex.join("");
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`.toUpperCase();
}

// Passage text may not start a line with `::`, which opens a passage.
function passageText(text) {
  return text.replace(/^::/gm, "\\::");
}

// `story` is { title, ifid, start, passages: [{ name, body, links }] }, with
// each link { text, to } naming another passage.
export function tweeSource(story) {
  const data = JSON.stringify({ ifid: story.ifid.toUpperCase(), start: story.start }, null, 2);
  const lines = [":: StoryTitle", passageText(story.title), "", ":: StoryData", data, ""];
  for (const passage of story.passages) {
    lines.push(`:: ${passage.name}`);
    if (passage.body !== "") {
      lines.push(passageText(passage.body));
    }
    if (passage.body !== "" && passage.links.length > 0) {
      lines.push("");
    }
    for (const link of passage.links) {
      lines.push(`[[${link.text}->${link.to}]]`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
