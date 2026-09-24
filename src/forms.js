// Story forms and their usual word-count ranges. The ranges follow common
// award and market conventions; they are advisory, so a book outside its
// form's range is a warning, not an error. Serials have no range because
// installments vary.

export const STORY_FORMS = new Map([
  ["flash", { min: 1, max: 1500, target: 1000 }],
  ["short-story", { min: 1000, max: 7500, target: 5000 }],
  ["novelette", { min: 7500, max: 17500, target: 12000 }],
  ["novella", { min: 17500, max: 40000, target: 30000 }],
  ["novel", { min: 40000, max: 200000, target: 80000 }],
  ["serial", { min: null, max: null, target: null }],
  ["picture-book", { min: 1, max: 1000, target: 500 }],
  ["chapter-book", { min: 4000, max: 15000, target: 10000 }]
]);

export function formRangeWarning(form, words, label) {
  const range = STORY_FORMS.get(form);
  if (!range || range.min === null || !Number.isInteger(words) || words <= 0) {
    return "";
  }
  if (words < range.min || words > range.max) {
    return `${label} ${words} is outside the usual ${form} range of ${range.min}-${range.max} words`;
  }
  return "";
}
