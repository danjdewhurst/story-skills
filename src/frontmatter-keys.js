// The frontmatter keys each kind of file defines, as schemas/story.schema.json
// lists them (`story` is story.md; the rest are the schema's $defs). The
// runtime cannot read the schema itself, since the copied fallback ships
// without it, so test/frontmatter-keys.test.js keeps the two lists equal.
export const FRONTMATTER_KEYS = {
  story: ["title", "schema-version", "series", "series-title", "book-number", "follows", "precedes", "genre", "sub-genre", "setting-era", "status", "themes", "pov", "tense", "premise", "counter-premise", "author", "contact", "season-goal", "target-words", "target-characters", "count-unit", "language", "isbn", "publisher", "publication-date", "description", "keywords", "subjects", "copyright", "ifid", "cover-alt", "ai-disclosure", "chapter-label", "writing-mode", "chapter-numerals", "contents-label", "labels", "authors", "form", "draft-mode", "cover", "deadline", "revision-passes", "cli-defaults", "severity"],
  character: ["pronunciation", "id", "name", "role", "status", "died-in", "revived-in", "aliases", "relationships", "locations", "tags", "arc", "arc-type", "lie", "truth", "ghost-wound", "voice-words", "voice-avoid", "progressions"],
  location: ["pronunciation", "id", "name", "type", "region", "population", "controlled-by", "notable-characters", "tags", "status", "setting", "routes", "progressions"],
  system: ["id", "name", "type", "prevalence", "pronunciation"],
  faction: ["pronunciation", "id", "name", "type", "status", "members", "locations", "tags", "progressions"],
  artifact: ["pronunciation", "id", "name", "type", "status", "owner", "location", "tags"],
  arc: ["id", "name", "type", "status", "characters", "themes", "acts", "mice-threads"],
  chapter: ["id", "title", "number", "numbered", "status", "pov", "word-count", "target-words", "character-count", "target-characters", "arcs-advanced", "characters", "mentions", "locations", "mode", "date", "time", "strand", "episode-question", "hook", "time-skip", "choices"],
  scene: ["id", "title", "chapter", "scene", "status", "pov", "location", "characters", "mentions", "arcs-advanced", "state-changes", "date", "time", "travel-hours", "sequel", "outcome", "dilemma", "flashback-to", "setting"],
  question: ["id", "title", "status", "introduced", "resolved", "characters"],
  promise: ["id", "title", "status", "planted", "payoff", "arcs", "characters"],
  clue: ["id", "title", "status", "planted", "payoff", "significance-delayed", "red-herring", "arcs", "characters"],
  term: ["pronunciation", "id", "term", "category", "aliases"],
  research: ["id", "title", "status", "sources", "used-in", "accuracy", "confidence", "method", "risk", "reviewed-by"],
  matter: ["id", "title", "placement", "order", "heading", "permission", "rights-holder", "credit"],
  characterState: ["character", "location", "physical", "emotional", "knowledge"],
  objectState: ["artifact", "owner", "location", "status", "since"],
  knowledgeState: ["character", "knows", "fact", "learned-in"]
};

// Every key some kind defines. A key valid on another kind (`location` on a
// chapter, `arcs` on a scene) is left alone: it may be deliberate, and
// guessing the nearest key here would mislead.
const EVERY_KEY = new Set(Object.values(FRONTMATTER_KEYS).flat());

// Keys a near miss may extend, such as `since_chapter` or `died-in-ch`.
const PREFIX_KEYS = new Set(["since", "learned-in", "died-in"]);

// The known key `key` most likely misspells, or undefined. Case, `_` or a
// space for `-`, and dropped hyphens always count; otherwise the edit
// distance (a swap of two neighbours counts once) must be at most 1 for a
// known key of 4 or 5 characters and 2 for a longer one. Distance never
// matches a key under 4 characters or a known key under 4, so short custom
// fields such as `age` stay quiet.
export function nearMissKey(key, known) {
  if (known.includes(key) || EVERY_KEY.has(key)) {
    return undefined;
  }
  const normalized = key.trim().toLowerCase().replace(/[\s_]+/g, "-");
  const squashed = normalized.replace(/-/g, "");
  const exact = known.find((candidate) => normalized === candidate
    || squashed === candidate.replace(/-/g, "")
    || (PREFIX_KEYS.has(candidate) && normalized.startsWith(`${candidate}-`)));
  if (exact !== undefined || EVERY_KEY.has(normalized) || normalized.length < 4) {
    return exact;
  }
  let best;
  let bestDistance = Infinity;
  for (const candidate of known) {
    const limit = candidate.length >= 6 ? 2 : candidate.length >= 4 ? 1 : 0;
    const distance = limit === 0 ? Infinity : typoDistance(normalized, candidate);
    if (distance <= limit && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

// Edit distance where swapping two neighbouring characters (`stauts`)
// counts as one edit, like a single insertion, deletion, or substitution.
function typoDistance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) {
    rows[0][j] = j;
  }
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }
  return rows[a.length][b.length];
}
