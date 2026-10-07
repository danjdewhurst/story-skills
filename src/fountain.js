import { DEFAULT_HOURS_PER_DAY } from "./calendar.js";
import { parseClockTime } from "./continuity.js";
import { fillLabel, joinNames, languagePack } from "./languages/index.js";
import { upperCase } from "./languages/locale.js";

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
// reads as DAY from 06:00 to 17:59 and NIGHT otherwise, or over the same
// middle half of a story calendar's longer or shorter day.
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

// input: { title, authors, form, pack, hoursPerDay, chapters: [{ id, heading, scenes: [scene] }] }
// where each scene is { id, title, locationName, setting, time, date,
// cast: [name], dilemma, outcome, flashbackTo, notes: [text] }, and
// hoursPerDay is the story calendar's (24 when unset).
export function fountainScript(input) {
  // Names and places are capitalised in the story's language (İ in Turkish).
  const pack = input.pack ?? languagePack();
  const lines = [`Title: ${inline(input.title)}`];
  const authors = joinNames(input.authors.map(inline).filter(Boolean), input.labels);
  // The labels' own text is escaped as names are; the names are already.
  const label = (key, values) => fillLabel(input.labels, key, values, escapeText).trim();
  if (authors !== "") {
    lines.push(`Credit: ${label("screenplay-credit")}`, `Author: ${authors}`);
  }
  const form = FORM_NOUNS[input.form] ?? "book";
  lines.push(`Source: ${authors === "" ? label("screenplay-source-anonymous", { form }) : label("screenplay-source", { form, authors })}`, "");
  lines.push("[[Scene skeleton built by story build from the scene records. Notes and synopses are not printed. Draft the action and dialogue under each heading, and merge, cut, or reorder scenes as the adaptation needs.]]");

  for (const chapter of input.chapters) {
    lines.push("", `## ${sectionText(chapter.heading)}`);
    if (chapter.scenes.length === 0) {
      lines.push("", `[[No scene records for ${inline(chapter.id)}: add them to outline this chapter.]]`);
    }
    for (const scene of chapter.scenes) {
      lines.push("", sceneHeading(scene, pack, input.hoursPerDay), "", `= ${inline(scene.title)}`, "");
      const notes = [`Source: ${inline(scene.id)}`];
      if (scene.cast.length > 0) {
        notes.push(`Characters: ${scene.cast.map((name) => upperCase(inline(name), pack)).join(", ")}`);
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
export function sceneHeading(scene, pack = languagePack(), hoursPerDay = DEFAULT_HOURS_PER_DAY) {
  const place = upperCase(inline(scene.locationName), pack) || "LOCATION TBD";
  const time = timeOfDay(scene.time, pack, hoursPerDay);
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

export function timeOfDay(value, pack = languagePack(), hoursPerDay = DEFAULT_HOURS_PER_DAY) {
  const text = inline(value);
  const named = NAMED_TIMES.get(text.toLowerCase());
  if (named !== undefined) {
    return named;
  }
  const minutes = parseClockTime(text, hoursPerDay);
  if (minutes !== undefined) {
    // From a quarter to three quarters of the day: 06:00 to 17:59 of 24.
    const day = hoursPerDay * 60;
    return minutes * 4 >= day && minutes * 4 < day * 3 ? "DAY" : "NIGHT";
  }
  return upperCase(text, pack);
}

// One line of Fountain text from a record value: whitespace and control
// characters collapse to single spaces, emphasis markers are escaped, and
// note and boneyard delimiters are broken up, so a name or title can never
// open a note, a boneyard, or emphasis that swallows the rest of the script.
export function inline(value) {
  return escapeText(String(value ?? "").replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, " ").trim());
}

// inline without the trim, for the text between a label's placeholders.
function escapeText(text) {
  return String(text)
    .replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/[\\*_]/g, "\\$&")
    .replace(/\[(?=\[)/g, "[ ")
    .replace(/\](?=\])/g, "] ");
}

// A section line is `#` markers then text, so the text must not add more.
function sectionText(value) {
  return inline(value).replace(/^#+\s*/, "") || "Untitled";
}
