// Story forms, the unit a manuscript's length is counted in, and each form's
// usual length. The word ranges follow common award and market
// conventions; character ranges come from the language pack (see
// ../docs/project-format.md for their sources). They are advisory, so a
// book outside its form's range is a warning, not an error. Serials have no
// range because installments vary.

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

// The units a length is counted in, by story.md `count-unit`: the noun the
// output prints, the chapter field that records the count, and the target
// fields (the book and the daily target). Chinese and Japanese count characters (10万字), every other
// language words.
export const COUNT_UNITS = new Map([
  ["words", { name: "words", noun: "word", title: "Words", countField: "word-count", targetField: "target-words", dailyTargetField: "daily-target-words" }],
  ["characters", { name: "characters", noun: "character", title: "Characters", countField: "character-count", targetField: "target-characters", dailyTargetField: "daily-target-characters" }]
]);

// The project's count unit: story.md `count-unit` when it names one, else
// the language pack's. validate reports any other value.
export function countUnit(storyData, pack) {
  const value = storyData?.["count-unit"];
  return COUNT_UNITS.get(COUNT_UNITS.has(value) ? value : pack?.countUnit) ?? COUNT_UNITS.get("words");
}

// Each form's { min, max, target } in the unit, or null when the pack has
// no ranges for it (a language counted in characters without its own).
// A character range covers only the forms a source sets, and `max` is null
// where the source gives only a minimum; a form without a range, and a book
// with none, is never checked.
export function formRanges(unit, pack) {
  if (unit.name === "words") {
    return STORY_FORMS;
  }
  const ranges = pack?.characterForms;
  return ranges ? new Map(Object.entries(ranges)) : null;
}

export function formRangeWarning(form, count, label, ranges = STORY_FORMS, unit = COUNT_UNITS.get("words")) {
  const range = ranges?.get(form);
  if (!range || range.min === null || !Number.isInteger(count) || count <= 0) {
    return "";
  }
  if (range.max === null) {
    return count < range.min ? `${label} ${count} is under the usual ${form} minimum of ${range.min} ${unit.name}` : "";
  }
  if (count < range.min || count > range.max) {
    return `${label} ${count} is outside the usual ${form} range of ${range.min}-${range.max} ${unit.name}`;
  }
  return "";
}
