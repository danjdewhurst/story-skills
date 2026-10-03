import path from "node:path";
import { chapterChronology, deathWindow, formatKnowledgeMark, knowledgeAudience } from "./chronology.js";
import { idText, normalizeKnowledge } from "./continuity.js";
import { warn } from "./findings.js";
import { entityStateAt } from "./progressions.js";
import { projectError, usageError } from "./exit-codes.js";
import { extractSection } from "./markdown.js";
import { wordSpans } from "./words.js";

// `story context` packs the slice of a project an agent needs to draft one
// chapter or scene. buildContext is pure over the scanned project (the caller
// supplies readBody for entity bodies) and returns the data; formatContext
// turns it into markdown. Nothing from a later chapter is included, except a
// fact the POV character already knows in story time, marked
// character-knowledge so the draft does not reveal it.

export const DEFAULT_CONTEXT_BUDGET = 6000;
export const DEFAULT_CONTEXT_SCENES = 5;

// A fixed, deterministic estimate, not a tokenizer count. Unspaced scripts
// are split into words as `story wordcount` splits them: one word per
// Chinese or Japanese character, and a dictionary word for Thai, Lao, Khmer,
// and Burmese (see wordSpans). Everything else, punctuation left between
// those words included, counts as whitespace-separated runs, as before (not
// wordcount's letters-and-digits words). Spaced text stays at 4 tokens per
// 3 words, so text with no unspaced script costs ceil(words * 4 / 3) as
// before. The other rates are tokens per such word. Han is about 0.62 tokens
// per character on the GPT-4 and GPT-4o tokenizers, and Japanese text overall
// about 0.53 (Land & Arnett, "BPE Stays on SCRIPT", 2025, Table 4); Thai is
// about 0.32 to 0.43 tokens per character there, and a dictionary word is
// about three characters. Rates round up from those figures, so a budget
// errs toward leaving text out:
//   Han and katakana, including the long-vowel mark (its own word) → 2/3
//   Hiragana, the part of Japanese that merges into particles and endings → 1/2
//   Thai, and Lao, Khmer, and Burmese (not in that table, so they keep
//   Thai's rate) → 1 per dictionary word
// Costs are summed in sixths of a token and rounded up once.
const SPACED_SIXTHS = 8;
const TOKEN_SIXTHS = { han: 4, hiragana: 3, katakana: 4, thai: 6, lao: 6, khmer: 6, myanmar: 6 };
const HAN_CHAR = /^\p{Script=Han}$/u;
const HIRAGANA_CHAR = /^\p{Script=Hiragana}$/u;
const KATAKANA_CHAR = /^\p{Script=Katakana}$/u;
const THAI_CHAR = /^\p{Script=Thai}$/u;
const LAO_CHAR = /^\p{Script=Lao}$/u;
const KHMER_CHAR = /^\p{Script=Khmer}$/u;
const NOT_JOINER = /[^\u00AD\u200C\u200D]/u;
const KATAKANA_MARK = 0x30fc;
// Combining marks right after an unspaced word, such as a dakuten written
// as U+3099 or a variation selector after a Han character, belong to it.
const TRAILING_MARKS = /\p{M}*/uy;

// The script of one unspaced word, which is one character for Chinese and
// Japanese and a dictionary word otherwise. A soft hyphen or zero-width
// joiner inside a word is skipped. The katakana long-vowel mark has no
// script of its own, so it is priced with katakana.
function unspacedScript(word) {
  const letter = word.codePointAt(word.search(NOT_JOINER));
  const ch = String.fromCodePoint(letter);
  if (HAN_CHAR.test(ch)) {
    return "han";
  }
  if (HIRAGANA_CHAR.test(ch)) {
    return "hiragana";
  }
  if (letter === KATAKANA_MARK || KATAKANA_CHAR.test(ch)) {
    return "katakana";
  }
  if (THAI_CHAR.test(ch)) {
    return "thai";
  }
  if (LAO_CHAR.test(ch)) {
    return "lao";
  }
  if (KHMER_CHAR.test(ch)) {
    return "khmer";
  }
  return "myanmar";
}

export function estimateTokens(text) {
  const source = String(text);
  const parts = [];
  let last = 0;
  let sixths = 0;
  for (const span of wordSpans(source, /(?!)/gu)) {
    parts.push(source.slice(last, span.start));
    sixths += TOKEN_SIXTHS[unspacedScript(span.word)];
    TRAILING_MARKS.lastIndex = span.end;
    TRAILING_MARKS.exec(source);
    last = TRAILING_MARKS.lastIndex;
  }
  parts.push(source.slice(last));
  // A space stands in for each unspaced word, so the spaced words on either
  // side stay two words ("cat猫dog" is cat and dog, not catdog).
  sixths += parts.join(" ").split(/\s+/).filter(Boolean).length * SPACED_SIXTHS;
  return Math.ceil(sixths / 6);
}

// story.md sections safe to show at any chapter. The synopsis and free-form
// notes may describe the ending, so they stay out.
const STORY_SECTIONS = ["Tone & Style", "Setting", "Central Conflict"];
// Character sections that describe who someone is, not what happens to them.
// Backstory, Character Arc, and Timeline can reach past the target chapter.
const CARD_SECTIONS = ["Appearance", "Personality & Traits", "Motivations & Goals", "Voice & Speech Patterns"];
// The section of each thread that states the setup. Payoff and resolution
// plans describe later chapters, so they are never included.
const THREAD_SECTIONS = { promise: "Setup", clue: "Clue", question: "Question" };

// Starter text `story add` and `story init` write; a section still holding it
// says nothing, so it is left out.
const PLACEHOLDERS = new Set([
  "Add notes on the story's voice, texture, and emotional register.",
  "Add physical details that matter on the page.",
  "Add behavior, temperament, habits, and contradictions.",
  "External want, internal need, and the conflict between them.",
  "Add 2-3 example lines.",
  "What this scene changes.",
  "What is promised to the reader.",
  "What the reader sees and why it matters.",
  "What the reader or continuity tracker needs answered.",
  "1. Opening beat\n2. Escalation\n3. Turn or decision",
  // style-sheet.md as story init writes it, and as it did before samples.
  "The book's house decisions, kept the way a copyeditor keeps them. Read this before drafting or revising prose. `story prose` enforces the lists in the frontmatter: `dialect` (british, american, or unspecified) flags the other dialect's common spellings, each `preferred` entry flags its `avoid` form, `watch-words` are counted in every chapter, and `allow-words` silences a built-in filter word or adverb. Add a `samples` list of your own prose (`../book-one`, approved chapters) and `story prose` compares each chapter with it instead of fixed limits.",
  "The book's house decisions, kept the way a copyeditor keeps them. Read this before drafting or revising prose. `story prose` enforces the lists in the frontmatter: `dialect` (british, american, or unspecified) flags the other dialect's common spellings, each `preferred` entry flags its `avoid` form, `watch-words` are counted in every chapter, and `allow-words` silences a built-in filter word or adverb.",
  "Narrative distance, sentence rhythm, register, and what this prose never does. Quote two or three sentences that sound exactly right.",
  "Record one `preferred` entry per variant (`use: grey`, `avoid: gray`) and note usage rules here.",
  "Titles, ranks, institutions, invented terms, and deities. Invented terms also belong in the glossary.",
  "Spelled-out or numerals, and how in-world dates and times are written.",
  "Quote marks, dash style, ellipses, italics for thought or foreign words, and the default dialogue tags.",
  "One entry per POV character or major speaker: vocabulary, sentence length, verbal tics, and words they never use.",
  "Why each `watch-words` entry is there."
]);

function section(body, heading) {
  const text = extractSection(body, heading);
  return PLACEHOLDERS.has(text) ? "" : text;
}

function list(values) {
  return values.map((value) => String(value)).filter(Boolean).join(", ");
}

function field(label, value) {
  const text = Array.isArray(value) ? list(value) : String(value ?? "").trim();
  return text === "" ? null : `- ${label}: ${text}`;
}

// Joins lines, dropping the null an empty field or section returns; an empty
// string stays as a blank line.
function lines(...parts) {
  return parts.filter((part) => part !== null).join("\n");
}

// An optional subsection: null when the section is empty.
function subsection(heading, text) {
  return text === "" ? null : `\n#### ${heading}\n\n${demote(text)}`;
}

// The style sheet's rules: its body without the title, the starter intro,
// or any section that is empty or still holds starter text.
function styleRules(body) {
  return body.replace(/^\s*#[ \t][^\n]*\n/, "").split(/^(?=##[ \t])/m).map((part) => {
    const heading = /^##[ \t]+([^\n]*)\n?/.exec(part);
    const text = (heading ? part.slice(heading[0].length) : part).trim();
    if (text === "" || PLACEHOLDERS.has(text)) {
      return null;
    }
    return heading ? `#### ${heading[1].trim()}\n\n${demote(text)}` : demote(text);
  }).filter((part) => part !== null).join("\n\n");
}

// Pushes embedded headings two levels down, so a style sheet's `## Voice`
// sits under this document's `##` sections instead of beside them.
function demote(text) {
  return text.replace(/^(#{1,4})(?=[ \t])/gm, "##$1");
}

// A thread or scene note indented under its bullet; null when empty.
function indented(text) {
  return text === "" ? null : text.split("\n").map((line) => `  ${line}`.trimEnd()).join("\n");
}

// One packable unit. `source` is the project file to read when the budget
// leaves the item out.
function item(id, label, source, text) {
  return { id, label, source, text, tokens: estimateTokens(text) };
}

// Resolves where the target sits: its chapter, its reading-order number, and
// for a scene target, its scene number.
function resolveTarget(project, targetId) {
  const chapter = project.chapters.find((entry) => entry.id === targetId);
  if (chapter) {
    return { kind: "chapter", id: chapter.id, chapter, scene: null };
  }
  const scene = project.scenes.find((entry) => entry.id === targetId);
  if (!scene) {
    throw usageError(`Unknown chapter or scene ${targetId}`);
  }
  const owner = project.chapters.find((entry) => entry.id === scene.chapter);
  if (!owner) {
    throw projectError(`Scene ${targetId} belongs to unknown chapter ${scene.chapter}`);
  }
  return { kind: "scene", id: scene.id, chapter: owner, scene };
}

// An entity's state at the target chapter: its frontmatter with the
// progressions applied (see progressions.js). Only progressions from chapters
// read by the target count, so a change recorded for a later chapter, even
// one set earlier in story time, never shows; entityStateAt then applies them
// in story order. A planned `chapter-NN` counts by its number.
export function entityStateAtTarget(frontmatter, chronology, chapterId) {
  const targetNumber = chronology.numbers.get(chapterId);
  const readBy = (from) => {
    const id = idText(from);
    const number = chronology.numbers.has(id) ? chronology.numbers.get(id) : Number(/^chapter-(\d+)$/.exec(id)?.[1]);
    return number <= targetNumber;
  };
  const data = frontmatter ?? {};
  const progressions = asList(data.progressions).filter((entry) => isMapping(entry) && readBy(entry.from));
  return entityStateAt({ ...data, progressions }, chapterId, chronology);
}

// A character's state at the target chapter: progressions applied, and a
// status that never reveals a death or revival read after the target.
export function characterStateAt(character, chronology, chapterId) {
  const { state, changes } = entityStateAtTarget(character.frontmatter, chronology, chapterId);
  return { status: statusAt(character, state, changes, chronology, chapterId), state, changes };
}

function statusAt(character, state, changes, chronology, chapterId) {
  const died = String(character.diedIn ?? "");
  const status = String(state.status ?? character.status ?? "");
  if (died === "") {
    // A `deceased` status with no died-in chapter, and no progression dating
    // it, cannot be placed, so it is left out rather than risk revealing a
    // later death.
    return status === "deceased" && !changes.some((change) => change.field === "status") ? "" : status;
  }
  if (died === chapterId) {
    return "dies in this chapter";
  }
  // Read by the target: at or before it in reading order.
  const readBy = (id) => chronology.numbers.has(id) && chronology.numbers.get(id) <= chronology.numbers.get(chapterId);
  const deadIn = (revivedIn) => {
    const window = deathWindow({ ...character, revivedIn }, chronology);
    return window !== null && window.deadIn(chapterId);
  };
  const revivedIn = String(character.revivedIn ?? "");
  const deadNow = deadIn(readBy(revivedIn) ? revivedIn : "");
  // A revival read after the target is not known yet; when it would change
  // the answer (it happens before the target in story time), say nothing.
  if (revivedIn !== "" && !readBy(revivedIn) && deadNow !== deadIn(revivedIn)) {
    return "";
  }
  // A death in a later or unwritten chapter is not known yet. In a
  // flash-forward set after that death the character is dead in story time,
  // so the status is left out rather than shown as alive.
  if (!readBy(died)) {
    return deadNow ? "" : "alive";
  }
  return deadNow ? `deceased (died in ${died})` : "alive";
}

// One line per progression applied by the target chapter.
function changeLines(changes, chapterId) {
  return changes.map((change) => `- From ${change.from === chapterId ? "this chapter" : change.from}: ${change.field} ${change.value}`);
}

// A list field after progressions: a progression sets a single value.
function listOf(value) {
  return Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value];
}

// Builds the context for one chapter or scene. `readBody(file)` returns an
// entity file's markdown body. Returns every candidate item with an
// `included` flag, so a JSON view can show what the budget dropped.
export function buildContext(project, targetId, readBody, options = {}) {
  const budget = options.budget ?? DEFAULT_CONTEXT_BUDGET;
  const sceneLimit = options.scenes ?? DEFAULT_CONTEXT_SCENES;
  const target = resolveTarget(project, targetId);
  const chronology = chapterChronology(project);
  const targetNumber = target.chapter.number;
  // Reading order: a chapter id counts only when it is known and not after
  // the target chapter.
  const upToTarget = (chapterId) => chronology.numbers.has(chapterId) && chronology.numbers.get(chapterId) <= targetNumber;
  const characters = new Map(project.characters.map((character) => [character.id, character]));
  const nameOf = (id) => (characters.has(id) ? `${characters.get(id).name} (${id})` : id);
  const unit = target.scene ?? target.chapter;
  // A scene with no POV of its own is told from its chapter's.
  const pov = idText(unit.pov) || idText(target.chapter.pov);
  const cast = [...new Set([pov, ...unit.characters.map(idText)].filter(Boolean))];
  const relative = (file) => path.relative(project.root, file);
  const statePath = path.join("continuity", "state.md");

  const sections = [];

  // 1. What is being drafted.
  const chapterBody = readBody(target.chapter.file);
  const chapterScenes = project.scenes.filter((scene) => scene.chapter === target.chapter.id);
  const targetLines = [
    `### ${target.kind === "scene" ? `Scene ${target.scene.scene} of ` : ""}Chapter ${targetNumber}: ${target.chapter.title}`,
    field("Scene", target.scene ? target.scene.title : ""),
    field("POV", pov === "" ? "" : nameOf(pov)),
    field("On the page", cast.map(nameOf)),
    field("Mentioned", unit.mentions.map(idText).map(nameOf)),
    field("Locations", target.scene ? [idText(target.scene.location)] : target.chapter.locations.map(idText)),
    field("Arcs advanced", unit.arcsAdvanced),
    field("Date", [unit.date, unit.time].filter(Boolean).join(" ")),
    field("Outcome", target.scene ? target.scene.outcome : ""),
    field("Hook", target.chapter.hook),
    project.unit?.name === "characters"
      ? field("Target characters", target.chapter.targetCount || "")
      : field("Target words", target.chapter.targetWords || "")
  ];
  // The outline ends at the `---` rule above the prose, or at the next
  // heading, so the chapter's own prose never comes along.
  const outline = extractSection(chapterBody, "Outline").split(/^[ \t]*(?:-{3,}|\*{3,})[ \t]*$/m)[0].trim();
  if (outline !== "" && !PLACEHOLDERS.has(outline)) {
    targetLines.push("", "Chapter outline:", "", outline);
  }
  if (target.scene) {
    const purpose = section(readBody(target.scene.file), "Purpose");
    if (purpose !== "") {
      targetLines.push("", "Scene purpose:", "", purpose);
    }
  } else if (chapterScenes.length > 0) {
    targetLines.push("", "Scenes planned:", "", ...chapterScenes.map((scene) => `${scene.scene}. ${scene.title}${scene.outcome ? ` (outcome: ${scene.outcome})` : ""}`));
  }
  sections.push({ id: "target", title: "Target", items: [item(`target:${target.id}`, "Target", [target.chapter, target.scene].filter(Boolean).map((entry) => relative(entry.file)).join(", "), lines(...targetLines))] });

  // 2. story.md essentials and style-sheet rules. The language contract is a
  // property of the book, not of a chapter, so it is included at every target.
  // It is its own small item, packed first, so a long Tone & Style or Setting
  // section that does not fit the budget cannot take it out of the pack.
  const essentials = [];
  const story = project.story.data;
  essentials.push(item("language", "Language contract", "story.md", lines(
    "### Language contract",
    field("Language", project.language),
    field("Writing mode", story["writing-mode"] || "horizontal"),
    field("Chapter numerals", story["chapter-numerals"] || "western"),
    field("Count unit", project.unit.name)
  )));
  const storyText = lines(
    `### ${project.title}`,
    field("Genre", [story.genre, story["sub-genre"]].filter(Boolean).join(" / ")),
    field("Setting era", story["setting-era"]),
    field("POV", story.pov),
    field("Tense", story.tense),
    field("Form", story.form),
    field("Themes", Array.isArray(story.themes) ? story.themes : [story.themes].filter(Boolean)),
    field("Premise", story.premise),
    ...STORY_SECTIONS.map((heading) => subsection(heading, section(project.story.body ?? "", heading)))
  );
  essentials.push(item("story", "story.md essentials", "story.md", storyText));
  if (project.styleSheet) {
    const data = project.styleSheet.data;
    const preferred = (Array.isArray(data.preferred) ? data.preferred : [])
      .filter((entry) => isMapping(entry) && typeof entry.use === "string" && typeof entry.avoid === "string")
      .map((entry) => `${entry.use} (not ${entry.avoid})`);
    const body = styleRules(project.styleSheet.body);
    essentials.push(item("style-sheet", "Style sheet", relative(project.styleSheet.file), lines(
      "### Style sheet",
      field("Dialect", data.dialect),
      field("Preferred", preferred),
      field("Watch words", Array.isArray(data["watch-words"]) ? data["watch-words"] : []),
      body === "" ? null : `\n${body}`
    )));
  }
  sections.push({ id: "essentials", title: "Story essentials", items: essentials });

  // 3. The POV character's knowledge and state at this point.
  const povItems = [];
  if (pov !== "") {
    const known = [];
    for (const entry of project.continuity ? asList(project.continuity.data["knowledge-state"]) : []) {
      if (!isMapping(entry) || idText(entry.character) !== pov || String(entry.knows ?? "").trim() === "") {
        continue;
      }
      const learnedIn = idText(entry["learned-in"]);
      // Story time decides whether the POV knows it, as `story knowledge`
      // does; reading order decides whether the reader has seen it. A fact
      // learned later in story time (or in an unknown chapter) is left out.
      const audience = knowledgeAudience(chronology, learnedIn, target.chapter.id);
      if (audience === null) {
        continue;
      }
      // Knowledge is stored per chapter. A chapter target is what is known
      // by the end of the chapter. For a scene, a same-chapter fact is on
      // the page only once an earlier scene's state-changes records it;
      // otherwise the fact text would spoil a later reveal.
      let scene = "";
      if (target.scene && learnedIn === target.chapter.id) {
        const recorded = earlierScenes(project, target, () => false).find((candidate) => sceneRecordsFact(candidate, pov, entry));
        if (!recorded) {
          continue;
        }
        scene = String(recorded.scene);
      }
      const mark = formatKnowledgeMark(learnedIn, audience, { atChapterId: target.chapter.id, scene });
      known.push(`- ${entry.knows} (${mark})`);
    }
    if (known.length > 0) {
      povItems.push(item(`knowledge:${pov}`, `What ${nameOf(pov)} knows`, statePath, lines(`### What ${nameOf(pov)} knows`, ...known)));
    }

    const state = [];
    // Every file the state lines come from, for the omitted-items list.
    const stateSources = new Set();
    // continuity/state.md describes `current-chapter`; it is only safe when
    // that point is before the target.
    const currentChapter = project.continuity ? Number(project.continuity.data["current-chapter"]) : NaN;
    if (Number.isInteger(currentChapter) && currentChapter < targetNumber) {
      for (const entry of asList(project.continuity.data["character-state"])) {
        if (isMapping(entry) && idText(entry.character) === pov) {
          state.push(`- As of chapter ${currentChapter}: ${describeMapping(entry, ["character"])}`);
          stateSources.add(statePath);
        }
      }
    }
    for (const scene of earlierScenes(project, target, upToTarget)) {
      for (const change of scene.stateChanges) {
        // A character change, or an artifact change that hands the POV
        // character something (`target: <artifact>`, `owner: <pov>`).
        if (isMapping(change) && (idText(change.character) === pov || idText(change.owner) === pov)) {
          state.push(`- ${scene.chapter} scene ${scene.scene}: ${describeMapping(change, ["character"])}`);
          stateSources.add(relative(scene.file));
        }
      }
    }
    const povCharacter = characters.get(pov);
    if (povCharacter) {
      const { changes } = characterStateAt(povCharacter, chronology, target.chapter.id);
      if (changes.length > 0) {
        state.push(...changeLines(changes, target.chapter.id));
        stateSources.add(relative(povCharacter.file));
      }
    }
    if (state.length > 0) {
      povItems.push(item(`state:${pov}`, `${nameOf(pov)}'s state`, [...stateSources].join(", "), lines(`### ${nameOf(pov)}'s state`, ...state)));
    }
  }
  sections.push({ id: "pov", title: "POV knowledge and state", items: povItems });

  // 4. Cards for the characters on the page, POV first.
  const cards = [];
  for (const id of cast) {
    const character = characters.get(id);
    if (!character) {
      continue;
    }
    const body = readBody(character.file);
    const state = characterStateAt(character, chronology, target.chapter.id);
    // The POV character's changes are listed under its state.
    const changes = id === pov ? [] : changeLines(state.changes, target.chapter.id);
    cards.push(item(`character:${id}`, `Card: ${character.name}`, relative(character.file), lines(
      `### ${character.name}${id === pov ? " (POV)" : ""}`,
      field("Id", id),
      field("Role", state.state.role ?? character.role),
      field("Status", state.status),
      field("Aliases", listOf(state.state.aliases)),
      field("Voice words", listOf(state.state["voice-words"])),
      field("Voice avoid", listOf(state.state["voice-avoid"])),
      ...changes,
      ...CARD_SECTIONS.map((heading) => subsection(heading, section(body, heading)))
    )));
  }
  sections.push({ id: "characters", title: "Characters on the page", items: cards });

  // 5. Where it happens: each location at the target, progressions applied.
  const places = [];
  const locationIds = target.scene ? [idText(target.scene.location)] : target.chapter.locations.map(idText);
  for (const location of project.locations.filter((entry) => locationIds.includes(entry.id))) {
    const { state, changes } = entityStateAtTarget(location.frontmatter, chronology, target.chapter.id);
    places.push(item(`location:${location.id}`, `Location: ${location.name}`, relative(location.file), lines(
      `### ${state.name ?? location.name}`,
      field("Id", location.id),
      field("Type", state.type),
      field("Region", state.region),
      field("Status", state.status),
      field("Controlled by", state["controlled-by"]),
      ...changeLines(changes, target.chapter.id)
    )));
  }
  sections.push({ id: "locations", title: "Where it happens", items: places });

  // 6. Open promises, clues, and questions at this point.
  const threads = [];
  const kinds = [
    ["promise", project.promises, "planted", "payoff"],
    ["clue", project.clues, "planted", "payoff"],
    ["question", project.questions, "introduced", "resolved"]
  ];
  for (const [kind, entries, startField, endField] of kinds) {
    for (const entry of entries) {
      const start = idText(entry[startField]);
      const end = idText(entry[endField]);
      if (["abandoned", "dropped"].includes(entry.status) || !upToTarget(start)) {
        continue;
      }
      // Closed before the target: nothing left to carry.
      if (end !== "" && upToTarget(end) && end !== target.chapter.id) {
        continue;
      }
      const notes = [kind];
      notes.push(start === target.chapter.id ? `${startField === "planted" ? "plant" : "raise"} in this chapter` : `${startField} in ${start}`);
      if (end === target.chapter.id) {
        notes.push(kind === "question" ? "answer in this chapter" : "pay off in this chapter");
      }
      if (entry.redHerring) {
        notes.push("red herring");
      }
      const text = section(readBody(entry.file), THREAD_SECTIONS[kind]);
      threads.push(item(`${kind}:${entry.id}`, `${kind[0].toUpperCase()}${kind.slice(1)}: ${entry.title}`, relative(entry.file), lines(
        `- **${entry.title}** (${notes.join("; ")})`,
        indented(text)
      )));
    }
  }
  sections.push({ id: "threads", title: "Open promises, clues, and questions", items: threads });

  // 7. Summaries of the scenes just before the target, nearest first for the
  // budget, printed in reading order.
  const before = earlierScenes(project, target, upToTarget);
  // slice(-0) would keep every scene, so count from the front.
  const previous = before.slice(Math.max(0, before.length - sceneLimit)).reverse().map((scene) => {
    const purpose = section(readBody(scene.file), "Purpose");
    const facts = [scene.pov ? `POV ${idText(scene.pov)}` : "", scene.location ? `at ${idText(scene.location)}` : "", scene.outcome ? `outcome ${scene.outcome}` : ""].filter(Boolean).join(", ");
    return item(`scene:${scene.id}`, `Scene: ${scene.title}`, relative(scene.file), lines(
      `- **${scene.chapter} scene ${scene.scene}: ${scene.title}**${facts === "" ? "" : ` (${facts})`}`,
      indented(purpose)
    ));
  });
  sections.push({ id: "scenes", title: "Previous scenes", items: previous });

  // Pack in priority order: an item that does not fit is left out and the
  // next, smaller one may still fit.
  let used = 0;
  const omitted = [];
  for (const entry of sections) {
    for (const candidate of entry.items) {
      candidate.included = used + candidate.tokens <= budget;
      if (candidate.included) {
        used += candidate.tokens;
      } else {
        omitted.push({ id: candidate.id, label: candidate.label, source: candidate.source, tokens: candidate.tokens });
      }
    }
  }
  // Packed nearest first; shown in reading order.
  previous.reverse();

  // Files left out because they failed to parse; each message names its file.
  const warnings = (project.fileErrors ?? []).map((error) => warn("context-file-skipped", error.message, error.file));
  return {
    target: { kind: target.kind, id: target.id, chapter: target.chapter.id, number: targetNumber, title: target.chapter.title },
    budget,
    estimatedTokens: used,
    sections,
    omitted,
    warnings
  };
}

// Whether this scene's state-changes record the POV character learning the
// knowledge-state entry. Matched the way continuity pairs a scene knowledge
// change with an entry: the same `fact` id, or the same text aside from
// case, spacing, and a trailing full stop or exclamation mark. A paraphrase
// that matches neither stays out, so an unrelated change in an earlier scene
// cannot pull the fact in.
function sceneRecordsFact(scene, characterId, entry) {
  const fact = entry.fact === undefined ? "" : String(entry.fact);
  const knows = normalizeKnowledge(entry.knows);
  for (const change of scene.stateChanges) {
    if (!recordsKnowledge(change, characterId)) {
      continue;
    }
    if (sameFact(fact, change) || sameKnowledgeText(knows, change.knowledge)) {
      return true;
    }
  }
  return false;
}

function recordsKnowledge(change, characterId) {
  return isMapping(change) && idText(change.character) === characterId && change.knowledge !== undefined;
}

function sameFact(fact, change) {
  if (fact === "") {
    return false;
  }
  const changeFact = change.fact === undefined ? "" : String(change.fact);
  return changeFact === fact;
}

function sameKnowledgeText(knows, knowledge) {
  return knows !== "" && normalizeKnowledge(knowledge) === knows;
}

// Scenes before the target in reading order: every scene of an earlier
// chapter, and for a scene target, the earlier scenes of its own chapter.
function earlierScenes(project, target, upToTarget) {
  return project.scenes.filter((scene) => {
    if (scene.chapter === target.chapter.id) {
      return target.scene !== null && scene.scene < target.scene.scene;
    }
    return upToTarget(scene.chapter);
  });
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function isMapping(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function describeMapping(entry, skip) {
  return Object.entries(entry)
    .filter(([key, value]) => !skip.includes(key) && String(value ?? "").trim() !== "")
    .map(([key, value]) => `${key} ${value}`)
    .join("; ");
}

export function formatContext(context) {
  const { target } = context;
  const out = [
    `# Drafting context: ${target.id}`,
    "",
    `Chapter ${target.number}: ${target.title}. About ${context.estimatedTokens} of ${context.budget} tokens`,
    "(estimated at 4 tokens per 3 words in spaced text; 2 per 3 Han or katakana characters, 1 per 2 hiragana, and 1 per Thai, Lao, Khmer, or Burmese word). Later chapters are left out. A fact marked character-knowledge is known in story time; do not reveal it."
  ];
  for (const entry of context.sections) {
    const included = entry.items.filter((candidate) => candidate.included);
    if (included.length === 0) {
      continue;
    }
    out.push("", `## ${entry.title}`, "");
    const bullet = included[0].text.startsWith("- ");
    out.push(included.map((candidate) => candidate.text).join(bullet ? "\n" : "\n\n"));
  }
  if (context.omitted.length > 0) {
    out.push("", "## Left out to fit the budget", "", "Read these files directly if you need them:", "");
    for (const entry of context.omitted) {
      out.push(`- ${entry.label}: ${entry.source} (about ${entry.tokens} tokens)`);
    }
  }
  return `${out.join("\n")}\n`;
}
