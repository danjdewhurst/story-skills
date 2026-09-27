import { isSceneBreak, withoutFencedCode } from "./markdown.js";
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

function signed(value) {
  return `${value > 0 ? "+" : value < 0 ? "-" : "±"}${formatNumber(Math.abs(value))}`;
}

function formatNumber(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
