import { isSceneBreak, withoutFencedCode } from "./markdown.js";
import { openingWords } from "./html.js";
import { formatPercent } from "./progress.js";

// Compares two versions of a manuscript chapter by chapter. Chapters match by
// id (chapter-NN), except that a chapter whose paragraphs match another id's
// better, as after `story move` renumbers chapters, is paired with that one
// and reported as moved. "Unchanged" is the share of the current chapter's
// paragraphs that appear verbatim in the earlier version; a chapter is
// "unchanged" only when its paragraphs are the same and in the same order.

// A chapter under another id is the same chapter moved when at least this
// share of its paragraphs match.
const MOVED_SHARE = 0.5;

export function compareChapters(previous, current) {
  const pairs = pairChapters(previous, current);
  const pairedOld = new Set(pairs.map(([old]) => old));
  const pairedNew = new Set(pairs.map(([, now]) => now));

  const chapters = [
    ...pairs.map(([old, now]) => {
      const entry = {
        id: now.id,
        title: now.title,
        status: sameParagraphs(old.paragraphs, now.paragraphs) ? "unchanged" : "changed",
        before: old.words,
        after: now.words,
        unchanged: unchangedShare(old.paragraphs, now.paragraphs)
      };
      return old.id === now.id ? entry : { ...entry, movedFrom: old.id };
    }),
    ...current.filter((now) => !pairedNew.has(now)).map((now) => ({ id: now.id, title: now.title, status: "added", before: 0, after: now.words, unchanged: 0 })),
    ...previous.filter((old) => !pairedOld.has(old)).map((old) => ({ id: old.id, title: old.title, status: "removed", before: old.words, after: 0, unchanged: 0 }))
  ].sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }) || (left.status === "removed") - (right.status === "removed"));

  const total = (list) => list.reduce((sum, chapter) => sum + chapter.words, 0);
  return {
    chapters,
    beforeChapters: previous.length,
    afterChapters: current.length,
    beforeWords: total(previous),
    afterWords: total(current)
  };
}

// Prose paragraphs without code between closed fences or scene-break lines,
// which are not prose that can match.
export function proseParagraphs(prose) {
  return withoutFencedCode(String(prose))
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph !== "" && !isSceneBreak(paragraph));
}

// Pairs old chapters with current ones. The closest content matches go first,
// same id winning a tie; a pair under different ids needs MOVED_SHARE of the
// larger chapter's paragraphs to match. Chapters left over pair by id.
function pairChapters(previous, current) {
  const candidates = [];
  for (const old of previous) {
    for (const now of current) {
      const sameId = old.id === now.id;
      const score = old.paragraphs.length === 0 || now.paragraphs.length === 0
        ? 0
        : keptParagraphs(old.paragraphs, now.paragraphs) / Math.max(old.paragraphs.length, now.paragraphs.length);
      if (score >= MOVED_SHARE) {
        candidates.push({ old, now, score, sameId });
      }
    }
  }
  candidates.sort((left, right) => right.score - left.score || right.sameId - left.sameId);
  const pairs = [];
  const usedOld = new Set();
  const usedNew = new Set();
  const take = (old, now) => {
    pairs.push([old, now]);
    usedOld.add(old);
    usedNew.add(now);
  };
  for (const { old, now } of candidates) {
    if (!usedOld.has(old) && !usedNew.has(now)) {
      take(old, now);
    }
  }
  const byId = new Map(previous.filter((old) => !usedOld.has(old)).map((old) => [old.id, old]));
  for (const now of current) {
    const old = byId.get(now.id);
    if (!usedNew.has(now) && old) {
      take(old, now);
    }
  }
  return pairs;
}

function sameParagraphs(left, right) {
  return left.length === right.length && left.every((paragraph, index) => paragraph === right[index]);
}

function unchangedShare(oldParagraphs, newParagraphs) {
  if (newParagraphs.length === 0) {
    return oldParagraphs.length === 0 ? 1 : 0;
  }
  return keptParagraphs(oldParagraphs, newParagraphs) / newParagraphs.length;
}

// How many current paragraphs appear verbatim in the old list, each old
// paragraph used once.
function keptParagraphs(oldParagraphs, newParagraphs) {
  const remaining = new Map();
  for (const paragraph of oldParagraphs) {
    remaining.set(paragraph, (remaining.get(paragraph) ?? 0) + 1);
  }
  let kept = 0;
  for (const paragraph of newParagraphs) {
    const count = remaining.get(paragraph) ?? 0;
    if (count > 0) {
      kept += 1;
      remaining.set(paragraph, count - 1);
    }
  }
  return kept;
}

export function formatComparison(comparison, label) {
  const added = comparison.chapters.filter((chapter) => chapter.status === "added").length;
  const removed = comparison.chapters.filter((chapter) => chapter.status === "removed").length;
  const moved = comparison.chapters.filter((chapter) => chapter.movedFrom).length;
  const lines = [
    `Compared with ${label}`,
    `Chapters: ${comparison.beforeChapters} then, ${comparison.afterChapters} now (${added} added, ${removed} removed${moved > 0 ? `, ${moved} moved` : ""})`,
    `Words: ${formatNumber(comparison.beforeWords)} then, ${formatNumber(comparison.afterWords)} now (${signed(comparison.afterWords - comparison.beforeWords)})`,
    ""
  ];
  if (comparison.chapters.length === 0) {
    lines.push("- No chapters in either version");
  }
  for (const chapter of comparison.chapters) {
    const name = `${chapter.id} ${chapter.title}${chapter.movedFrom ? ` (moved from ${chapter.movedFrom})` : ""}`;
    if (chapter.status === "added") {
      lines.push(`- ${name}: added (${formatNumber(chapter.after)} words)`);
    } else if (chapter.status === "removed") {
      lines.push(`- ${name}: removed (was ${formatNumber(chapter.before)} words)`);
    } else if (chapter.status === "unchanged") {
      lines.push(`- ${name}: unchanged (${formatNumber(chapter.after)} words)`);
    } else {
      lines.push(`- ${name}: ${formatNumber(chapter.before)} -> ${formatNumber(chapter.after)} words (${signed(chapter.after - chapter.before)}), ${formatPercent(chapter.unchanged * 100, 0)}% of paragraphs unchanged`);
    }
  }
  return `${lines.join("\n")}\n`;
}

// A paragraph that changed counts as the same one when its words overlap
// this much (Dice coefficient on word multisets).
const SIMILAR_SHARE = 0.5;

// Maps review-copy labels from an earlier version to the current one. Both
// lists are paragraphLabels() output, { label, key, text }. For each
// requested label: the same text (the nearest copy, preferring the same
// chapter or matter page), else the most similar paragraph at SIMILAR_SHARE
// or more, else not found. Returns one entry per label, in the order asked:
// { label, status: "unchanged" | "edited" | "not-found" | "unknown", to,
// similarity, excerpt }.
export function mapLabels(previous, current, labels) {
  const oldByLabel = new Map(previous.map((entry, index) => [entry.label, { ...entry, index }]));
  const words = current.map((entry) => wordBag(entry.text));
  const exact = exactPairs(previous, current);
  const reserved = new Set(exact.values());
  return labels.map((label) => {
    const old = oldByLabel.get(label);
    if (!old) {
      return { label, status: "unknown" };
    }
    if (exact.has(old.index)) {
      return { label, status: "unchanged", to: current[exact.get(old.index)].label, similarity: 1 };
    }
    const closer = (left, right) => (right.key === old.key) - (left.key === old.key) || Math.abs(left.index - old.index) - Math.abs(right.index - old.index);
    const bag = wordBag(old.text);
    const best = current
      .map((entry, index) => ({ ...entry, index, similarity: dice(bag, words[index]) }))
      .filter((entry) => !reserved.has(entry.index) && entry.similarity >= SIMILAR_SHARE)
      .sort((left, right) => right.similarity - left.similarity || closer(left, right))[0];
    if (best) {
      return { label, status: "edited", to: best.label, similarity: best.similarity };
    }
    return { label, status: "not-found", excerpt: openingWords(old.text) };
  });
}

// Pairs old and current paragraphs with the same text one to one, closest
// first (same part, then nearest position), so two copies of a repeated
// paragraph never both claim the one that survived. Returns a Map from old
// index to current index.
function exactPairs(previous, current) {
  const byText = new Map();
  current.forEach((entry, index) => {
    const text = normalise(entry.text);
    byText.set(text, (byText.get(text) ?? []).concat(index));
  });
  const pairs = [];
  previous.forEach((entry, oldIndex) => {
    for (const newIndex of byText.get(normalise(entry.text)) ?? []) {
      pairs.push({ oldIndex, newIndex, sameKey: current[newIndex].key === entry.key, distance: Math.abs(newIndex - oldIndex) });
    }
  });
  pairs.sort((left, right) => right.sameKey - left.sameKey || left.distance - right.distance || left.oldIndex - right.oldIndex);
  const matched = new Map();
  const taken = new Set();
  for (const { oldIndex, newIndex } of pairs) {
    if (!matched.has(oldIndex) && !taken.has(newIndex)) {
      matched.set(oldIndex, newIndex);
      taken.add(newIndex);
    }
  }
  return matched;
}

function normalise(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

// Lowercased words (letters, digits, and inner apostrophes) with counts.
function wordBag(text) {
  const bag = new Map();
  for (const word of String(text).toLowerCase().match(/[\p{L}\p{N}]+(?:['\u2019][\p{L}\p{N}]+)*/gu) ?? []) {
    bag.set(word, (bag.get(word) ?? 0) + 1);
  }
  return bag;
}

function dice(left, right) {
  let shared = 0;
  let total = 0;
  for (const [word, count] of left) {
    shared += Math.min(count, right.get(word) ?? 0);
    total += count;
  }
  for (const count of right.values()) {
    total += count;
  }
  return total === 0 ? 0 : (2 * shared) / total;
}

export function formatLabelMapping(mapping, label) {
  const lines = mapping.map((entry) => {
    if (entry.status === "unknown") {
      return `${entry.label}: no such label in ${label}`;
    }
    if (entry.status === "not-found") {
      return `${entry.label}: not found in the current text ("${entry.excerpt}")`;
    }
    if (entry.status === "unchanged") {
      return `${entry.label} -> ${entry.to} (text unchanged)`;
    }
    // An edit that keeps every word (punctuation only) still is not 100%.
    return `${entry.label} -> ${entry.to} (edited, ${Math.min(99, Math.round(entry.similarity * 100))}% similar)`;
  });
  return `${lines.join("\n")}\n`;
}

function signed(value) {
  return `${value > 0 ? "+" : value < 0 ? "-" : "±"}${formatNumber(Math.abs(value))}`;
}

export function formatNumber(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
