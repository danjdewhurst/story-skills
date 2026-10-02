import fs from "node:fs";
import path from "node:path";
import { chapterChronology } from "./chronology.js";
import { characterLifeline, revivedBy } from "./deaths.js";
import { err, warn } from "./findings.js";
import { languagePack } from "./languages/index.js";
import { compareText } from "./languages/locale.js";
import { parseFrontmatter, replaceFrontmatter } from "./frontmatter.js";
import { readTextFile } from "./files.js";

// Each pair is a series link field and the field the linked book must use to
// point back. `follows` names books set earlier in the story's chronology;
// `precedes` names books set later. Publication order lives in `book-number`.
const SERIES_LINK_INVERSES = [["follows", "precedes"], ["precedes", "follows"]];

// The book cap and the visited set bound the traversal, so a long linear
// series is followed to its end from either book.
const MAX_SERIES_BOOKS = 100;

// Entity collections compared across books, with the field that names them.
const SHARED_CANON = [
  ["characters", "Characters", "name"],
  ["locations", "Locations", "name"],
  ["systems", "Systems", "name"],
  ["factions", "Factions", "name"],
  ["artifacts", "Artifacts", "name"],
  ["glossaryTerms", "Glossary terms", "term"]
];

// Publication order. 0 is a prequel published after book 1 (often a reader
// magnet) and a decimal such as 1.5 is a between-books novella, as retailer
// series fields allow.
export function isBookNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

// The retail series name: `series-title` when set, else the series id.
export function seriesDisplayName(data) {
  const title = data?.["series-title"];
  return typeof title === "string" && title.trim() !== "" ? title.trim() : seriesId(data);
}

// Stored link paths are relative to the book root and use forward slashes so
// story.md stays portable between operating systems.
export function seriesLinkPath(fromRoot, toRoot) {
  return path.relative(fromRoot, toRoot).split(path.sep).join("/");
}

export function seriesLinks(root, data, field) {
  const raw = data[field];
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return values
    .filter((value) => typeof value === "string" && value.trim() !== "")
    .map((value) => path.resolve(root, value));
}

// A blank `series: ""` counts as no series id, so it is reported as missing
// rather than as a different series with an empty name.
export function seriesId(data) {
  const value = data?.series;
  if (value === undefined || value === null) {
    return undefined;
  }
  return String(value).trim() === "" ? undefined : value;
}

// Series books sit side by side in one parent folder. `story series` only
// follows links between sibling folders, so the same series is found from
// whichever book it starts at.
export function areSiblingBooks(left, right) {
  return path.dirname(canonicalPath(left)) === path.dirname(canonicalPath(right));
}

// True when `links` (resolved paths) name the book at `root`, comparing real
// paths so a link written through a symlink counts as the same book.
export function linksInclude(links, root) {
  const key = canonicalPath(root);
  return links.some((link) => link === root || canonicalPath(link) === key);
}

export function readBookFrontmatter(root) {
  const storyPath = path.join(root, "story.md");
  if (!fs.existsSync(storyPath)) {
    return null;
  }
  return parseFrontmatter(readTextFile(storyPath), storyPath).data;
}

export function validateSeriesLinks(root, data, errors) {
  for (const [field, inverse] of SERIES_LINK_INVERSES) {
    // A Windows separator resolves on Windows and nowhere else, so it is
    // reported by name on every platform instead of as a missing book.
    const raw = Array.isArray(data[field]) ? data[field] : [data[field]];
    const backslashed = raw.filter((value) => typeof value === "string" && value.includes("\\"));
    for (const value of backslashed) {
      errors.push(err("series-link-backslash", `story.md ${field} ${value} uses a backslash; write ${value.replace(/\\/g, "/")} so the link works on every system`, "story.md"));
    }
    for (const target of seriesLinks(root, { [field]: raw.filter((value) => !backslashed.includes(value)) }, field)) {
      const label = `story.md ${field} ${seriesLinkPath(root, target)}`;
      if (target === root || canonicalPath(target) === canonicalPath(root)) {
        errors.push(err("series-link-self", `${label} points at this book`, "story.md"));
        continue;
      }

      let other;
      try {
        other = readBookFrontmatter(target);
      } catch (error) {
        errors.push(err("series-link-unreadable", `${label}: ${error.message}`, "story.md"));
        continue;
      }
      if (!other) {
        errors.push(err("series-link-not-project", `${label} is not a story project: missing story.md`, "story.md"));
        continue;
      }

      if (!areSiblingBooks(root, target)) {
        errors.push(err("series-link-not-sibling", `${label} is not in the same parent folder as this book; story series only follows links between sibling book folders`, "story.md"));
      }
      if (!linksInclude(seriesLinks(target, other, inverse), root)) {
        errors.push(err("series-missing-backlink", `${label} is missing backlink: add ${seriesLinkPath(target, root)} to its ${inverse}`, "story.md"));
      }
      const ownSeries = seriesId(data);
      const otherSeries = seriesId(other);
      if (ownSeries !== undefined && otherSeries !== undefined && ownSeries !== otherSeries) {
        errors.push(err("series-link-other-series", `${label} belongs to series ${otherSeries}, not ${ownSeries}`, "story.md"));
      }
    }
  }
}

// Returns an existing book's story.md with a reciprocal link added, or null
// when the link is already present.
// Also gives the existing book the new book's series id when it has none,
// so both sides of the link agree.
export function withSeriesBacklink(targetRoot, field, linkedRoot, newSeriesId) {
  const storyPath = path.join(targetRoot, "story.md");
  const markdown = readTextFile(storyPath);
  const { data } = parseFrontmatter(markdown, storyPath);
  // A hand-written scalar link is kept and converted to a list rather than
  // dropped when the new link is added.
  const current = data[field];
  const existing = Array.isArray(current) ? current : typeof current === "string" && current.trim() !== "" ? [current] : [];
  const linked = linksInclude(seriesLinks(targetRoot, { [field]: existing }, field), linkedRoot);
  const addSeries = seriesId(data) === undefined && newSeriesId !== undefined;
  if (linked && !addSeries) {
    return null;
  }
  return replaceFrontmatter(markdown, {
    ...data,
    ...(addSeries ? { series: newSeriesId } : {}),
    ...(linked ? {} : { [field]: existing.concat(seriesLinkPath(targetRoot, linkedRoot)) })
  });
}

export function buildSeries(startRoot, scan) {
  const errors = [];
  const warnings = [];
  const books = discoverBooks(startRoot, scan, errors).books;
  if (books.length === 0) {
    return {
      root: startRoot,
      series: null,
      books: [],
      ordered: false,
      shared: [],
      ok: false,
      errors,
      warnings
    };
  }

  const seriesIds = [...new Set(books.map((book) => book.series).filter((series) => series !== undefined))].sort();
  if (seriesIds.length > 1) {
    errors.push(err("series-conflict", `Linked books belong to different series: ${seriesIds.join(", ")}`));
  }
  const unnamed = books.filter((book) => book.series === undefined);
  if (seriesIds.length === 1 && unnamed.length > 0) {
    warnings.push(warn("series-id-missing", `Linked books ${unnamed.map((book) => book.title).join(", ")} set no series id; add series: ${seriesIds[0]}`));
  }
  for (const book of books.filter((candidate) => candidate.invalidBookNumber)) {
    errors.push(err("invalid-book-number", `${book.label}: story.md book-number ${JSON.stringify(book.project.story.data["book-number"])} is not a number 0 or more; the book is listed as unnumbered`, path.join(book.label, "story.md")));
  }
  const seriesTitles = [...new Set(books.map((book) => book.seriesTitle).filter((title) => title !== undefined))].sort();
  if (seriesTitles.length > 1) {
    warnings.push(warn("series-title-mismatch", `Linked books set different series-title values: ${seriesTitles.map((title) => `"${title}"`).join(", ")}; keep the series name identical everywhere`));
  }
  checkDuplicateBookNumbers(books, errors);

  const chronology = chronologicalOrder(books, errors);
  if (chronology) {
    checkSharedCanon(chronology, errors, warnings);
  }

  return {
    root: startRoot,
    series: books[0]?.series ?? seriesIds[0] ?? null,
    seriesTitle: books[0]?.seriesTitle ?? seriesTitles[0] ?? null,
    books: (chronology ? chronology.order : books).map((book) => ({
      title: book.title,
      label: book.label,
      bookNumber: book.bookNumber,
      status: book.status
    })),
    ordered: Boolean(chronology),
    shared: sharedCanon(books),
    ok: errors.length === 0,
    errors,
    warnings
  };
}

export function formatSeriesReport(report) {
  const lines = [
    `# Series: ${report.seriesTitle ?? report.series ?? "Unnamed series"}`,
    "",
    report.ordered ? "Chronological order:" : "Books (unordered):"
  ];

  report.books.forEach((book, index) => {
    const details = [book.bookNumber === null ? "unnumbered" : `book ${book.bookNumber}`, book.status || "no status"];
    lines.push(`${index + 1}. ${book.title} (${details.join(", ")}) - ${book.label}`);
  });

  lines.push("", "Shared canon:");
  if (report.shared.length === 0) {
    lines.push("- None");
  }
  for (const entry of report.shared) {
    lines.push(`- ${entry.label}: ${entry.ids.join(", ")}`);
  }

  return `${lines.join("\n")}\n\n`;
}

export function canonicalPath(target) {
  const resolved = path.resolve(target);
  const tail = [];
  let current = resolved;
  while (current !== path.dirname(current)) {
    try {
      const real = fs.realpathSync(current);
      return tail.length === 0 ? real : path.join(real, ...tail.reverse());
    } catch {
      tail.push(path.basename(current));
      current = path.dirname(current);
    }
  }
  try {
    return path.join(fs.realpathSync(current), ...tail.reverse());
  } catch {
    return path.join(current, ...tail.reverse());
  }
}

function discoverBooks(startRoot, scan, errors) {
  const startResolved = path.resolve(startRoot);
  const scopeRoot = path.dirname(startResolved);
  const scopeReal = canonicalPath(scopeRoot);
  const visited = new Map();
  const queue = [startResolved];
  while (queue.length > 0) {
    const root = queue.shift();
    const resolved = path.resolve(root);
    // Canonical path is the visit key so an in-scope symlink to a book
    // already in the graph is the same book. A missing path keeps the
    // unresolved tail after the nearest existing ancestor, so /var and
    // /private/var stay comparable.
    const effective = canonicalPath(resolved);
    if (visited.has(effective)) {
      continue;
    }
    if (visited.size >= MAX_SERIES_BOOKS) {
      errors.push(err("series-too-many-books", 'Series links exceed the ' + MAX_SERIES_BOOKS + ' book limit; refusing to traverse further'));
      break;
    }

    const label = seriesLinkPath(startRoot, root) || '.';
    // Only sibling folders of the start book are followed. Every followed
    // link then joins two siblings, so the same books are found (and the
    // same links refused) from whichever book the check starts at.
    if (path.dirname(resolved) !== scopeRoot || path.dirname(effective) !== scopeReal) {
      const outside = !isPathInside(scopeRoot, resolved) || !isPathInside(scopeReal, effective);
      errors.push(outside
        ? err("series-link-outside", label + ' points outside the series directory ' + scopeRoot + '; refusing to follow')
        : err("series-link-not-sibling", label + ' is not a sibling folder in the series directory ' + scopeRoot + '; keep series books side by side, refusing to follow'));
      visited.set(effective, null);
      continue;
    }
    if (!fs.existsSync(path.join(root, "story.md"))) {
      errors.push(err("series-link-not-project", `${label} is not a story project: missing story.md`));
      visited.set(effective, null);
      continue;
    }

    let project;
    try {
      project = scan(root);
    } catch (error) {
      errors.push(err("series-link-unreadable", `${label}: ${error.message}`));
      visited.set(effective, null);
      continue;
    }
    // A linked book's file errors keep their codes, and name the book.
    for (const scanError of project.fileErrors ?? []) {
      errors.push({ ...scanError, message: `${label}: ${scanError.message}`, file: path.join(label, scanError.file) });
    }
    // An unparseable story.md has no series id, number, or links to trust,
    // so the book is reported once and left out rather than read as empty.
    if (project.story?.unreadable) {
      visited.set(effective, null);
      continue;
    }
    const data = project.story.data;
    const book = {
      root,
      // Canonical paths, so an edge written through a symlink and one written
      // with the real path reach the same book.
      key: effective,
      label,
      project,
      title: String(data.title ?? path.basename(root)),
      series: seriesId(data),
      status: data.status,
      bookNumber: isBookNumber(data["book-number"]) ? data["book-number"] : null,
      invalidBookNumber: data["book-number"] !== undefined && !isBookNumber(data["book-number"]),
      seriesTitle: typeof data["series-title"] === "string" && data["series-title"].trim() !== "" ? data["series-title"].trim() : undefined,
      follows: seriesLinks(root, data, "follows"),
      precedes: seriesLinks(root, data, "precedes")
    };
    visited.set(effective, book);
    for (const next of book.follows.concat(book.precedes)) {
      queue.push(next);
    }
  }
  const books = [...visited.values()].filter(Boolean);
  return { books, complete: books.length === visited.size };
}

// The books reachable from `startRoot` without the canon checks, plus the
// traversal errors. `complete` is false when a linked book could not be read.
export function discoverSeriesBooks(startRoot, scan) {
  const errors = [];
  const { books, complete } = discoverBooks(startRoot, scan, errors);
  return { books, complete, errors };
}

function isPathInside(root, target) {
  const relativePath = path.relative(root, target);
  return !path.isAbsolute(relativePath) && (relativePath === "" || !relativePath.split(path.sep).includes(".."));
}

function chronologicalOrder(books, errors) {
  const byKey = new Map(books.map((book) => [book.key, book]));
  const later = new Map(books.map((book) => [book.key, new Set()]));
  for (const book of books) {
    for (const earlier of book.follows.map(canonicalPath)) {
      if (byKey.has(earlier) && earlier !== book.key) {
        later.get(earlier).add(book.key);
      }
    }
    for (const next of book.precedes.map(canonicalPath)) {
      if (byKey.has(next) && next !== book.key) {
        later.get(book.key).add(next);
      }
    }
  }

  const indegree = new Map(books.map((book) => [book.key, 0]));
  for (const targets of later.values()) {
    for (const target of targets) {
      indegree.set(target, indegree.get(target) + 1);
    }
  }

  const order = [];
  const ready = books.filter((book) => indegree.get(book.key) === 0);
  const compareTitles = compareText(seriesPack(books));
  while (ready.length > 0) {
    ready.sort((left, right) => compareBooks(left, right, compareTitles));
    const book = ready.shift();
    order.push(book);
    for (const target of later.get(book.key)) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) {
        ready.push(byKey.get(target));
      }
    }
  }

  if (order.length < books.length) {
    const cycle = books.filter((book) => !order.includes(book)).map((book) => book.title);
    errors.push(err("series-cycle", `Series chronology has a cycle between ${cycle.join(", ")}; check follows and precedes`));
    return null;
  }
  return { order, later };
}

function checkDuplicateBookNumbers(books, errors) {
  const byNumber = new Map();
  for (const book of books) {
    if (book.bookNumber !== null) {
      byNumber.set(book.bookNumber, (byNumber.get(book.bookNumber) ?? []).concat(book.label));
    }
  }
  for (const [number, labels] of [...byNumber].sort((left, right) => left[0] - right[0])) {
    if (labels.length > 1) {
      errors.push(err("duplicate-book-number", `Books ${labels.join(", ")} share book-number ${number}; book-number is publication order and must be unique`));
    }
  }
}

// Among books whose earlier books are already listed, the lowest
// book-number goes next, then title, then canonical path, so the report is
// the same whichever book it starts from.
function compareBooks(left, right, compareTitles) {
  return (left.bookNumber ?? Infinity) - (right.bookNumber ?? Infinity)
    || compareTitles(left.title, right.title)
    || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}

// Titles sort in the books' language when every book shares one, and in
// English otherwise, so the order never depends on the starting book.
function seriesPack(books) {
  const locales = new Set(books.map((book) => book.project.pack?.locale ?? languagePack().locale));
  return locales.size === 1 ? books[0].project.pack ?? languagePack() : languagePack();
}

function checkSharedCanon({ order, later }, errors, warnings) {
  const reachable = new Map(order.map((book) => [book.key, collectLater(book.key, later, new Set())]));

  for (const book of order) {
    const earlierBooks = order.filter((candidate) => reachable.get(candidate.key).has(book.key));
    checkCanonNames(book, earlierBooks, warnings);
    checkCanonDeaths(book, earlierBooks, errors);
    checkDestroyedArtifacts(book, earlierBooks, errors, warnings);
    checkKnownFacts(book, earlierBooks, errors);
  }
}

function collectLater(root, later, seen) {
  for (const next of later.get(root)) {
    if (!seen.has(next)) {
      seen.add(next);
      collectLater(next, later, seen);
    }
  }
  return seen;
}

// Compare against the most recent earlier book that defines the entity, so a
// rename carried forward through a trilogy is reported once, not per book.
function checkCanonNames(book, earlierBooks, warnings) {
  for (const [key, , field] of SHARED_CANON) {
    const canon = new Map();
    for (const earlier of earlierBooks) {
      for (const entity of earlier.project[key]) {
        canon.set(entity.id, { book: earlier, entity });
      }
    }
    for (const entity of book.project[key]) {
      const match = canon.get(entity.id);
      if (match && canonText(entity[field]) !== canonText(match.entity[field])) {
        warnings.push(warn("canon-name-mismatch", `${bookFile(book, entity.file)} ${field} "${entity[field]}" differs from "${match.entity[field]}" in ${bookFile(match.book, match.entity.file)}`, bookFile(book, entity.file)));
      }
      // An audiobook narrator reads each book's own guide, so a respelling
      // that changes between books changes how the name is said.
      const said = pronunciationText(entity.pronunciation);
      const saidBefore = pronunciationText(match?.entity.pronunciation);
      if (said !== "" && saidBefore !== "" && said !== saidBefore) {
        warnings.push(warn("canon-pronunciation-mismatch", `${bookFile(book, entity.file)} pronunciation "${said}" differs from "${saidBefore}" in ${bookFile(match.book, match.entity.file)}`, bookFile(book, entity.file)));
      }
    }
  }
}

function pronunciationText(value) {
  return typeof value === "string" ? value.trim().normalize("NFC") : "";
}

// NFC and NFD spellings of one name (macOS files, pasted text) are the same.
function canonText(value) {
  return typeof value === "string" ? value.normalize("NFC") : value;
}

// A character who dies in an earlier book stays dead: the later book must mark
// them deceased and keep them out of on-page casts until it brings them back.
// Deaths are read as story continuity reads them (see deaths.js): `died-in`,
// `revived-in`, `status`, and status progressions, at the end of each earlier
// book.
function checkCanonDeaths(book, earlierBooks, errors) {
  const deaths = deathsBefore(earlierBooks);
  const { chronology, lifelines } = bookLifelines(book);
  // Dead at `chapterId` unless this book brings them back by then. A death
  // this book records after that revival is its own, which story continuity
  // reports in this book, so it is not reported again as the earlier book's.
  const deadAt = (id, chapterId) => deaths.has(id) && !(lifelines.has(id) && revivedBy(lifelines.get(id), chapterId, chronology));
  for (const character of book.project.characters) {
    const death = deaths.get(character.id);
    if (!death) {
      continue;
    }
    if (character.status !== "deceased") {
      errors.push(err("canon-death-status", `${bookFile(book, character.file)} has status ${character.status || "unset"}, but ${character.id} is deceased in earlier book ${death.title}; set status: deceased`, bookFile(book, character.file)));
    }
  }

  for (const record of book.project.chapters.concat(book.project.scenes)) {
    const chapterId = record.chapter ?? record.id;
    for (const [id, death] of deaths) {
      // A pov also listed in mentions narrates without appearing (a ghost),
      // as in single-book continuity.
      if ((record.characters.includes(id) || (record.pov === id && !record.mentions.includes(id))) && deadAt(id, chapterId)) {
        errors.push(err("canon-posthumous-appearance", `${bookFile(book, record.file)} lists ${id}, who died in earlier book ${death.title}; move appearances to mentions`, bookFile(book, record.file)));
      }
    }
  }

  // Learning a fact on the page is an on-page event, like an appearance.
  for (const entry of knowledgeEntries(book)) {
    const death = deaths.get(entry.character);
    if (death && entry.learnedIn && deadAt(entry.character, entry.learnedIn)) {
      errors.push(err("canon-posthumous-learning", `${bookFile(book, entry.file)} knowledge-state[${entry.index}] has ${entry.character} learn something in ${entry.learnedIn}, but ${entry.character} died in earlier book ${death.title}; drop learned-in or the entry`, bookFile(book, entry.file)));
    }
  }
}

// The characters dead at the end of the earlier books, each with the book
// they died in. Books are read in chronological order. A book that ends with
// the character dead after a death on its own pages becomes the book they died
// in; one where they are dead throughout keeps the earlier book, or is the
// book they died in when no earlier one has them dead. Only a revival in a
// later book (a `revived-in`, or a status progression away from deceased)
// brings them back: a later book that simply lists them alive is the
// canon-death-status error, not a revival.
function deathsBefore(earlierBooks) {
  const deaths = new Map();
  for (const earlier of earlierBooks) {
    const { lifelines } = bookLifelines(earlier);
    for (const character of earlier.project.characters) {
      const lifeline = lifelines.get(character.id);
      if (lifeline.deadAtEnd && (lifeline.events.length > 0 || !deaths.has(character.id))) {
        deaths.set(character.id, earlier);
      } else if (!lifeline.deadAtEnd && lifeline.events.some((event) => event.type === "revival")) {
        deaths.delete(character.id);
      }
    }
  }
  return deaths;
}

// Each book's chronology and its characters' lifelines, worked out once per
// book however many later books read it.
const LIFELINES = new WeakMap();

function bookLifelines(book) {
  if (!LIFELINES.has(book.project)) {
    const chronology = chapterChronology(book.project);
    const lifelines = new Map(book.project.characters.map((character) => [character.id, characterLifeline(character, chronology)]));
    LIFELINES.set(book.project, { chronology, lifelines });
  }
  return LIFELINES.get(book.project);
}

function checkDestroyedArtifacts(book, earlierBooks, errors, warnings) {
  const destroyed = firstMatching(earlierBooks, "artifacts", (artifact) => artifact.status === "destroyed");
  for (const artifact of book.project.artifacts) {
    const earlier = destroyed.get(artifact.id);
    if (earlier && artifact.status !== "destroyed") {
      warnings.push(warn("canon-destroyed-status", `${bookFile(book, artifact.file)} has status ${artifact.status || "unset"}, but ${artifact.id} was destroyed in earlier book ${earlier.title}`, bookFile(book, artifact.file)));
    }
  }
  // A scene that changes a destroyed artifact's state uses it on the page.
  // Mentions stay allowed, since characters remember it.
  for (const scene of book.project.scenes) {
    for (const [id, earlier] of destroyed) {
      if (scene.stateChanges.some((change) => change && typeof change === "object" && String(change.target ?? "") === id)) {
        errors.push(err("canon-destroyed-artifact-used", `${bookFile(book, scene.file)} uses ${id}, which was destroyed in earlier book ${earlier.title}; account for its return or remove the state change`, bookFile(book, scene.file)));
      }
    }
  }
}

// A character who already knows a fact in an earlier book cannot learn it on
// the page in a later one. In a prequel this usually means the prequel gave
// away knowledge the later book treats as a discovery.
function checkKnownFacts(book, earlierBooks, errors) {
  const known = new Map();
  for (const earlier of earlierBooks) {
    for (const entry of knowledgeFacts(earlier)) {
      if (!known.has(entry.key)) {
        known.set(entry.key, { book: earlier, entry });
      }
    }
  }

  for (const entry of knowledgeFacts(book)) {
    const prior = known.get(entry.key);
    if (prior && entry.learnedIn) {
      errors.push(err("canon-fact-relearned", `${bookFile(book, entry.file)} knowledge-state[${entry.index}] has ${entry.character} learn ${entry.fact} in ${entry.learnedIn}, but they already know it in earlier book ${prior.book.title} (${bookFile(prior.book, prior.entry.file)} knowledge-state[${prior.entry.index}])`, bookFile(book, entry.file)));
    }
  }
}

function knowledgeEntries(book) {
  const continuity = book.project.continuity;
  const entries = continuity && Array.isArray(continuity.data["knowledge-state"]) ? continuity.data["knowledge-state"] : [];
  const file = path.join(book.root, "continuity", "state.md");
  return entries.flatMap((entry, index) => entry && typeof entry === "object" && typeof entry.character === "string"
    ? [{ index, file, character: entry.character, learnedIn: entry["learned-in"] ? String(entry["learned-in"]) : "" }]
    : []);
}

function knowledgeFacts(book) {
  const continuity = book.project.continuity;
  const entries = continuity && Array.isArray(continuity.data["knowledge-state"]) ? continuity.data["knowledge-state"] : [];
  const file = path.join(book.root, "continuity", "state.md");
  const facts = [];
  entries.forEach((entry, index) => {
    const fact = entry && typeof entry === "object" ? String(entry.fact ?? "") : "";
    if (fact !== "" && typeof entry.character === "string") {
      facts.push({
        index,
        file,
        character: entry.character,
        fact,
        key: `${entry.character}\u0000${fact}`,
        learnedIn: entry["learned-in"] ? String(entry["learned-in"]) : ""
      });
    }
  });
  return facts;
}

function firstMatching(books, key, predicate) {
  const matches = new Map();
  for (const book of books) {
    for (const entity of book.project[key]) {
      if (!matches.has(entity.id) && predicate(entity)) {
        matches.set(entity.id, book);
      }
    }
  }
  return matches;
}

function sharedCanon(books) {
  const shared = [];
  for (const [key, label] of SHARED_CANON) {
    const counts = new Map();
    for (const book of books) {
      for (const entity of book.project[key]) {
        counts.set(entity.id, (counts.get(entity.id) ?? 0) + 1);
      }
    }
    const ids = [...counts].filter(([, count]) => count > 1).map(([id]) => id).sort();
    if (ids.length > 0) {
      shared.push({ label, ids });
    }
  }

  const factBooks = new Map();
  for (const book of books) {
    for (const entry of knowledgeFacts(book)) {
      factBooks.set(entry.fact, (factBooks.get(entry.fact) ?? new Set()).add(book.root));
    }
  }
  const facts = [...factBooks].filter(([, roots]) => roots.size > 1).map(([fact]) => fact).sort();
  if (facts.length > 0) {
    shared.push({ label: "Facts", ids: facts });
  }
  return shared;
}

function bookFile(book, file) {
  return path.join(book.label, path.relative(book.root, file));
}
