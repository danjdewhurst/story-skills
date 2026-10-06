import { fillLabel, joinNames } from "./languages/index.js";
import { compareText } from "./languages/locale.js";
import { characterCount, flattenHeadings, isSceneBreak, plainLinks, wordCount } from "./markdown.js";

// Audiobook narration script: a pronunciation guide from the bible, opening
// and closing credits, and each section with its estimated finished runtime.
// Emphasis stays marked so the narrator knows where the stress falls. The
// credits are spoken, so they are in the book's language; the rest is the
// narrator's working notes, in English.

export const NARRATION_WORDS_PER_MINUTE = 155;
// For a book counted in characters: Japanese narration runs about 300
// characters a minute (the NHK announcer's pace), Mandarin a little slower,
// and the count includes punctuation, which is not read.
export const NARRATION_CHARACTERS_PER_MINUTE = 300;

// The unit the book is counted in (story.md `count-unit`, else its
// language pack's), which the runtime is timed in.
export function narrationUnit(manuscript) {
  return manuscript?.unit === "characters" ? "characters" : "words";
}

// Units a minute in `unit`: the language pack's `narrationRate`, which is
// in the pack's own count unit (`meta.countUnit`), or the default for the
// unit when the book is counted another way (a German book set to
// `count-unit: characters`) or the pack has no rate.
export function narrationRate(meta, unit = "words") {
  const fallback = unit === "characters" ? NARRATION_CHARACTERS_PER_MINUTE : NARRATION_WORDS_PER_MINUTE;
  return typeof meta?.narrationRate === "number" && (meta.countUnit ?? "words") === unit ? meta.narrationRate : fallback;
}

export function narrationScript(manuscript, guide) {
  const labels = manuscript.meta.labels;
  const unit = narrationUnit(manuscript);
  const rate = narrationRate(manuscript.meta, unit);
  const count = unit === "characters" ? characterCount : wordCount;
  const authors = joinNames(manuscript.meta.authors, labels);
  const narrator = "[narrator]";
  const sections = [
    ...manuscript.front.filter((entry) => !entry.copyright).map((entry) => ({ title: entry.title, body: entry.body })),
    ...manuscript.chapters.map((chapter) => ({ title: chapter.heading, body: chapter.body })),
    ...manuscript.back.map((entry) => ({ title: entry.title, body: entry.body }))
  ].map((section) => ({ ...section, words: count(section.body) }));
  const totalWords = sections.reduce((sum, section) => sum + section.words, 0);

  const lines = [
    `# ${manuscript.title}: Narration Script`,
    "",
    `Estimated finished runtime: ${formatRuntime(totalWords, rate)} at ${rate} ${unit} per minute (${totalWords} ${unit}). Narration pace varies; time a sample chapter and rescale.`,
    "",
    "## Pronunciation Guide",
    ""
  ];
  if (guide.length === 0) {
    lines.push("No pronunciations recorded. Add `pronunciation:` to character, location, system, faction, artifact, and glossary term files.");
  } else {
    lines.push("| Name | Say it | Kind |", "| --- | --- | --- |");
    for (const entry of guide) {
      lines.push(`| ${cell(entry.name)} | ${cell(entry.pronunciation)} | ${entry.kind} |`);
    }
  }
  const credit = (key) => fillLabel(labels, authors === "" ? `${key}-anonymous` : key, { title: manuscript.title, authors, narrator });
  lines.push("", "## Opening Credits", "", withoutDoubledStop(credit("narration-opening"), manuscript.title));
  // Section times are cut from the running total, so they add up to the
  // finished runtime instead of each rounding on its own.
  let wordsSoFar = 0;
  for (const section of sections) {
    const before = Math.round(wordsSoFar / rate);
    wordsSoFar += section.words;
    const minutes = Math.round(wordsSoFar / rate) - before;
    lines.push("", `## ${section.title}`, "", `[${minutes < 1 ? "under 1 min" : `about ${minutes} min`}]`, "", narrationBody(section.body));
  }
  lines.push("", "## Closing Credits", "", credit("narration-closing"), "");
  return lines.join("\n");
}

// A title that ends a sentence itself ("Run!", "Why?") takes no full stop
// after it: the credit's "{title}." opening reads "Run! Written by".
function withoutDoubledStop(text, title) {
  const ending = /[.!?…。！？]["”’')\]」』》]*$/u;
  return text.startsWith(title) && ending.test(title) && /^[.。।]/u.test(text.slice(title.length)) ? `${title}${text.slice(title.length + 1)}` : text;
}

export function pronunciationGuide(project) {
  const guide = [];
  const add = (kind, name, pronunciation) => {
    if (typeof pronunciation === "string" && pronunciation.trim() !== "") {
      guide.push({ kind, name: String(name), pronunciation: pronunciation.trim() });
    }
  };
  project.characters.filter((character) => character.status !== "cut").forEach((character) => add("character", character.name, character.pronunciation));
  project.locations.forEach((location) => add("location", location.name, location.pronunciation));
  project.systems.forEach((system) => add("system", system.name, system.pronunciation));
  project.factions.forEach((faction) => add("faction", faction.name, faction.pronunciation));
  project.artifacts.forEach((artifact) => add("artifact", artifact.name, artifact.pronunciation));
  project.glossaryTerms.forEach((term) => add("term", term.term, term.pronunciation));
  // Names in the story's language order; kinds are fixed English words.
  const compare = compareText(project.pack);
  return guide.sort((left, right) => compare(left.name, right.name) || left.kind.localeCompare(right.kind, "en"));
}

function narrationBody(body) {
  // In-prose headings read as paragraphs, so each chapter stays one
  // section, and links read as their text, as in every other build.
  return flattenHeadings(plainLinks(String(body).replace(/\r\n?/g, "\n")))
    .replace(/\\\n/g, "\n")
    .split(/\n[ \t]*\n\s*/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => (isSceneBreak(paragraph) ? "[pause]" : paragraph))
    .join("\n\n");
}

export function formatRuntime(words, rate = NARRATION_WORDS_PER_MINUTE) {
  const minutes = Math.round(words / rate);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function cell(value) {
  return String(value).replace(/\s+/g, " ").trim().replace(/(\\*)\|/g, "$1$1\\|");
}
