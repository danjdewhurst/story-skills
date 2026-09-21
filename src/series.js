import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter, replaceFrontmatter } from "./frontmatter.js";

// Each pair is a series link field and the field the linked book must use to
// point back. `follows` names books set earlier in the story's chronology;
// `precedes` names books set later. Publication order lives in `book-number`.
const SERIES_LINK_INVERSES = [["follows", "precedes"], ["precedes", "follows"]];

const MAX_SERIES_BOOKS = 100;
const MAX_SERIES_DEPTH = 10;

// Entity collections compared across books, with the field that names them.
const SHARED_CANON = [
  ["characters", "Characters", "name"],
  ["locations", "Locations", "name"],
  ["systems", "Systems", "name"],
  ["factions", "Factions", "name"],
  ["artifacts", "Artifacts", "name"],
  ["glossaryTerms", "Glossary terms", "term"]
];

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

export function readBookFrontmatter(root) {
  const storyPath = path.join(root, "story.md");
  if (!fs.existsSync(storyPath)) {
    return null;
  }
  return parseFrontmatter(fs.readFileSync(storyPath, "utf8"), storyPath).data;
}

export function validateSeriesLinks(root, data, errors) {
  for (const [field, inverse] of SERIES_LINK_INVERSES) {
    for (const target of seriesLinks(root, data, field)) {
      const label = `story.md ${field} ${seriesLinkPath(root, target)}`;
      if (target === root) {
        errors.push(`${label} points at this book`);
        continue;
      }

      let other;
      try {
        other = readBookFrontmatter(target);
      } catch (error) {
        errors.push(`${label}: ${error.message}`);
        continue;
      }
      if (!other) {
        errors.push(`${label} is not a story project: missing story.md`);
        continue;
      }

      if (!seriesLinks(target, other, inverse).includes(root)) {
        errors.push(`${label} is missing backlink: add ${seriesLinkPath(target, root)} to its ${inverse}`);
      }
      if (data.series !== undefined && other.series !== undefined && data.series !== other.series) {
        errors.push(`${label} belongs to series ${other.series}, not ${data.series}`);
      }
    }
  }
}

// Returns an existing book's story.md with a reciprocal link added, or null
// when the link is already present.
export function withSeriesBacklink(targetRoot, field, linkedRoot) {
  const storyPath = path.join(targetRoot, "story.md");
  const markdown = fs.readFileSync(storyPath, "utf8");
  const { data } = parseFrontmatter(markdown, storyPath);
  if (seriesLinks(targetRoot, data, field).includes(linkedRoot)) {
    return null;
  }
  const raw = data[field];
  const existing = Array.isArray(raw)
    ? raw
    : typeof raw === "string" && raw.trim() !== ""
      ? [raw]
      : [];
  return replaceFrontmatter(markdown, { ...data, [field]: existing.concat(seriesLinkPath(targetRoot, linkedRoot)) });
}

export function buildSeries(startRoot, scan) {
  const errors = [];
  const warnings = [];
  const books = discoverBooks(startRoot, scan, errors);
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
    errors.push(`Linked books belong to different series: ${seriesIds.join(", ")}`);
  }

  const chronology = chronologicalOrder(books, errors);
  if (chronology) {
    checkSharedCanon(chronology, errors, warnings);
  }

  return {
    root: startRoot,
    series: books[0].series ?? seriesIds[0] ?? null,
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
    `# Series: ${report.series ?? "Unnamed series"}`,
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
  const queue = [{ root: startResolved, depth: 0 }];
  while (queue.length > 0) {
    const { root, depth } = queue.shift();
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
      errors.push('Series links exceed the ' + MAX_SERIES_BOOKS + ' book limit; refusing to traverse further');
      break;
    }

    const label = seriesLinkPath(startRoot, root) || '.';
    if (!isPathInside(scopeRoot, resolved) || !isPathInside(scopeReal, effective)) {
      errors.push(label + ' points outside the series directory ' + scopeRoot + '; refusing to follow');
      visited.set(effective, null);
      continue;
    }
    if (depth > MAX_SERIES_DEPTH) {
      errors.push(label + ' exceeds the series traversal depth of ' + MAX_SERIES_DEPTH + '; refusing to follow further links');
      visited.set(effective, null);
      continue;
    }
    if (!fs.existsSync(path.join(root, "story.md"))) {
      errors.push(`${label} is not a story project: missing story.md`);
      visited.set(effective, null);
      continue;
    }

    const project = scan(root);
    for (const scanError of project.fileErrors ?? []) {
      errors.push(`${label}: ${scanError}`);
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
      series: data.series,
      status: data.status,
      bookNumber: Number.isInteger(data["book-number"]) ? data["book-number"] : null,
      follows: seriesLinks(root, data, "follows"),
      precedes: seriesLinks(root, data, "precedes")
    };
    visited.set(effective, book);
    for (const next of book.follows.concat(book.precedes)) {
      queue.push({ root: next, depth: depth + 1 });
    }
  }
  return [...visited.values()].filter(Boolean);
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
  while (ready.length > 0) {
    ready.sort(compareBooks);
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
    errors.push(`Series chronology has a cycle between ${cycle.join(", ")}; check follows and precedes`);
    return null;
  }
  return { order, later };
}

// Books with no chronological constraint between them fall back to
// publication order, then title, so the report is deterministic.
function compareBooks(left, right) {
  return (left.bookNumber ?? Infinity) - (right.bookNumber ?? Infinity) || left.title.localeCompare(right.title);
}

function checkSharedCanon({ order, later }, errors, warnings) {
  const reachable = new Map(order.map((book) => [book.key, collectLater(book.key, later, new Set())]));

  for (const book of order) {
    const earlierBooks = order.filter((candidate) => reachable.get(candidate.key).has(book.key));
    checkCanonNames(book, earlierBooks, warnings);
    checkCanonDeaths(book, earlierBooks, errors);
    checkDestroyedArtifacts(book, earlierBooks, warnings);
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
      if (match && entity[field] !== match.entity[field]) {
        warnings.push(`${bookFile(book, entity.file)} ${field} "${entity[field]}" differs from "${match.entity[field]}" in ${bookFile(match.book, match.entity.file)}`);
      }
    }
  }
}

// A character who dies in an earlier book stays dead: the later book must mark
// them deceased and keep them out of on-page casts.
function checkCanonDeaths(book, earlierBooks, errors) {
  const deaths = firstMatching(earlierBooks, "characters", (character) => character.status === "deceased");
  for (const character of book.project.characters) {
    const death = deaths.get(character.id);
    if (!death) {
      continue;
    }
    if (character.status !== "deceased") {
      errors.push(`${bookFile(book, character.file)} has status ${character.status || "unset"}, but ${character.id} is deceased in earlier book ${death.title}; set status: deceased`);
    }
  }

  for (const record of book.project.chapters.concat(book.project.scenes)) {
    for (const [id, death] of deaths) {
      if (record.pov === id || record.characters.includes(id)) {
        errors.push(`${bookFile(book, record.file)} lists ${id}, who died in earlier book ${death.title}; move appearances to mentions`);
      }
    }
  }
}

function checkDestroyedArtifacts(book, earlierBooks, warnings) {
  const destroyed = firstMatching(earlierBooks, "artifacts", (artifact) => artifact.status === "destroyed");
  for (const artifact of book.project.artifacts) {
    const earlier = destroyed.get(artifact.id);
    if (earlier && artifact.status !== "destroyed") {
      warnings.push(`${bookFile(book, artifact.file)} has status ${artifact.status || "unset"}, but ${artifact.id} was destroyed in earlier book ${earlier.title}`);
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
      errors.push(`${bookFile(book, entry.file)} knowledge-state[${entry.index}] has ${entry.character} learn ${entry.fact} in ${entry.learnedIn}, but they already know it in earlier book ${prior.book.title} (${bookFile(prior.book, prior.entry.file)} knowledge-state[${prior.entry.index}])`);
    }
  }
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
        key: `${entry.character} ${fact}`,
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
