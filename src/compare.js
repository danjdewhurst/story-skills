// Compares two versions of a manuscript chapter by chapter. Chapters match by
// id (chapter-NN), so a renumbered chapter shows as changed, removed, or
// added rather than moved. "Unchanged" is the share of the current chapter's
// paragraphs that appear verbatim in the earlier version.

export function compareChapters(previous, current) {
  const before = new Map(previous.map((chapter) => [chapter.id, chapter]));
  const after = new Map(current.map((chapter) => [chapter.id, chapter]));
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort((left, right) => left.localeCompare(right, "en", { numeric: true }));

  const chapters = ids.map((id) => {
    const old = before.get(id);
    const now = after.get(id);
    if (!old) {
      return { id, title: now.title, status: "added", before: 0, after: now.words, unchanged: 0 };
    }
    if (!now) {
      return { id, title: old.title, status: "removed", before: old.words, after: 0, unchanged: 0 };
    }
    const unchanged = unchangedShare(old.paragraphs, now.paragraphs);
    return {
      id,
      title: now.title,
      status: unchanged === 1 && old.paragraphs.length === now.paragraphs.length ? "unchanged" : "changed",
      before: old.words,
      after: now.words,
      unchanged
    };
  });

  const total = (list) => list.reduce((sum, chapter) => sum + chapter.words, 0);
  return {
    chapters,
    beforeChapters: previous.length,
    afterChapters: current.length,
    beforeWords: total(previous),
    afterWords: total(current)
  };
}

export function proseParagraphs(prose) {
  return String(prose)
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function unchangedShare(oldParagraphs, newParagraphs) {
  if (newParagraphs.length === 0) {
    return oldParagraphs.length === 0 ? 1 : 0;
  }
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
  return kept / newParagraphs.length;
}

export function formatComparison(comparison, label) {
  const added = comparison.chapters.filter((chapter) => chapter.status === "added").length;
  const removed = comparison.chapters.filter((chapter) => chapter.status === "removed").length;
  const lines = [
    `Compared with ${label}`,
    `Chapters: ${comparison.beforeChapters} then, ${comparison.afterChapters} now (${added} added, ${removed} removed)`,
    `Words: ${formatNumber(comparison.beforeWords)} then, ${formatNumber(comparison.afterWords)} now (${signed(comparison.afterWords - comparison.beforeWords)})`,
    ""
  ];
  if (comparison.chapters.length === 0) {
    lines.push("- No chapters in either version");
  }
  for (const chapter of comparison.chapters) {
    const name = `${chapter.id} ${chapter.title}`;
    if (chapter.status === "added") {
      lines.push(`- ${name}: added (${formatNumber(chapter.after)} words)`);
    } else if (chapter.status === "removed") {
      lines.push(`- ${name}: removed (was ${formatNumber(chapter.before)} words)`);
    } else if (chapter.status === "unchanged") {
      lines.push(`- ${name}: unchanged (${formatNumber(chapter.after)} words)`);
    } else {
      lines.push(`- ${name}: ${formatNumber(chapter.before)} -> ${formatNumber(chapter.after)} words (${signed(chapter.after - chapter.before)}), ${Math.round(chapter.unchanged * 100)}% of paragraphs unchanged`);
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
