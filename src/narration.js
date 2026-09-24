import { wordCount } from "./markdown.js";

// Audiobook narration script: a pronunciation guide from the bible, opening
// and closing credits, and each section with its estimated finished runtime.
// Emphasis stays marked so the narrator knows where the stress falls.

export const NARRATION_WORDS_PER_MINUTE = 155;

export function narrationScript(manuscript, guide) {
  const authors = manuscript.meta.authors.join(" and ");
  const sections = [
    ...manuscript.front.filter((entry) => !entry.copyright).map((entry) => ({ title: entry.title, body: entry.body })),
    ...manuscript.chapters.map((chapter) => ({ title: `Chapter ${chapter.number}: ${chapter.title}`, body: chapter.body })),
    ...manuscript.back.map((entry) => ({ title: entry.title, body: entry.body }))
  ].map((section) => ({ ...section, words: wordCount(section.body) }));
  const totalWords = sections.reduce((sum, section) => sum + section.words, 0);

  const lines = [
    `# ${manuscript.title}: Narration Script`,
    "",
    `Estimated finished runtime: ${formatRuntime(totalWords)} at ${NARRATION_WORDS_PER_MINUTE} words per minute (${totalWords} words). Narration pace varies; time a sample chapter and rescale.`,
    "",
    "## Pronunciation Guide",
    ""
  ];
  if (guide.length === 0) {
    lines.push("No pronunciations recorded. Add `pronunciation:` to character, location, faction, artifact, and glossary term files.");
  } else {
    lines.push("| Name | Say it | Kind |", "| --- | --- | --- |");
    for (const entry of guide) {
      lines.push(`| ${cell(entry.name)} | ${cell(entry.pronunciation)} | ${entry.kind} |`);
    }
  }
  lines.push("", "## Opening Credits", "", `${manuscript.title}.${authors === "" ? "" : ` Written by ${authors}.`} Narrated by [narrator].`);
  for (const section of sections) {
    lines.push("", `## ${section.title}`, "", `[${formatMinutes(section.words)}]`, "", narrationBody(section.body));
  }
  lines.push("", "## Closing Credits", "", `The end. You have been listening to ${manuscript.title}${authors === "" ? "" : `, written by ${authors}`}, narrated by [narrator].`, "");
  return lines.join("\n");
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
  project.factions.forEach((faction) => add("faction", faction.name, faction.pronunciation));
  project.artifacts.forEach((artifact) => add("artifact", artifact.name, artifact.pronunciation));
  project.glossaryTerms.forEach((term) => add("term", term.term, term.pronunciation));
  return guide.sort((left, right) => left.name.localeCompare(right.name, "en") || left.kind.localeCompare(right.kind, "en"));
}

function narrationBody(body) {
  return String(body)
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n\s*/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => (/^([*_-])( ?\1){2,}$/.test(paragraph) ? "[pause]" : paragraph))
    .join("\n\n");
}

export function formatRuntime(words) {
  const minutes = Math.round(words / NARRATION_WORDS_PER_MINUTE);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function formatMinutes(words) {
  const minutes = words / NARRATION_WORDS_PER_MINUTE;
  return minutes < 1 ? "under 1 min" : `about ${Math.round(minutes)} min`;
}

function cell(value) {
  return String(value).replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
}
