import { editDistance } from "./prose.js";

// Named revision passes kept in story.md `revision-passes`. A revision works
// best as separate passes, each looking for one kind of problem, from the
// largest (structure) to the smallest (proof). The ladder is a default; any
// kebab-case pass name is allowed.

export const PASS_STATUSES = new Set(["pending", "in-progress", "done"]);

export const DEFAULT_PASSES = [
  { pass: "structure", focus: "Order of events, act turns, scenes that do not change anything", checks: ["story timeline", "story pacing", "story diagram arcs"] },
  { pass: "character", focus: "Wants, arcs, motivation, and who knows what when", checks: ["story voices", "story knowledge <id> --at <chapter>", "story diagram relationships"] },
  { pass: "theme", focus: "Premise, counter-premise, motifs, and the lie/truth arc", checks: ["story report"] },
  { pass: "continuity", focus: "Deaths, props, travel, promises, clues, and backlinks", checks: ["story continuity", "story clues", "story links"] },
  { pass: "pacing", focus: "Scene outcomes, sequels, chapter hooks, and chapter lengths", checks: ["story pacing"] },
  { pass: "line", focus: "Sentence-level clarity, rhythm, and distinct voices", checks: ["story prose", "story voices"] },
  { pass: "copyedit", focus: "Spelling, usage, and consistency against the style sheet", checks: ["story prose"] },
  { pass: "proof", focus: "Typos and layout in the built book", checks: ["story build --format print", "story build --format html"] }
];

const DEFAULTS = new Map(DEFAULT_PASSES.map((entry) => [entry.pass, entry]));

export function readPasses(storyData) {
  const raw = storyData["revision-passes"];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.pass === "string")
    .map((entry) => ({ pass: entry.pass, status: typeof entry.status === "string" ? entry.status : "pending" }));
}

export function validatePasses(data, label, errors) {
  const raw = data["revision-passes"];
  if (raw === undefined) {
    return;
  }
  if (!Array.isArray(raw)) {
    errors.push(`${label} frontmatter field revision-passes must be a list`);
    return;
  }
  const seen = new Set();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${label} frontmatter field revision-passes must contain objects`);
      continue;
    }
    if (typeof entry.pass !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.pass)) {
      errors.push(`${label} revision pass ${entry.pass ?? "(missing)"} must be a kebab-case name`);
      continue;
    }
    if (seen.has(entry.pass)) {
      errors.push(`${label} lists revision pass ${entry.pass} more than once`);
    }
    seen.add(entry.pass);
    if (entry.status !== undefined && !PASS_STATUSES.has(entry.status)) {
      errors.push(`${label} revision pass ${entry.pass} has unsupported status ${entry.status}`);
    }
  }
}

// Returns the new pass list for one change: --init adds the missing default
// passes after any existing ones; --start and --done set one pass's status,
// adding it if it is new.
export function updatePasses(passes, change) {
  const next = passes.map((entry) => ({ ...entry }));
  if (change.init) {
    for (const entry of DEFAULT_PASSES) {
      if (!next.some((existing) => existing.pass === entry.pass)) {
        next.push({ pass: entry.pass, status: "pending" });
      }
    }
  }
  for (const [name, status] of [[change.start, "in-progress"], [change.done, "done"]]) {
    if (name === undefined) {
      continue;
    }
    if (typeof name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      throw new Error(`Revision pass names must be kebab-case, got ${name}`);
    }
    const existing = next.find((entry) => entry.pass === name);
    if (existing) {
      existing.status = status;
    } else {
      next.push({ pass: name, status });
    }
  }
  return next;
}

// Notes for passes that --start or --done created: a name outside the
// default ladder may be a typo, so name the closest default pass.
export function addedPassNotes(before, after) {
  const known = new Set(before.map((entry) => entry.pass));
  return after
    .filter((entry) => !known.has(entry.pass) && !DEFAULTS.has(entry.pass))
    .map((entry) => {
      const closest = DEFAULT_PASSES.find((candidate) => editDistance(candidate.pass, entry.pass) <= 2);
      return `Added custom pass ${entry.pass}, which is not in the default ladder${closest ? `; did you mean ${closest.pass}?` : ""}`;
    });
}

export function nextPass(passes) {
  return passes.find((entry) => entry.status === "in-progress") ?? passes.find((entry) => entry.status !== "done") ?? null;
}

// `command` is how the user runs passes on this project, such as
// `story passes` or `story passes drafts/book`.
export function formatPasses(passes, command = "story passes") {
  const lines = [];
  if (passes.length === 0) {
    lines.push(`Revision passes: none recorded. Run ${command} --init to add the default ladder:`, "");
    for (const entry of DEFAULT_PASSES) {
      lines.push(`- ${entry.pass}: ${entry.focus} (${entry.checks.join(", ")})`);
    }
    return `${lines.join("\n")}\n`;
  }
  const done = passes.filter((entry) => entry.status === "done").length;
  lines.push(`Revision passes: ${done} of ${passes.length} done`, "");
  for (const entry of passes) {
    const mark = entry.status === "done" ? "[x]" : entry.status === "in-progress" ? "[~]" : "[ ]";
    const known = DEFAULTS.get(entry.pass);
    const detail = known ? ` - ${known.focus} (${known.checks.join(", ")})` : "";
    lines.push(`${mark} ${entry.pass}${detail}`);
  }
  const upcoming = nextPass(passes);
  lines.push("", upcoming === null ? "All passes done." : `Next: ${upcoming.pass}${upcoming.status === "in-progress" ? " (in progress)" : ""}; mark it with ${command} --done ${upcoming.pass}`);
  return `${lines.join("\n")}\n`;
}
