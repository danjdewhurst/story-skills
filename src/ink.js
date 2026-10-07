import { softBreak, splitAtSceneBreaks } from "./markdown.js";

// ink source for inkle's ink (Inky, inklecate, inkjs): the title, author,
// and IFID as global tags, then one knot per chapter. A branching book gives
// each chapter its choices as sticky `+ [text] -> knot` lines and ends a
// chapter without choices with `-> END`; a linear book diverts each chapter
// to the next. The prose is left as markdown, like the Twee build.
//
// Escaping follows the ink grammar (inkle's "Writing with ink", checked
// against inklecate): a backslash makes the next character plain text.

// Knot names are ink identifiers: letters, digits, and underscores. Chapter
// ids are kebab-case, so `-` becomes `_`. A name ink rejects (all digits, or
// a reserved word) or one starting with a digit takes a leading `_`. No
// kebab-case id starts with `-`, so an unprefixed name never starts with `_`,
// and the mapping cannot give two chapters one knot.
const INK_RESERVED = new Set(["true", "false", "not", "else", "return", "temp", "function"]);

export function inkKnotName(id) {
  const name = id.replace(/-/g, "_");
  return /^[0-9]/.test(name) || INK_RESERVED.has(name) ? `_${name}` : name;
}

// Characters that mean something anywhere in a line: `\` escapes, `{ } |`
// are logic and alternatives, `#` starts a tag, `[ ]` split choice text,
// `~` is logic (an error inside a choice), `->` diverts, `<-` threads, `<>`
// is glue. `//` and `/*` start comments, which ink strips before parsing,
// so a backslash goes between the two characters.
function inkInline(text) {
  return text
    .replace(/[\\{}|#[\]~]|-(?=>)|<(?=[>-])/g, "\\$&")
    .replace(/\/(?=[/*])/g, "/\\");
}

// At the start of a line `*` and `+` open a choice, `-` a gather, `=` a knot
// or stitch, and INCLUDE, VAR, CONST, LIST, EXTERNAL, and TODO are
// statements. ink drops leading whitespace, so the line starts at its text.
function inkLine(line) {
  const text = inkInline(line.trim());
  return /^[*+\-=]|^(?:INCLUDE|VAR|CONST|LIST|EXTERNAL|TODO)\b/.test(text) ? `\\${text}` : text;
}

// ink prints each source line as a line of its own, so the lines of a
// markdown paragraph are joined, as the other builds read prose: a blank line
// or a scene-break line ends a paragraph, a soft break is a space except
// between Chinese or Japanese characters (see softBreak), and a line ending
// in two spaces or a backslash is a hard break (the backslash dropped) that
// keeps verse on its lines.
const HARD_BREAK = /(?: {2,}|(?:^|[^\\])(?:\\\\)*\\)$/;

function inkProse(body) {
  const out = [];
  for (const paragraph of body.split(/\r?\n[ \t]*(?:\r?\n[ \t]*)*\r?\n/).flatMap(splitAtSceneBreaks)) {
    const lines = paragraph.split(/\r?\n/);
    let current = "";
    lines.forEach((line, index) => {
      const last = index === lines.length - 1;
      const broken = !last && HARD_BREAK.test(line);
      const text = (broken ? line.replace(/\\$/, "") : line).trim();
      current = current === "" ? text : `${current}${softBreak(current, text)}${text}`;
      if (broken || last) {
        out.push(inkLine(current));
        current = "";
      }
    });
    out.push("");
  }
  return out;
}

// A tag runs to the end of its line, so its value is one line.
function inkTag(name, value) {
  return `# ${name}: ${inkInline(value.replace(/\s+/g, " ").trim())}`;
}

// `story` is { title, author, ifid, branching, passages: [{ name, body,
// links }] }, with passage names and each link's `to` as chapter ids.
export function inkSource(story) {
  const lines = [inkTag("title", story.title)];
  if (story.author.trim() !== "") {
    lines.push(inkTag("author", story.author));
  }
  lines.push(inkTag("ifid", story.ifid.toUpperCase()), "", `-> ${inkKnotName(story.passages[0].name)}`, "");
  story.passages.forEach((passage, position) => {
    lines.push(`=== ${inkKnotName(passage.name)} ===`);
    if (passage.body !== "") {
      lines.push(...inkProse(passage.body));
    }
    if (!story.branching) {
      const next = story.passages[position + 1];
      lines.push(`-> ${next ? inkKnotName(next.name) : "END"}`);
    } else if (passage.links.length === 0) {
      lines.push("-> END");
    } else {
      // Sticky choices, like Twine links: a chapter the reader comes back
      // to offers every choice again rather than running out of content.
      for (const link of passage.links) {
        lines.push(`+ [${inkInline(link.text)}] -> ${inkKnotName(link.to)}`);
      }
    }
    lines.push("");
  });
  return `${lines.join("\n").trimEnd()}\n`;
}
