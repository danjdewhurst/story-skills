import { parseClockTime } from "./continuity.js";

// Screenplay scene skeleton in Fountain for `build --format fountain`. Prose
// cannot be turned into a screenplay mechanically, so this writes only what
// the records already say: a title page, one section per chapter, and one
// scene heading per scene record (INT./EXT. from `setting`, the location's
// name, and the time of day), with the source scene id, cast, and scene
// notes as Fountain notes and synopses, which screenplay apps do not print.
// The writer drafts action and dialogue under each heading.

// A location or scene `setting` and the scene-heading prefix it gives.
export const SCENE_SETTINGS = new Map([
  ["interior", "INT."],
  ["exterior", "EXT."],
  ["both", "INT./EXT."]
]);

// Named story times read as the screenplay's time of day. An exact HH:MM
// reads as DAY from 06:00 to 17:59 and NIGHT otherwise.
const NAMED_TIMES = new Map([
  ["dawn", "DAWN"],
  ["morning", "MORNING"],
  ["midday", "DAY"],
  ["afternoon", "DAY"],
  ["evening", "EVENING"],
  ["night", "NIGHT"]
]);

const FORM_NOUNS = {
  flash: "story",
  "short-story": "short story",
  novelette: "novelette",
  novella: "novella",
  novel: "novel",
  serial: "serial",
  "picture-book": "picture book",
  "chapter-book": "book"
};

// input: { title, authors, form, chapters: [{ id, heading, scenes: [scene] }] }
// where each scene is { id, title, locationName, setting, time, date,
// cast: [name], dilemma, outcome, flashbackTo, notes: [text] }.
export function fountainScript(input) {
  const lines = [`Title: ${inline(input.title)}`];
  const authors = input.authors.map(inline).filter(Boolean).join(" and ");
  if (authors !== "") {
    lines.push("Credit: Written by", `Author: ${authors}`);
  }
  const noun = FORM_NOUNS[input.form] ?? "book";
  lines.push(`Source: Based on the ${noun}${authors === "" ? "" : ` by ${authors}`}`, "");
  lines.push("[[Scene skeleton built by story build from the scene records. Notes and synopses are not printed. Draft the action and dialogue under each heading, and merge, cut, or reorder scenes as the adaptation needs.]]");

  for (const chapter of input.chapters) {
    lines.push("", `## ${sectionText(chapter.heading)}`);
    if (chapter.scenes.length === 0) {
      lines.push("", `[[No scene records for ${inline(chapter.id)}: add them to outline this chapter.]]`);
    }
    for (const scene of chapter.scenes) {
      lines.push("", sceneHeading(scene), "", `= ${inline(scene.title)}`, "");
      const notes = [`Source: ${inline(scene.id)}`];
      if (scene.cast.length > 0) {
        notes.push(`Characters: ${scene.cast.map((name) => inline(name).toUpperCase()).join(", ")}`);
      }
      const when = [scene.date, scene.time].map(inline).filter(Boolean).join(" ");
      if (when !== "") {
        notes.push(`Story time: ${when}`);
      }
      if (inline(scene.flashbackTo) !== "") {
        notes.push(`Flashback to: ${inline(scene.flashbackTo)}`);
      }
      if (inline(scene.dilemma) !== "") {
        notes.push(`Dilemma: ${inline(scene.dilemma)}`);
      }
      if (inline(scene.outcome) !== "") {
        notes.push(`Outcome: ${inline(scene.outcome)}`);
      }
      notes.push(...scene.notes.map(inline));
      // A note ending in `]` would close early on the first two of `]]]`.
      lines.push(...notes.map((note) => `[[${note.replace(/\]$/, "] ")}]]`));
    }
  }
  return `${lines.join("\n")}\n`;
}

// INT. LAMP ROOM - DUSK. Without a setting there is no honest INT. or EXT.,
// so the heading is forced with a leading period instead.
export function sceneHeading(scene) {
  const place = inline(scene.locationName).toUpperCase() || "LOCATION TBD";
  const time = timeOfDay(scene.time);
  // A trailing #...# is read as a scene number; a heading never ends in #.
  const text = `${place}${time === "" ? "" : ` - ${time}`}`.replace(/[\s#]+$/, "") || "LOCATION TBD";
  const prefix = SCENE_SETTINGS.get(scene.setting);
  if (prefix !== undefined) {
    return `${prefix} ${text}`;
  }
  // Only a single period followed by a letter or digit forces a heading;
  // `..` or `.'` starts an ordinary action line.
  const forced = text.replace(/^[^\p{L}\p{N}]+/u, "");
  return `.${forced === "" ? "LOCATION TBD" : forced}`;
}

export function timeOfDay(value) {
  const text = inline(value);
  const named = NAMED_TIMES.get(text.toLowerCase());
  if (named !== undefined) {
    return named;
  }
  const minutes = parseClockTime(text);
  if (minutes !== undefined) {
    return minutes >= 6 * 60 && minutes < 18 * 60 ? "DAY" : "NIGHT";
  }
  return text.toUpperCase();
}

// One line of Fountain text from a record value: whitespace and control
// characters collapse to single spaces, emphasis markers are escaped, and
// note and boneyard delimiters are broken up, so a name or title can never
// open a note, a boneyard, or emphasis that swallows the rest of the script.
export function inline(value) {
  return String(value ?? "")
    .replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, " ")
    .trim()
    .replace(/[\\*_]/g, "\\$&")
    .replace(/\[(?=\[)/g, "[ ")
    .replace(/\](?=\])/g, "] ");
}

// A section line is `#` markers then text, so the text must not add more.
function sectionText(value) {
  return inline(value).replace(/^#+\s*/, "") || "Untitled";
}
