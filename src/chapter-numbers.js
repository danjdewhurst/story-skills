// The number each chapter prints in a book or a codex, keyed by chapter id.
// An unnumbered chapter (`numbered: false`, such as a prologue) takes no
// number, so the chapters after it count from the author's numbers less one
// for each: Prologue, Chapter 1, Chapter 2. An unnumbered chapter's entry is
// null. The scan records `numbered`, so no chapter file is read again here.
export function printedChapterNumbers(project) {
  const printed = new Map();
  let unnumberedSoFar = 0;
  for (const chapter of project.chapters) {
    unnumberedSoFar += chapter.numbered ? 0 : 1;
    printed.set(chapter.id, chapter.numbered ? chapter.number - unnumberedSoFar : null);
  }
  return printed;
}
