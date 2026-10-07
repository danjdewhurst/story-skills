// `build --format codex`: the story bible as a static site of linked HTML
// pages, one per character, location, faction, artifact, system, and arc,
// with the timeline, the open threads and clues, and progress. Every page is
// plain HTML and inline CSS, with no script and no external asset, and the
// same sources give the same bytes: no page carries a date.
//
// The codex reads the views other commands print (timeline, clues, grid,
// progress, mentions) rather than working anything out again. Without
// `spoilers`, it leaves out what gives the story away: entity notes,
// statuses, deaths, progressions, knowledge, arc outcomes, clues, and how
// threads resolve. With it, the codex is the author's whole bible.
import { buildClueMatrix } from "./clues.js";
import { buildGrid } from "./grid.js";
import { buildTimeline, povLength } from "./timeline.js";
import { computeProgress, cleanSessions } from "./progress.js";
import { chapterText, findMentions, listedIds, mentionNames } from "./mentions.js";
import { idText } from "./continuity.js";
import { chapterChronology } from "./chronology.js";
import { sortProgressions, progressionEntry } from "./progressions.js";
import { escapeHtml, htmlRoot } from "./html.js";
import { inlineHtml, LINE_BREAK } from "./packaging.js";
import { typesetting } from "./typesetting.js";
import { chapterByline, creditLines, nameList, publishingMeta } from "./publishing.js";
import { fillLabel } from "./languages/index.js";
import { plainLinks, scanComments } from "./markdown.js";
import { asArray, readMarkdown } from "./scan.js";

// The entity kinds with a page each, in the order the index lists them.
// `dir` is the page folder, which matches the project folder's last part;
// `title` is the label key of the kind's plural name.
export const CODEX_KINDS = [
  { kind: "character", dir: "characters", title: "codex-characters", list: (project) => project.characters },
  { kind: "location", dir: "locations", title: "codex-locations", list: (project) => project.locations },
  { kind: "faction", dir: "factions", title: "codex-factions", list: (project) => project.factions },
  { kind: "artifact", dir: "artifacts", title: "codex-artifacts", list: (project) => project.artifacts },
  { kind: "system", dir: "systems", title: "codex-systems", list: (project) => project.systems },
  { kind: "arc", dir: "arcs", title: "codex-arcs", list: (project) => project.arcs }
];

// The pages that are not entities, as the header links them, with the
// label key of each page's name.
const SECTION_PAGES = [
  { file: "index.html", title: "codex-story-bible" },
  { file: "timeline.html", title: "codex-timeline" },
  { file: "threads.html", title: "codex-threads" },
  { file: "progress.html", title: "codex-progress" }
];

// Every page of the codex as { path, html }, sorted by path. `path` is
// relative to the codex folder, with forward slashes.
export function codexPages(project, { spoilers = false } = {}) {
  const meta = publishingMeta(project.story.data);
  const site = {
    project,
    spoilers,
    title: project.title,
    // The title page's credits: the authors, then "Edited by" the editors.
    credits: creditLines(meta),
    language: meta.language,
    // The book's build labels (see buildLabels), so the codex speaks its
    // language and story.md `labels` can reword it.
    labels: meta.labels,
    type: typesetting(meta.language),
    chapters: [...project.chapters].sort((left, right) => left.number - right.number || left.id.localeCompare(right.id, "en")),
    entities: new Map(CODEX_KINDS.map((entry) => [entry.kind, new Map(entry.list(project).map((entity) => [entity.id, entity]))])),
    grid: buildGrid(project)
  };
  site.chapterById = new Map(site.chapters.map((chapter) => [chapter.id, chapter]));
  site.appearances = appearances(project, site);
  site.references = references(project, site);

  const pages = [
    { path: "index.html", html: indexPage(site) },
    { path: "timeline.html", html: timelinePage(site) },
    { path: "threads.html", html: threadsPage(site) },
    { path: "progress.html", html: progressPage(site) }
  ];
  for (const entry of CODEX_KINDS) {
    for (const entity of site.entities.get(entry.kind).values()) {
      pages.push({ path: `${entry.dir}/${entity.id}.html`, html: entityPage(site, entry, entity) });
    }
  }
  return pages.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

// The chapters each entity appears in: listed in a chapter's or scene's
// frontmatter, or named in a drafted chapter's prose (as `story mentions`
// finds them), and for an arc, advanced there (as `story grid` reads it).
function appearances(project, site) {
  const found = new Map();
  const add = (kind, id, chapterId) => {
    if (!site.entities.get(kind)?.has(id) || !site.chapterById.has(chapterId)) {
      return;
    }
    const key = `${kind} ${id}`;
    found.set(key, (found.get(key) ?? new Set()).add(chapterId));
  };
  const names = mentionNames(project);
  for (const chapter of site.chapters) {
    for (const kind of ["character", "location", "artifact"]) {
      for (const id of listedIds(chapter, kind)) {
        add(kind, idText(id), chapter.id);
      }
    }
    if (chapter.status === "outline") {
      continue;
    }
    const prose = chapterText(project, chapter);
    for (const mention of prose === null ? [] : findMentions(prose.text, names)) {
      // A name two entities share does not say which one is meant.
      if (mention.entities.length === 1) {
        add(mention.entities[0].kind, mention.entities[0].id, chapter.id);
      }
    }
  }
  for (const scene of project.scenes) {
    [scene.pov, ...scene.characters].forEach((id) => add("character", idText(id), scene.chapter));
    add("location", idText(scene.location), scene.chapter);
  }
  for (const row of site.grid.rows) {
    site.grid.chapters.forEach((chapter, index) => {
      if (row.cells[index]) {
        add("arc", row.id, chapter.id);
      }
    });
  }
  // In reading order.
  const order = new Map(site.chapters.map((chapter, index) => [chapter.id, index]));
  return new Map([...found].map(([key, ids]) => [key, [...ids].sort((left, right) => order.get(left) - order.get(right))]));
}

// Backlinks: for each entity, the entity pages that name it in a linked
// field, so a location page lists the characters who frequent it.
function references(project, site) {
  const backlinks = new Map();
  const add = (kind, id, fromKind, fromId) => {
    if (!site.entities.get(kind)?.has(id) || (kind === fromKind && id === fromId)) {
      return;
    }
    const key = `${kind} ${id}`;
    const list = backlinks.get(key) ?? [];
    if (!list.some((entry) => entry.kind === fromKind && entry.id === fromId)) {
      list.push({ kind: fromKind, id: fromId });
    }
    backlinks.set(key, list);
  };
  for (const entry of CODEX_KINDS) {
    for (const entity of site.entities.get(entry.kind).values()) {
      for (const field of linkedFields(site, entry.kind, entity)) {
        field.ids.forEach((id) => add(field.kind, id, entry.kind, entity.id));
      }
    }
  }
  return backlinks;
}

// The fields of an entity that name other entities, as { label, kind, ids },
// with `label` a label key.
// Spoiler fields (an artifact's owner and location) count only with spoilers.
function linkedFields(site, kind, entity) {
  const ids = (value) => asArray(value).map(idText).filter((id) => id !== "");
  if (kind === "character") {
    return [
      { label: "codex-relationships", kind: "character", ids: entity.relationships.map((entry) => idText(entry?.character)).filter((id) => id !== "") },
      { label: "codex-locations", kind: "location", ids: ids(entity.locations) }
    ];
  }
  if (kind === "location") {
    return [
      { label: "codex-notable-characters", kind: "character", ids: ids(entity.notableCharacters) },
      { label: "codex-routes", kind: "location", ids: entity.routes.map((route) => idText(route?.to)).filter((id) => id !== "") }
    ];
  }
  if (kind === "faction") {
    return [
      { label: "codex-members", kind: "character", ids: ids(entity.members) },
      { label: "codex-locations", kind: "location", ids: ids(entity.locations) }
    ];
  }
  if (kind === "artifact") {
    return site.spoilers
      ? [{ label: "codex-owner", kind: "character", ids: ids(entity.owner) }, { label: "codex-location", kind: "location", ids: ids(entity.location) }]
      : [];
  }
  if (kind === "arc") {
    return [{ label: "codex-characters", kind: "character", ids: ids(entity.characters) }];
  }
  return [];
}

// ---------------------------------------------------------------- pages

function indexPage(site) {
  const { project } = site;
  const sections = CODEX_KINDS.map((entry) => {
    const entities = [...site.entities.get(entry.kind).values()];
    if (entities.length === 0) {
      return "";
    }
    const items = entities.map((entity) => {
      const detail = summaryLine(site, entry.kind, entity);
      return `<li>${entityLink(site, entry.kind, entity.id, 0)}${detail === "" ? "" : ` <span class="muted">${escapeHtml(detail)}</span>`}</li>`;
    });
    return `<section id="${entry.dir}"><h2>${label(site, entry.title)} <span class="count">${entities.length}</span></h2>\n<ul class="entities">\n${items.join("\n")}\n</ul></section>`;
  }).filter((section) => section !== "");
  const counts = [
    ["codex-chapters", project.chapters.length],
    ["codex-scenes", project.scenes.length],
    ...CODEX_KINDS.map((entry) => [entry.title, site.entities.get(entry.kind).size]),
    ["codex-questions", project.questions.length],
    ["codex-promises", project.promises.length],
    ...(site.spoilers ? [["codex-clues", project.clues.length]] : [])
  ];
  const synopsis = typeof project.story.data.synopsis === "string" ? project.story.data.synopsis.trim() : "";
  const body = [
    `<h1>${escapeHtml(site.title)}</h1>`,
    ...site.credits.map((line) => `<p class="byline">${escapeHtml(line)}</p>`),
    synopsis === "" || !site.spoilers ? "" : `<p>${inlineHtml(synopsis)}</p>`,
    `<p class="note">${site.spoilers ? label(site, "codex-note-spoilers") : label(site, "codex-note-safe", { flag: "<code>--spoilers</code>" })}</p>`,
    `<table class="facts"><tbody>\n${counts.map(([key, count]) => `<tr><th scope="row">${label(site, key)}</th><td>${count}</td></tr>`).join("\n")}\n</tbody></table>`,
    ...sections,
    sections.length === 0 ? `<p>${label(site, "codex-no-entities")}</p>` : ""
  ];
  return page(site, "index.html", site.title, body);
}

function entityPage(site, entry, entity) {
  const path = `${entry.dir}/${entity.id}.html`;
  const depth = 1;
  const name = displayName(entity);
  const facts = factRows(site, entry.kind, entity, depth);
  const body = [
    `<p class="kind">${kindName(site, entry.kind)}</p>`,
    `<h1>${escapeHtml(name)}</h1>`,
    facts.length === 0 ? "" : `<table class="facts"><tbody>\n${facts.map(([field, value]) => `<tr><th scope="row">${field}</th><td>${value}</td></tr>`).join("\n")}\n</tbody></table>`
  ];
  if (entry.kind === "character" && entity.relationships.length > 0) {
    const items = entity.relationships
      .filter((relation) => relation && typeof relation === "object" && idText(relation.character) !== "")
      .map((relation) => `<li>${entityLink(site, "character", idText(relation.character), depth)}${relation.type === undefined ? "" : ` <span class="muted">${escapeHtml(String(relation.type))}</span>`}</li>`);
    if (items.length > 0) {
      body.push(`<h2>${label(site, "codex-relationships")}</h2>\n<ul>\n${items.join("\n")}\n</ul>`);
    }
  }
  const chapters = site.appearances.get(`${entry.kind} ${entity.id}`) ?? [];
  if (chapters.length > 0) {
    const heading = label(site, entry.kind === "arc" ? "codex-advanced-in" : "codex-appears-in");
    body.push(`<h2>${heading}</h2>\n<ol class="chapters">\n${chapters.map((id) => `<li>${chapterLabel(site, id)}</li>`).join("\n")}\n</ol>`);
  }
  const backlinks = site.references.get(`${entry.kind} ${entity.id}`) ?? [];
  if (backlinks.length > 0) {
    const sorted = [...backlinks].sort((left, right) => kindOrder(left.kind) - kindOrder(right.kind) || left.id.localeCompare(right.id, "en"));
    body.push(`<h2>${label(site, "codex-linked-from")}</h2>\n<ul>\n${sorted.map((ref) => `<li>${entityLink(site, ref.kind, ref.id, depth)} <span class="muted">${kindName(site, ref.kind)}</span></li>`).join("\n")}\n</ul>`);
  }
  if (site.spoilers) {
    body.push(...spoilerSections(site, entry.kind, entity));
  }
  return page(site, path, name, body);
}

// Progressions, knowledge, and the entity file's own notes.
function spoilerSections(site, kind, entity) {
  const sections = [];
  const progressions = Array.isArray(entity.frontmatter?.progressions) ? entity.frontmatter.progressions : [];
  const changes = sortProgressions(progressions, chapterChronology(site.project)).map(progressionEntry).filter((change) => change !== null);
  if (changes.length > 0) {
    sections.push(`<h2>${label(site, "codex-changes")}</h2>\n<ul>\n${changes.map((change) => `<li>${label(site, "codex-change", { chapter: chapterLabel(site, change.from), field: escapeHtml(change.field), value: escapeHtml(plainValue(change.value)) })}</li>`).join("\n")}\n</ul>`);
  }
  if (kind === "character") {
    const knowledge = asArray(site.project.continuity?.data["knowledge-state"])
      .filter((entry) => entry && typeof entry === "object" && idText(entry.character) === entity.id && String(entry.knows ?? "").trim() !== "");
    if (knowledge.length > 0) {
      const items = knowledge.map((entry) => {
        const learned = idText(entry["learned-in"]);
        return `<li>${escapeHtml(String(entry.knows).trim())} <span class="muted">${learned === "" ? label(site, "codex-known-from-start") : label(site, "codex-learned-in", { chapter: chapterLabel(site, learned) })}</span></li>`;
      });
      sections.push(`<h2>${label(site, "codex-knows")}</h2>\n<ul>\n${items.join("\n")}\n</ul>`);
    }
  }
  const notes = notesHtml(site, entity);
  if (notes !== "") {
    sections.push(`<h2>${label(site, "codex-notes")}</h2>\n<div class="notes">\n${notes}\n</div>`);
  }
  return sections;
}

function timelinePage(site) {
  const timeline = buildTimeline(site.project);
  const row = (entry) => {
    const flags = [entry.toldLate ? label(site, "codex-told-late") : "", entry.flashbackTo === "" ? "" : label(site, "codex-flashback", { date: escapeHtml(entry.flashbackTo) })].filter(Boolean).join("; ");
    return `<tr><td>${escapeHtml(entry.date)}</td><td>${escapeHtml(entry.time)}</td><td>${escapeHtml(String(entry.title))}</td><td>${chapterLabel(site, entry.orphanOf || (typeof entry.chapterNumber === "number" ? chapterIdOf(site, entry.chapterNumber) : entry.chapterNumber))}</td><td>${entry.pov === "" ? "" : entityLink(site, "character", entry.pov, 0)}</td><td>${entry.location === "" ? "" : entityLink(site, "location", idText(entry.location), 0)}</td><td>${flags}</td></tr>`;
  };
  const head = `<thead><tr>${columns(site, ["codex-date", "codex-time", "codex-scene", "codex-chapter", "codex-pov", "codex-location", "codex-notes"])}</tr></thead>`;
  const body = [`<h1>${label(site, "codex-timeline")}</h1>`];
  if (timeline.chronology.length === 0) {
    body.push(`<p>${label(site, "codex-no-dates", { field: "<code>date</code>" })}</p>`);
  } else {
    body.push(`<p class="note">${label(site, "codex-timeline-note", { command: "<code>story timeline</code>" })}</p>`, `<div class="scroll"><table>${head}<tbody>\n${timeline.chronology.map(row).join("\n")}\n</tbody></table></div>`);
  }
  if (timeline.undated.length > 0) {
    body.push(`<h2>${label(site, "codex-undated")}</h2>\n<div class="scroll"><table>${head}<tbody>\n${timeline.undated.map(row).join("\n")}\n</tbody></table></div>`);
  }
  if (timeline.pov.length > 0) {
    // Lengths, shares, and order in the book's count unit, as the timeline
    // view gives them.
    const length = povLength(timeline.unit);
    body.push(`<h2>${label(site, "codex-point-of-view")}</h2>\n<table><thead><tr>${columns(site, ["codex-pov", "codex-chapters", timeline.unit === "characters" ? "codex-character-count" : "codex-words", "codex-share"])}</tr></thead><tbody>\n${timeline.pov.map((entry) => `<tr><td>${entry.pov === "unspecified" ? label(site, "codex-unspecified") : entityLink(site, "character", entry.pov, 0)}</td><td>${entry.chapters}</td><td>${length(entry)}</td><td>${Math.round(entry.share)}%</td></tr>`).join("\n")}\n</tbody></table>`);
  }
  if (timeline.presence.length > 0) {
    const died = (entry) => (site.spoilers && entry.died !== null ? label(site, "codex-dies-in-chapter", { n: entry.died }) : "");
    body.push(`<h2>${label(site, "codex-presence")}</h2>\n<table><thead><tr>${columns(site, ["codex-character", "codex-chapters", "codex-first", "codex-last", "codex-longest-gap", ...(site.spoilers ? ["codex-death"] : [])])}</tr></thead><tbody>\n${timeline.presence.map((entry) => `<tr><td>${entityLink(site, "character", entry.id, 0)}</td><td>${entry.chapters}</td><td>${entry.first ?? ""}</td><td>${entry.last ?? ""}</td><td>${entry.longestGap}</td>${site.spoilers ? `<td>${died(entry)}</td>` : ""}</tr>`).join("\n")}\n</tbody></table>`);
  }
  return page(site, "timeline.html", fillLabel(site.labels, "codex-timeline"), body);
}

function threadsPage(site) {
  const { project } = site;
  const body = [`<h1>${label(site, "codex-threads")}</h1>`];
  const questions = [...project.questions].filter((question) => site.spoilers || question.status === "open");
  const promises = [...project.promises].filter((promise) => site.spoilers || promise.status === "planned" || promise.status === "planted");
  const characters = (ids) => asArray(ids).map(idText).filter((id) => id !== "").map((id) => entityLink(site, "character", id, 0)).join(", ");
  if (!site.spoilers) {
    body.push(`<p class="note">${label(site, "codex-threads-note", { flag: "<code>--spoilers</code>" })}</p>`);
  }
  body.push(`<h2>${label(site, "codex-questions")}</h2>`);
  if (questions.length === 0) {
    body.push(`<p>${label(site, "codex-none")}</p>`);
  } else {
    body.push(`<table><thead><tr>${columns(site, ["codex-question", "codex-raised-in", ...(site.spoilers ? ["codex-status", "codex-resolved-in"] : []), "codex-characters"])}</tr></thead><tbody>\n${questions.map((question) => `<tr><td>${escapeHtml(String(question.title))}</td><td>${chapterLabel(site, question.introduced)}</td>${site.spoilers ? `<td>${escapeHtml(String(question.status))}</td><td>${chapterLabel(site, question.resolved)}</td>` : ""}<td>${characters(question.characters)}</td></tr>`).join("\n")}\n</tbody></table>`);
  }
  body.push(`<h2>${label(site, "codex-promises")}</h2>`);
  if (promises.length === 0) {
    body.push(`<p>${label(site, "codex-none")}</p>`);
  } else {
    body.push(`<table><thead><tr>${columns(site, ["codex-promise", "codex-planted-in", ...(site.spoilers ? ["codex-status", "codex-paid-off-in"] : []), "codex-arcs", "codex-characters"])}</tr></thead><tbody>\n${promises.map((promise) => `<tr><td>${escapeHtml(String(promise.title))}</td><td>${chapterLabel(site, promise.planted)}</td>${site.spoilers ? `<td>${escapeHtml(String(promise.status))}</td><td>${chapterLabel(site, promise.payoff)}</td>` : ""}<td>${asArray(promise.arcs).map(idText).filter((id) => id !== "").map((id) => entityLink(site, "arc", id, 0)).join(", ")}</td><td>${characters(promise.characters)}</td></tr>`).join("\n")}\n</tbody></table>`);
  }
  if (site.spoilers) {
    const matrix = buildClueMatrix(project);
    body.push(`<h2>${label(site, "codex-clues")}</h2>`);
    if (matrix.rows.length === 0) {
      body.push(`<p>${label(site, "codex-none")}</p>`);
    } else {
      const clues = new Map(project.clues.map((clue) => [clue.id, clue]));
      const totals = { planted: matrix.totals.planted, total: matrix.totals.clues, revealed: matrix.totals.revealed, herrings: matrix.totals.redHerrings };
      body.push(`<p class="note">${label(site, "codex-clues-note", { command: "<code>story clues</code>" })} ${label(site, matrix.totals.redHerrings === 1 ? "codex-clue-totals-one" : "codex-clue-totals", totals)}</p>`);
      const head = `<tr>${columns(site, ["codex-clue", "codex-status"])}${matrix.chapters.map((chapter) => `<th>${chapter.number}</th>`).join("")}</tr>`;
      const rows = matrix.rows.map((row) => {
        const tags = [row.redHerring ? label(site, "codex-red-herring") : "", row.significanceDelayed ? label(site, "codex-significance-delayed") : ""].filter(Boolean).join(", ");
        const who = characters(clues.get(row.id)?.characters);
        return `<tr><td>${escapeHtml(String(row.title))}${tags === "" ? "" : ` <span class="muted">${tags}</span>`}${who === "" ? "" : `<br><span class="muted">${who}</span>`}</td><td>${escapeHtml(String(row.status))}</td>${row.cells.map((cell) => `<td class="cell">${cell === "." ? "" : cell}</td>`).join("")}</tr>`;
      });
      body.push(`<div class="scroll"><table class="grid"><thead>${head}</thead><tbody>\n${rows.join("\n")}\n</tbody></table></div>`);
    }
  }
  return page(site, "threads.html", fillLabel(site.labels, "codex-threads"), body);
}

function progressPage(site) {
  const { project } = site;
  const data = project.story.data;
  const unit = project.unit;
  const characterBook = unit.name === "characters";
  const countColumn = characterBook ? "codex-character-count" : "codex-words";
  const target = data[unit.targetField];
  // Only the parts of the progress report that do not depend on today's
  // date are shown, so the page stays the same from one day to the next:
  // computeProgress is given a fixed day and its dated fields are not read.
  const progress = computeProgress({
    unit: unit.name,
    words: project.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
    characters: characterBook ? project.chapters.reduce((sum, chapter) => sum + chapter.count, 0) : null,
    target: Number.isInteger(target) && target > 0 ? target : null,
    deadline: null,
    today: "2000-01-01",
    chapters: project.chapters.map((chapter) => ({ id: chapter.id, words: chapter.wordCount, characters: chapter.count, target: chapter.targetCount })),
    sessions: []
  });
  const length = characterBook ? progress.characterCount : progress.words;
  const facts = [
    [`codex-total-${unit.name}`, String(length)],
    ...(progress.target === null ? [] : [[`codex-target-${unit.name}`, String(progress.target)], ["codex-done", `${Math.min(100, Math.floor(progress.percent))}%`], ["codex-remaining", String(progress.remaining)]]),
    ...(typeof data.deadline === "string" && data.deadline.trim() !== "" ? [["codex-deadline", data.deadline.trim()]] : [])
  ];
  const body = [
    `<h1>${label(site, "codex-progress")}</h1>`,
    `<table class="facts"><tbody>\n${facts.map(([key, value]) => `<tr><th scope="row">${label(site, key)}</th><td>${escapeHtml(value)}</td></tr>`).join("\n")}\n</tbody></table>`,
    progress.target === null ? "" : `<p><meter min="0" max="100" value="${Math.min(100, Math.floor(progress.percent))}">${Math.min(100, Math.floor(progress.percent))}%</meter></p>`
  ];
  if (site.chapters.length > 0) {
    const targets = new Map(progress.chapters.map((chapter) => [chapter.id, chapter]));
    const rows = site.chapters.map((chapter) => {
      const count = characterBook ? chapter.count : chapter.wordCount;
      const goal = targets.get(chapter.id);
      // A story's own author in a collection or anthology (chapter `author`).
      const byline = chapterByline(nameList(chapter.frontmatter?.author), site.labels);
      return `<tr><td>${chapterLabel(site, chapter.id)}${byline === "" ? "" : ` <span class="byline">${escapeHtml(byline)}</span>`}</td><td>${escapeHtml(String(chapter.status))}</td><td>${chapter.pov === "" ? "" : entityLink(site, "character", chapter.pov, 0)}</td><td>${count}</td><td>${goal === undefined ? "" : `${goal.target} (${Math.floor(goal.percent)}%)`}</td></tr>`;
    });
    body.push(`<h2>${label(site, "codex-chapters")}</h2>\n<div class="scroll"><table><thead><tr>${columns(site, ["codex-chapter", "codex-status", "codex-pov", countColumn, "codex-target"])}</tr></thead><tbody>\n${rows.join("\n")}\n</tbody></table></div>`);
  }
  if (site.grid.rows.length > 0 && site.grid.chapters.length > 0) {
    const head = `<tr>${columns(site, ["codex-arc"])}${site.grid.chapters.map((chapter) => `<th>${chapter.number}</th>`).join("")}</tr>`;
    const rows = site.grid.rows.map((row) => `<tr><td>${row.known ? entityLink(site, "arc", row.id, 0) : `${escapeHtml(row.id)} <span class="muted">${label(site, "codex-unknown")}</span>`}</td>${row.cells.map((cell) => `<td class="cell">${cell ? "x" : ""}</td>`).join("")}</tr>`);
    if (site.spoilers) {
      rows.push(`<tr><td>${label(site, "codex-hook")}</td>${site.grid.chapters.map((chapter) => `<td>${escapeHtml(chapter.hook)}</td>`).join("")}</tr>`);
      rows.push(`<tr><td>${label(site, "codex-outcomes")}</td>${site.grid.chapters.map((chapter) => `<td>${escapeHtml(chapter.outcomes.join(", "))}</td>`).join("")}</tr>`);
    }
    body.push(`<h2>${label(site, "codex-plot-grid")}</h2>\n<p class="note">${label(site, "codex-grid-note", { command: "<code>story grid</code>" })}</p>\n<div class="scroll"><table class="grid"><thead>${head}</thead><tbody>\n${rows.join("\n")}\n</tbody></table></div>`);
  }
  // A book counted in characters lists only the sessions that logged them,
  // as `story progress` measures it.
  const sessions = cleanSessions(project.progressLog?.data.sessions).filter((session) => !characterBook || session.characters !== null);
  if (sessions.length > 0) {
    body.push(`<h2>${label(site, "codex-session-log")}</h2>\n<table><thead><tr>${columns(site, ["codex-date", countColumn])}</tr></thead><tbody>\n${sessions.map((session) => `<tr><td>${escapeHtml(session.date)}</td><td>${characterBook ? session.characters : session.words}</td></tr>`).join("\n")}\n</tbody></table>`);
  }
  return page(site, "progress.html", fillLabel(site.labels, "codex-progress"), body);
}

// ---------------------------------------------------------------- parts

// A codex label as HTML: the label's own text escaped, each value (already
// HTML) placed as it is.
function label(site, key, values = {}) {
  return fillLabel(site.labels, key, values, escapeHtml);
}

// A table's header cells, one per label key.
function columns(site, keys) {
  return keys.map((key) => `<th>${label(site, key)}</th>`).join("");
}

// An entity kind's singular name, as HTML.
function kindName(site, kind) {
  return label(site, `codex-${kind}`);
}

function kindOrder(kind) {
  return CODEX_KINDS.findIndex((entry) => entry.kind === kind);
}

function displayName(entity) {
  return String(entity.name ?? entity.id);
}

// The short description the index gives beside a name.
function summaryLine(site, kind, entity) {
  const parts = kind === "character" ? [entity.role] : [entity.type];
  if (site.spoilers && kind !== "location" && kind !== "system") {
    parts.push(entity.status);
  }
  return parts.map((part) => String(part ?? "").trim()).filter((part) => part !== "").join(", ");
}

// The table of an entity's fields, as [label, value] pairs of HTML.
function factRows(site, kind, entity, depth) {
  const rows = [];
  const text = (key, value) => {
    const shown = plainValue(value);
    if (shown !== "") {
      rows.push([label(site, key), escapeHtml(shown)]);
    }
  };
  const links = (key, linkKind, ids) => {
    const list = asArray(ids).map(idText).filter((id) => id !== "");
    if (list.length > 0) {
      rows.push([label(site, key), list.map((id) => entityLink(site, linkKind, id, depth)).join(", ")]);
    }
  };
  const spoilers = site.spoilers;
  if (kind === "character") {
    text("codex-role", entity.role);
    text("codex-aliases", entity.aliases);
    links("codex-locations", "location", entity.locations);
    if (spoilers) {
      text("codex-status", entity.status);
      text("codex-arc", entity.arc);
      if (entity.diedIn !== "") {
        rows.push([label(site, "codex-dies-in"), chapterLabel(site, entity.diedIn)]);
      }
      if (entity.revivedIn !== "") {
        rows.push([label(site, "codex-revived-in"), chapterLabel(site, entity.revivedIn)]);
      }
    }
  } else if (kind === "location") {
    text("codex-type", entity.type);
    text("codex-region", entity.region);
    text("codex-setting", entity.setting);
    links("codex-notable-characters", "character", entity.notableCharacters);
    const routes = entity.routes.filter((route) => route && typeof route === "object" && idText(route.to) !== "");
    if (routes.length > 0) {
      rows.push([label(site, "codex-routes"), routes.map((route) => {
        const detail = [typeof route.hours === "number" ? label(site, "codex-hours", { hours: route.hours }) : "", typeof route.mode === "string" ? escapeHtml(route.mode) : ""].filter(Boolean).join(", ");
        return `${entityLink(site, "location", idText(route.to), depth)}${detail === "" ? "" : ` <span class="muted">${detail}</span>`}`;
      }).join("<br>")]);
    }
  } else if (kind === "faction") {
    text("codex-type", entity.type);
    links("codex-members", "character", entity.members);
    links("codex-locations", "location", entity.locations);
    if (spoilers) {
      text("codex-status", entity.status);
    }
  } else if (kind === "artifact") {
    text("codex-type", entity.type);
    if (spoilers) {
      text("codex-status", entity.status);
      links("codex-owner", "character", entity.owner);
      links("codex-location", "location", entity.location);
    }
  } else if (kind === "system") {
    text("codex-type", entity.type);
  } else if (kind === "arc") {
    text("codex-type", entity.type);
    links("codex-characters", "character", entity.characters);
    text("codex-themes", entity.themes);
    if (spoilers) {
      text("codex-status", entity.status);
    }
  }
  text("codex-pronunciation", entity.pronunciation);
  return rows;
}

// A frontmatter value as one line of text: a list joined with commas, a
// mapping as key: value pairs.
function plainValue(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map(plainValue).filter((item) => item !== "").join(", ");
  }
  if (typeof value === "object") {
    return Object.entries(value).map(([key, item]) => `${key}: ${plainValue(item)}`).join(", ");
  }
  return String(value).trim();
}

// A link to an entity's page, named by the entity, or the bare id when no
// such entity exists. `depth` is how many folders down the linking page is.
function entityLink(site, kind, id, depth) {
  const entity = site.entities.get(kind)?.get(id);
  if (!entity) {
    return escapeHtml(id);
  }
  const dir = CODEX_KINDS[kindOrder(kind)].dir;
  return `<a href="${"../".repeat(depth)}${dir}/${encodeURIComponent(id)}.html">${escapeHtml(displayName(entity))}</a>`;
}

// A chapter by number and title, or by the book's chapter label when it has
// no title, or the id as written when no chapter has it (a planned
// chapter-NN).
function chapterLabel(site, id) {
  const text = idText(id);
  if (text === "") {
    return "";
  }
  const chapter = site.chapterById.get(text);
  if (!chapter) {
    return escapeHtml(text);
  }
  const title = String(chapter.title ?? "").trim();
  return escapeHtml(title === "" ? fillLabel(site.labels, "chapter", { n: chapter.number }) : `${chapter.number}. ${title}`);
}

// The timeline names a chapter by number (or its id when it has none).
function chapterIdOf(site, number) {
  return site.chapters.find((chapter) => chapter.number === number)?.id ?? String(number);
}

// The entity file's body as HTML: headings, lists, tables, quotes, code, and
// paragraphs, with HTML comments and the leading title heading left out.
function notesHtml(site, entity) {
  const { body } = readMarkdown(entity.file, site.project.root);
  const lines = scanComments(body.replace(/\r\n?/g, "\n")).text.split("\n");
  const out = [];
  let paragraph = [];
  let list = null;
  let table = [];
  let fence = null;
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      // A line ending in a backslash or two spaces keeps its break, as in
      // the review copy, so verse and addresses keep their lines.
      const text = paragraph.map((line, index) => {
        if (index === paragraph.length - 1) {
          return line.trim();
        }
        if (/\\$/.test(line)) {
          return `${line.slice(0, -1).trim()}${LINE_BREAK}`;
        }
        return line.endsWith("  ") ? `${line.trim()}${LINE_BREAK}` : `${line.trim()} `;
      }).join("");
      out.push(`<p>${inlineHtml(plainLinks(text))}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list !== null) {
      out.push(`<${list.tag}>\n${list.items.map((item) => `<li>${inlineHtml(plainLinks(item))}</li>`).join("\n")}\n</${list.tag}>`);
      list = null;
    }
  };
  const flushTable = () => {
    if (table.length > 0) {
      const cells = (line) => line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((cell) => inlineHtml(plainLinks(cell.trim().replace(/\\\|/g, "|"))));
      // The delimiter row (| --- | :-: |) and rows with every cell blank (a
      // template's placeholder row) are not shown.
      const delimiter = (line) => /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/.test(line);
      const [head, ...rest] = table.length > 1 && delimiter(table[1]) ? [table[0], ...table.slice(2)] : [null, ...table];
      const body = rest.filter((line) => !delimiter(line)).map(cells).filter((row) => row.some((cell) => cell !== ""));
      if (body.length > 0) {
        out.push(`<div class="scroll"><table>${head === null ? "" : `<thead><tr>${cells(head).map((cell) => `<th>${cell}</th>`).join("")}</tr></thead>`}<tbody>\n${body.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("\n")}\n</tbody></table></div>`);
      }
      table = [];
    }
  };
  const flush = () => {
    flushParagraph();
    flushList();
    flushTable();
  };
  let titleSkipped = false;
  for (const line of lines) {
    if (fence !== null) {
      // A closing fence is the opening fence's character, at least as many
      // times, alone on its line.
      const closing = line.trim();
      if (closing.length >= fence.marker.length && closing === fence.marker[0].repeat(closing.length)) {
        out.push(`<pre><code>${escapeHtml(fence.lines.join("\n"))}</code></pre>`);
        fence = null;
      } else {
        fence.lines.push(line);
      }
      continue;
    }
    const fenceOpen = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceOpen) {
      flush();
      fence = { marker: fenceOpen[1], lines: [] };
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    const heading = /^(#{1,6})[ \t]+(.*?)[ \t#]*$/.exec(line);
    if (heading) {
      flush();
      // The file's own title heading repeats the page's.
      if (!titleSkipped && heading[1].length === 1) {
        titleSkipped = true;
        continue;
      }
      const level = Math.min(6, heading[1].length + 1);
      out.push(`<h${level}>${inlineHtml(plainLinks(heading[2]))}</h${level}>`);
      continue;
    }
    titleSkipped = true;
    if (/^\s*\|/.test(line)) {
      flushParagraph();
      flushList();
      table.push(line);
      continue;
    }
    flushTable();
    const item = /^\s*(?:([-*+])|(\d+)[.)])[ \t]+(.*)$/.exec(line);
    if (item) {
      flushParagraph();
      const tag = item[1] ? "ul" : "ol";
      if (list !== null && list.tag !== tag) {
        flushList();
      }
      list ??= { tag, items: [] };
      list.items.push(item[3]);
      continue;
    }
    if (list !== null && /^\s+\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();
    const quote = /^\s*>[ \t]?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      out.push(`<blockquote><p>${inlineHtml(plainLinks(quote[1]))}</p></blockquote>`);
      continue;
    }
    paragraph.push(line);
  }
  if (fence !== null) {
    out.push(`<pre><code>${escapeHtml(fence.lines.join("\n"))}</code></pre>`);
  }
  flush();
  return out.join("\n");
}

// One page: the shared header, the body, and the stylesheet inline.
function page(site, path, title, body) {
  const depth = path.split("/").length - 1;
  const up = "../".repeat(depth);
  const nav = [
    ...SECTION_PAGES.map((entry) => ({ href: `${up}${entry.file}`, title: label(site, entry.title), current: entry.file === path })),
    ...CODEX_KINDS.filter((entry) => site.entities.get(entry.kind).size > 0).map((entry) => ({ href: `${up}index.html#${entry.dir}`, title: label(site, entry.title), current: false }))
  ];
  const fullTitle = path === "index.html" ? fillLabel(site.labels, "codex-index-title", { title: site.title }) : `${title} - ${site.title}`;
  return `<!DOCTYPE html>
${htmlRoot(site.language)}
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${CODEX_GENERATOR}">
<meta name="robots" content="noindex">
<title>${escapeHtml(fullTitle)}</title>
<style>
:root { --bg: #fdfcf8; --fg: #1d1b16; --muted: #6b665c; --rule: #ddd6c8; --accent: #7c3aed; --panel: #f4f1e8; }
@media (prefers-color-scheme: dark) { :root { --bg: #16150f; --fg: #ece8dd; --muted: #a39e92; --rule: #3a372f; --accent: #b794f4; --panel: #211f18; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 1rem/1.6 ${site.type.fonts.body}; }
header.site { border-bottom: 1px solid var(--rule); padding: 0.75rem 1rem; font: 0.9rem/1.5 system-ui, sans-serif; }
header.site .book { font-weight: 600; margin-inline-end: 1rem; }
header.site a { color: var(--accent); text-decoration: none; margin-inline-end: 0.9rem; white-space: nowrap; }
header.site a[aria-current="page"] { color: var(--fg); font-weight: 600; }
main { max-width: 52rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
h1 { font-size: 1.9rem; line-height: 1.2; margin: 0.5rem 0 1rem; }
h2 { font-size: 1.3rem; margin: 2rem 0 0.75rem; border-top: 1px solid var(--rule); padding-top: 1rem; }
h3, h4, h5, h6 { font-size: 1.05rem; margin: 1.25rem 0 0.5rem; }
a { color: var(--accent); }
.kind, .muted, .count, .byline { color: var(--muted); }
.kind { font: 0.8rem/1.4 system-ui, sans-serif; text-transform: uppercase; letter-spacing: 0.06em; margin: 0; }
.count { font-size: 0.9rem; font-weight: normal; }
.note { font: 0.9rem/1.5 system-ui, sans-serif; color: var(--muted); border-inline-start: 3px solid var(--accent); padding-inline-start: 0.75rem; }
table { border-collapse: collapse; margin: 0.5rem 0 1rem; font-size: 0.95rem; }
th, td { border-bottom: 1px solid var(--rule); padding: 0.3rem 0.6rem; text-align: start; vertical-align: top; }
thead th { font: 600 0.8rem/1.4 system-ui, sans-serif; color: var(--muted); }
table.facts th { color: var(--muted); font-weight: normal; padding-inline-start: 0; }
table.grid td.cell { text-align: center; font-family: ui-monospace, monospace; }
.scroll { overflow-x: auto; }
ul.entities { columns: 16rem; padding-inline-start: 1.25rem; }
ul.entities li { break-inside: avoid; }
.notes { background: var(--panel); padding: 0.25rem 1rem; border-radius: 0.4rem; }
pre { overflow-x: auto; background: var(--panel); padding: 0.75rem; }
blockquote { margin: 0 0 1rem; margin-inline-start: 1rem; padding-inline-start: 0.75rem; border-inline-start: 2px solid var(--rule); }
</style>
</head>
<body>
<header class="site"><span class="book">${escapeHtml(site.title)}</span><nav aria-label="${label(site, "codex-story-bible")}">${nav.map((entry) => `<a href="${entry.href}"${entry.current ? ' aria-current="page"' : ""}>${entry.title}</a>`).join("")}</nav></header>
<main>
${body.filter((part) => part !== "").join("\n")}
</main>
</body>
</html>
`;
}

// The generator meta tag every codex page carries. A rebuild clears an
// earlier codex only from a folder whose index.html has it.
export const CODEX_GENERATOR = "story build --format codex";
