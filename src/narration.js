import { fillLabel, joinNames } from "./languages/index.js";
import { compareText } from "./languages/locale.js";
import { characterCount, collapseSourceSpace, flattenHeadings, isSceneBreakLine, plainLinks, separateSceneBreaks, trimSourceSpace, wordCount } from "./markdown.js";

// Audiobook narration script: a pronunciation guide from the bible, opening
// and closing credits, and each section with its estimated finished runtime.
// Emphasis stays marked so the narrator knows where the stress falls. The
// credits, a collection's or anthology's story credits among them, are
// spoken, so they are in the book's language; the rest is the narrator's
// working notes, in English.

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
  // Titles and names each go on one line of the script, so a line break
  // in one cannot start a heading of its own.
  const title = oneLine(manuscript.title);
  const authors = joinNames(manuscript.meta.authors.map(oneLine), labels);
  const narrator = "[narrator]";
  const collection = collectionCredits(manuscript.meta, manuscript.chapters);
  const sections = [
    ...manuscript.front.filter((entry) => !entry.copyright).map((entry) => ({ title: entry.title, body: entry.body, credits: [] })),
    ...manuscript.chapters.map((chapter) => ({ title: chapter.heading, body: chapter.body, credits: collection.story(chapter) })),
    ...manuscript.back.map((entry) => ({ title: entry.title, body: entry.body, credits: [] }))
  ].map((section) => ({ ...section, title: oneLine(section.title), words: count(section.body) }));
  const totalWords = sections.reduce((sum, section) => sum + section.words, 0);

  const lines = [
    `# ${title}: Narration Script`,
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
  const credit = (key) => spokenLabel(labels, authors === "" ? `${key}-anonymous` : key, { title, authors, narrator });
  lines.push("", "## Opening Credits", "", credit("narration-opening"), ...collection.opening.flatMap((line) => ["", line]));
  // Section times are cut from the running total, so they add up to the
  // finished runtime instead of each rounding on its own.
  let wordsSoFar = 0;
  for (const section of sections) {
    const before = Math.round(wordsSoFar / rate);
    wordsSoFar += section.words;
    const minutes = Math.round(wordsSoFar / rate) - before;
    // A story's credit is spoken after its heading. Like the opening and
    // closing credits, it is not prose, so it is left out of the runtime.
    lines.push("", `## ${section.title}`, "", `[${minutes < 1 ? "under 1 min" : `about ${minutes} min`}]`, "", ...section.credits.flatMap((line) => [line, ""]), narrationBody(section.body));
  }
  lines.push("", "## Closing Credits", "", credit("narration-closing"), "");
  return lines.join("\n");
}

// The spoken credits of a collection or anthology, as lines. The opening
// credits add the editors (story.md `editor`) and then the story authors
// (chapter `author`) that neither they nor the book's authors name, each
// once, in reading order, as the EPUB lists its contributors. Each story
// with an author is credited after its heading, unless every story names
// the book's own authors and no one else: such a book is credited once,
// in the opening, like any single-author book.
function collectionCredits(meta, chapters) {
  const labels = meta.labels;
  const authors = meta.authors.map(oneLine);
  const editors = (meta.editors ?? []).map(oneLine);
  const storyAuthors = (chapter) => (chapter.authors ?? []).map(oneLine);
  const own = new Set(authors);
  const credited = new Set([...authors, ...editors]);
  const named = chapters.map(storyAuthors).filter((names) => names.length > 0);
  const sameAsBook = (names) => new Set(names).size === own.size && names.every((name) => own.has(name));
  const speak = !named.every(sameAsBook);
  const contributors = [...new Set(named.flat())].filter((name) => !credited.has(name));
  const line = (key, names) => (names.length === 0 ? [] : [spokenLabel(labels, key, { names: joinNames(names, labels) })]);
  return {
    opening: [...line("narration-edited-by", editors), ...line("narration-contributors", contributors)],
    story: (chapter) => (speak ? line("narration-byline", storyAuthors(chapter)) : [])
  };
}

// A spoken credit: the label filled in, without a doubled stop after a
// value that ends a sentence itself. "{title}. Written by" reads "Run!
// Written by", and "Written by {names}." reads "Written by Martin Luther
// King Jr.".
function spokenLabel(labels, key, values) {
  const ending = /[.!?…。！？]["”’')\]」』》]*$/u;
  const template = fillLabel(labels, key).replace(/\{([a-z]+)\}[.。।]/gu, (match, name) => (ending.test(String(values[name] ?? "")) ? `{${name}}` : match));
  return fillLabel({ [key]: template }, key, values);
}

// A title or name on one line: each run of layout whitespace, line breaks
// included, as one space. Typed spaces, such as French no-break spaces,
// stay.
function oneLine(text) {
  return trimSourceSpace(collapseSourceSpace(text));
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
  const text = flattenHeadings(plainLinks(String(body).replace(/\r\n?/g, "\n")))
    .replace(/\\\n/g, "\n")
    // A line of nothing but whitespace, typed spaces included, is blank, as
    // in the other builds.
    .replace(/^[^\S\n]+$/gm, "");
  // A scene-break line ends a paragraph even with no blank line around it,
  // as in the other builds.
  return separateSceneBreaks(text)
    .split(/\n{2,}/)
    // Typed spaces stay, so a paragraph keeps its ideographic-space indent
    // (see trimSourceSpace): a script has no indent of its own.
    .map(trimSourceSpace)
    .filter((paragraph) => paragraph !== "")
    // A break spaced with typed spaces is still a break.
    .map((paragraph) => (isSceneBreakLine(paragraph) ? "[pause]" : paragraph))
    .join("\n\n");
}

export function formatRuntime(words, rate = NARRATION_WORDS_PER_MINUTE) {
  const minutes = Math.round(words / rate);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function cell(value) {
  return String(value).replace(/\s+/g, " ").trim().replace(/(\\*)\|/g, "$1$1\\|");
}
