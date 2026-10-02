import { err, warn } from "./findings.js";
import { checkSet, languagePack } from "./languages/index.js";
import { lowerCase } from "./languages/locale.js";
import { foldLatin, splitWords } from "./markdown.js";
import { editDistance } from "./prose.js";

// Collision check for candidate names before they enter the bible. An exact
// clash with an existing name or alias is an error; look-alikes and a shared
// initial with a major character are warnings, because readers skim names by
// their shape.

const MAJOR_ROLES = new Set(["protagonist", "antagonist", "deuteragonist", "narrator"]);

const NO_WORDS = new Set();

// The first word of a name that is not a title or article ("Lord Maren" is
// known as Maren), or "" when the name is all titles. The titles are the
// language pack's `titleWords`; without them every name keeps its first
// word.
export function givenName(name, pack = languagePack()) {
  const titles = checkSet(pack, "titleWords") ?? NO_WORDS;
  const words = splitWords(String(name));
  const index = words.findIndex((word) => !titles.has(lowerCase(word, pack).replace(/[.’']/g, "")));
  return index === -1 ? "" : words[index];
}

export function existingNames(project) {
  const pack = project.pack ?? languagePack();
  const names = [];
  // `given` marks the one word a reader knows the name by; only character
  // names have one. Every other entry is compared as a whole name.
  const add = (kind, id, name, role = "", given = false, full = name) => {
    if (typeof name === "string" && name.trim() !== "") {
      names.push({ kind, id, name: name.trim(), full: String(full).trim(), role, given });
    }
  };
  for (const character of project.characters) {
    if (character.status === "cut") {
      continue;
    }
    const first = givenName(character.name, pack);
    const single = first !== "" && first === String(character.name).trim();
    add("character", character.id, String(character.name), character.role, single);
    if (first !== "" && !single) {
      add("character", character.id, first, character.role, true, character.name);
    }
    for (const alias of character.aliases ?? []) {
      add("character", character.id, alias, character.role);
    }
  }
  for (const [kind, list] of [["location", project.locations], ["faction", project.factions], ["artifact", project.artifacts], ["system", project.systems]]) {
    for (const entity of list) {
      add(kind, entity.id, String(entity.name));
    }
  }
  for (const term of project.glossaryTerms) {
    add("term", term.id, String(term.term));
    for (const alias of term.aliases ?? []) {
      add("term", term.id, alias);
    }
  }
  return names;
}

export function checkNames(candidates, names, pack = languagePack()) {
  const errors = [];
  const warnings = [];
  const results = [];
  for (const raw of candidates) {
    const candidate = String(raw).trim();
    if (candidate === "") {
      continue;
    }
    const key = normalize(candidate);
    const first = normalize(givenName(candidate, pack));
    const clashes = [];
    const lookalikes = [];
    const initials = [];
    const seen = new Set();
    for (const entry of names) {
      const tag = `${entry.kind} ${entry.id}`;
      const existing = normalize(entry.name);
      if (existing === key || (entry.given && existing === first)) {
        if (!seen.has(`clash ${tag}`)) {
          clashes.push(entry);
          seen.add(`clash ${tag}`);
        }
        continue;
      }
      // A given name is compared word to word; whole names are compared
      // whole, so "The Hollow" is not measured against "The Shadow".
      const alike = entry.given
        ? looksAlike(first, existing)
        : !existing.includes(" ") && !key.includes(" ") && looksAlike(key, existing);
      if (alike && !seen.has(`like ${tag}`)) {
        lookalikes.push(entry);
        seen.add(`like ${tag}`);
      } else if (entry.given && MAJOR_ROLES.has(entry.role) && first !== "" && first[0] === existing[0] && !seen.has(`initial ${entry.id}`)) {
        initials.push(entry);
        seen.add(`initial ${entry.id}`);
      }
    }
    for (const entry of clashes) {
      errors.push(err("name-clash", `"${candidate}" clashes with ${entry.kind} ${entry.id} (${entry.name})`));
    }
    for (const entry of lookalikes) {
      if (!clashes.some((clash) => clash.kind === entry.kind && clash.id === entry.id)) {
        warnings.push(warn("name-look-alike", `"${candidate}" looks like ${entry.kind} ${entry.id} (${entry.full})`));
      }
    }
    for (const entry of initials) {
      if (!clashes.concat(lookalikes).some((other) => other.kind === "character" && other.id === entry.id)) {
        warnings.push(warn("name-shared-initial", `"${candidate}" shares an initial with ${entry.role} ${entry.id} (${entry.full})`));
      }
    }
    results.push({ name: candidate, clashes: clashes.length, lookalikes: lookalikes.length, initials: initials.length });
  }
  return { results, errors, warnings };
}

function looksAlike(left, right) {
  if (left.length < 3 || right.length < 3) {
    return false;
  }
  if (left.slice(0, 4) === right.slice(0, 4) && Math.min(left.length, right.length) >= 4) {
    return true;
  }
  const limit = Math.min(left.length, right.length) >= 5 ? 2 : 1;
  return left[0] === right[0] && editDistance(left, right) <= limit;
}

function normalize(value) {
  return foldLatin(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function formatNames(report) {
  const lines = [];
  for (const result of report.results) {
    const status = result.clashes > 0 ? "taken" : result.lookalikes + result.initials > 0 ? "check" : "clear";
    lines.push(`${result.name}: ${status}`);
  }
  return `${lines.join("\n")}\n`;
}
