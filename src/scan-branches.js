// Branching stories: a chapter's `choices`, and the chapters as passages
// linked by them.
import { kebabCase } from "./markdown.js";
import { TWEE_LINK_UNSAFE } from "./twee.js";
import { err, warn } from "./findings.js";
import { relative } from "./scan-files.js";

// A chapter's usable `choices` as { text, to } pairs, and the problems
// validate reports for the rest. The text becomes a Twine link, so it may not
// hold link syntax; `to` names the chapter the choice leads to.
export function chapterChoices(chapter, label) {
  const choices = [];
  const problems = [];
  if (chapter.choices === undefined) {
    return { choices, problems };
  }
  if (!Array.isArray(chapter.choices)) {
    problems.push(err("field-not-list", `${label} frontmatter field choices must be a list of { text, to } entries`, label));
    return { choices, problems };
  }
  chapter.choices.forEach((choice, index) => {
    const at = `${label} choices[${index}]`;
    if (!choice || typeof choice !== "object" || Array.isArray(choice)) {
      problems.push(err("invalid-choice", `${at} must have text and to, such as { text: Follow the light, to: chapter-02 }`, label));
      return;
    }
    const text = typeof choice.text === "string" ? choice.text.trim() : "";
    // Not trimmed: move and remove match the id exactly, so a padded
    // `to: "chapter-03 "` would be left behind by them.
    const to = typeof choice.to === "string" ? choice.to : "";
    const before = problems.length;
    if (text === "") {
      problems.push(err("invalid-choice", `${at} needs text: the words the reader picks, quoted if they look like a number`, label));
    } else if (TWEE_LINK_UNSAFE.test(text)) {
      problems.push(err("invalid-choice", `${at} text cannot contain [, ], |, ->, <-, or a line break, or end in <, which Twine reads as link syntax`, label));
    }
    if (to.trim() === "") {
      problems.push(err("invalid-choice", `${at} needs to: the id of the chapter it leads to, such as chapter-02`, label));
    } else if (to !== kebabCase(to)) {
      problems.push(err("id-not-kebab", `${at} to ${to} must be a kebab-case chapter id`, label));
    }
    if (problems.length === before) {
      choices.push({ text, to, index });
    }
  });
  return { choices, problems };
}

// The link from each chapter of a linear book to the next, and the choice a
// split adds in a branching book to lead from the first half to the rest.
export const CONTINUE_CHOICE = "Continue";

// The chapters as passages of a branching story. With no choices anywhere
// the book is linear and each chapter continues to the next; once any
// chapter has choices, a chapter's links are exactly its choices and one
// without them is an ending. Errors name choices that lead nowhere; warnings
// name chapters no path from the first chapter reaches. `problems` are the
// malformed choices validate reports, and `missing` the choices whose chapter
// does not exist.
export function branchGraph(project) {
  const ids = new Set(project.chapters.map((chapter) => chapter.id));
  const parsed = project.chapters.map((chapter) => {
    const label = relative(project, chapter.file);
    return { chapter, label, ...chapterChoices(chapter, label) };
  });
  const branching = parsed.some((entry) => entry.choices.length > 0);
  const problems = parsed.flatMap((entry) => entry.problems);
  const missing = [];
  const warnings = [];
  const passages = parsed.map((entry, position) => {
    if (!branching) {
      const next = project.chapters[position + 1];
      return { chapter: entry.chapter, links: next ? [{ text: CONTINUE_CHOICE, to: next.id }] : [] };
    }
    for (const choice of entry.choices) {
      if (!ids.has(choice.to)) {
        missing.push({ to: choice.to, finding: err("missing-reference", `${entry.label} choices[${choice.index}] references missing chapter ${choice.to}`, entry.label) });
      }
    }
    return { chapter: entry.chapter, links: entry.choices.filter((choice) => ids.has(choice.to)).map(({ text, to }) => ({ text, to })) };
  });
  if (branching) {
    const byId = new Map(passages.map((passage) => [passage.chapter.id, passage]));
    const start = passages[0].chapter.id;
    const reached = new Set([start]);
    const queue = [start];
    while (queue.length > 0) {
      for (const link of byId.get(queue.shift()).links) {
        if (!reached.has(link.to)) {
          reached.add(link.to);
          queue.push(link.to);
        }
      }
    }
    for (const passage of passages) {
      if (!reached.has(passage.chapter.id)) {
        warnings.push(warn("unreachable-chapter", `${relative(project, passage.chapter.file)} cannot be reached: no choice path from ${start} leads to it`, relative(project, passage.chapter.file)));
      }
    }
  }
  return { branching, passages, problems, missing, warnings };
}
