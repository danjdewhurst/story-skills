import { chapterChronology } from "./chronology.js";
import { usableRoutes } from "./continuity.js";
import { characterLifeline } from "./deaths.js";
import { buildTimeline } from "./timeline.js";
import { usageError } from "./exit-codes.js";

// Mermaid diagram source generated from frontmatter. The output is text, so
// it diffs cleanly, renders on GitHub and in most markdown editors, and is
// rebuilt from the same fields the checks read.
//
// Each kind first builds a small model keyed by project ids: nodes, edges,
// and for the timeline, groups. The Mermaid text is rendered from that model
// alone, and story diagram --json returns the model beside the text.

export const DIAGRAM_KINDS = ["relationships", "locations", "timeline", "clues", "arcs"];

const FAMILY_TYPES = new Set([
  "parent", "child", "sibling", "spouse", "partner", "grandparent", "grandchild",
  "aunt", "uncle", "niece", "nephew", "cousin"
]);
// Directed family links are drawn from the elder side only, so each pair has
// one edge.
const ELDER_TYPES = new Set(["parent", "grandparent", "aunt", "uncle"]);
const YOUNGER_TYPES = new Set(["child", "grandchild", "niece", "nephew"]);

const KINDS = {
  relationships: { model: relationshipModel, render: renderRelationships },
  locations: { model: locationModel, render: renderLocations },
  timeline: { model: timelineModel, render: renderTimeline },
  clues: { model: clueModel, render: renderClues },
  arcs: { model: arcModel, render: renderArcs }
};

// The model for one kind plus its Mermaid text.
export function buildDiagram(project, kind) {
  const entry = Object.hasOwn(KINDS, kind ?? "") ? KINDS[kind] : null;
  if (entry === null) {
    throw usageError(`Unknown diagram kind: ${kind ?? "(none)"}. Supported kinds: ${DIAGRAM_KINDS.join(", ")}`);
  }
  const model = entry.model(project);
  return { ...model, text: entry.render(model) };
}

function relationshipModel(project) {
  const characters = [...project.characters].sort(byId);
  const known = new Set(characters.map((character) => character.id));
  // Each character as they stand at the end of the book, read as story
  // continuity reads deaths (see deaths.js): dead by died-in, a status
  // progression, or status deceased; revived when they died and came back.
  const chronology = chapterChronology(project);
  const nodes = characters.map((character) => {
    const lifeline = characterLifeline(character, chronology);
    const state = lifeline.deadAtEnd ? "deceased"
      : lifeline.events.some((event) => event.type === "revival") ? "revived" : "alive";
    return { id: character.id, label: plainText(character.name), kind: "character", state };
  });
  const edges = [];
  const drawn = new Set();
  for (const character of characters) {
    for (const relationship of character.relationships) {
      if (!relationship || typeof relationship !== "object" || typeof relationship.character !== "string") {
        continue;
      }
      const other = relationship.character;
      const type = String(relationship.type ?? "");
      if (!known.has(other) || YOUNGER_TYPES.has(type)) {
        continue;
      }
      const pair = [character.id, other].sort().join(" ");
      if (!ELDER_TYPES.has(type) && drawn.has(pair)) {
        continue;
      }
      drawn.add(pair);
      const kind = ELDER_TYPES.has(type) ? "family-directed" : FAMILY_TYPES.has(type) ? "family" : "relationship";
      edges.push({ from: character.id, to: other, label: plainText(type || "related"), kind });
    }
  }
  return { nodes, edges };
}

const RELATIONSHIP_ARROWS = { "family-directed": "==>", family: "===", relationship: "-.-" };

function renderRelationships({ nodes, edges }) {
  const lines = ["flowchart LR"];
  for (const node of nodes) {
    lines.push(`  ${nodeId(node.id)}["${label(node.label)}"]`);
  }
  for (const edge of edges) {
    lines.push(`  ${nodeId(edge.from)} ${RELATIONSHIP_ARROWS[edge.kind]}${edgeLabel(edge.label)} ${nodeId(edge.to)}`);
  }
  const deceased = nodes.filter((node) => node.state === "deceased").map((node) => nodeId(node.id));
  const revived = nodes.filter((node) => node.state === "revived").map((node) => nodeId(node.id));
  if (deceased.length > 0) {
    lines.push("  classDef deceased stroke-dasharray: 4 4,color:#888", `  class ${deceased.join(",")} deceased`);
  }
  if (revived.length > 0) {
    lines.push("  classDef revived stroke-width:3px", `  class ${revived.join(",")} revived`);
  }
  return mermaid(lines);
}

function locationModel(project) {
  const locations = [...project.locations].sort(byId);
  const known = new Set(locations.map((location) => location.id));
  const nodes = locations.map((location) => ({
    id: location.id,
    label: plainText(location.name),
    kind: "location",
    region: location.region ? plainText(location.region) : null
  }));
  // The same routes the travel check uses: positive hours only, and the
  // fastest when a location lists one destination twice.
  const routes = usableRoutes(locations).filter((route) => known.has(route.from));
  const declared = new Set(routes.map((route) => `${route.from}>${route.to}`));
  const edges = routes.map((route) => ({
    from: route.from,
    to: route.to,
    label: plainText([`${route.hours}h`, route.mode].filter(Boolean).join(" ")),
    kind: "route",
    hours: route.hours,
    mode: route.mode ? String(route.mode) : null,
    // True when the destination declares a route back, so the pair is drawn
    // as two arrows rather than one line.
    reverse: declared.has(`${route.to}>${route.from}`)
  }));
  return { nodes, edges };
}

function renderLocations({ nodes, edges }) {
  const lines = ["flowchart LR"];
  for (const node of nodes) {
    const region = node.region === null ? "" : `<br/>${label(node.region)}`;
    lines.push(`  ${nodeId(node.id)}["${label(node.label)}${region}"]`);
  }
  for (const edge of edges) {
    lines.push(`  ${nodeId(edge.from)} ${edge.reverse ? "-->" : "---"}${edgeLabel(edge.label)} ${nodeId(edge.to)}`);
  }
  return mermaid(lines);
}

// Nodes are the dated events in story order; groups are the runs of events
// on one day, each drawn as a section. The timeline has no edges.
function timelineModel(project) {
  const { chronology } = buildTimeline(project);
  const nodes = chronology.map((entry) => ({
    id: entry.id,
    // An empty event after the colon does not parse; fall back to the id.
    label: plainText(entry.title ?? "") || entry.id,
    kind: "event",
    date: entry.date,
    time: entry.time || null,
    // The chapter an event told after later events is read in, else null.
    toldLateIn: entry.toldLate ? entry.chapterNumber : null
  }));
  const groups = [];
  for (const node of nodes) {
    if (groups.length === 0 || groups[groups.length - 1].label !== node.date) {
      groups.push({ label: node.date, kind: "date", nodes: [] });
    }
    groups[groups.length - 1].nodes.push(node.id);
  }
  return { title: plainText(project.title ?? "Timeline"), nodes, edges: [], groups };
}

function renderTimeline({ title, nodes }) {
  const lines = ["timeline", `  title ${timelineText(title)}`];
  let section = null;
  for (const node of nodes) {
    if (node.date !== section) {
      section = node.date;
      // A calendar's month and era names may hold a colon or a `#`.
      lines.push(`  section ${timelineText(node.date)}`);
    }
    const note = node.toldLateIn === null ? "" : ` (told in chapter ${node.toldLateIn})`;
    lines.push(`    ${timelineText(node.time ?? "day")} : ${timelineText(`${node.label}${note}`)}`);
  }
  return mermaid(lines);
}

// The node a clue with no payoff chapter yet points at. Its Mermaid id has
// a prefix, as arcNodeId gives arcs, so a chapter with the id unrevealed
// stays its own node.
const UNREVEALED = "unrevealed";
const UNREVEALED_NODE = "clue__unrevealed";

function clueModel(project) {
  const chapters = sortedChapters(project);
  const known = new Set(chapters.map((chapter) => chapter.id));
  const nodes = chapters.map(chapterNode);
  // Invisible links keep the chapters in reading order.
  const edges = [];
  for (let index = 1; index < chapters.length; index += 1) {
    edges.push({ from: chapters[index - 1].id, to: chapters[index].id, label: null, kind: "sequence" });
  }
  for (const clue of [...project.clues].sort(byId)) {
    if (!known.has(clue.planted) || clue.status === "dropped" || clue.status === "abandoned") {
      continue;
    }
    const revealed = known.has(clue.payoff);
    edges.push({
      from: clue.planted,
      to: revealed ? clue.payoff : UNREVEALED,
      // An empty label (`-->||`) does not parse; fall back to the id.
      label: plainText(clue.title ?? "") || clue.id,
      kind: clue.redHerring ? "red-herring" : "clue",
      clue: clue.id,
      revealed
    });
  }
  if (edges.some((edge) => edge.revealed === false)) {
    nodes.push({ id: UNREVEALED, label: "not yet revealed", kind: "unrevealed" });
  }
  return { nodes, edges };
}

function renderClues({ nodes, edges }) {
  const lines = ["flowchart LR"];
  for (const node of nodes) {
    if (node.kind === "chapter") {
      lines.push(chapterLine(node));
    }
  }
  for (const edge of edges) {
    if (edge.kind === "sequence") {
      lines.push(`  ${nodeId(edge.from)} ~~~ ${nodeId(edge.to)}`);
      continue;
    }
    const herring = edge.kind === "red-herring";
    const text = edgeLabel(herring ? `${edge.label} (red herring)` : edge.label);
    const to = edge.revealed ? nodeId(edge.to) : `${UNREVEALED_NODE}(("not yet revealed"))`;
    lines.push(`  ${nodeId(edge.from)} ${herring ? "-.->" : "-->"}${text} ${to}`);
  }
  if (nodes.some((node) => node.kind === "unrevealed")) {
    lines.push("  classDef open stroke-dasharray: 4 4", `  class ${UNREVEALED_NODE} open`);
  }
  return mermaid(lines);
}

// Edges always run from an arc to a chapter. An arc and a chapter may share
// an id; a node's kind tells them apart.
function arcModel(project) {
  const chapters = sortedChapters(project);
  const arcs = [...project.arcs].sort(byId);
  const knownArcs = new Set(arcs.map((arc) => arc.id));
  const nodes = [
    ...arcs.map((arc) => ({ id: arc.id, label: plainText(arc.name), kind: "arc" })),
    ...chapters.map(chapterNode)
  ];
  const edges = [];
  for (const chapter of chapters) {
    const advanced = new Set(chapter.arcsAdvanced);
    for (const scene of project.scenes) {
      if (scene.chapter === chapter.id) {
        scene.arcsAdvanced.forEach((arcId) => advanced.add(arcId));
      }
    }
    for (const arcId of [...advanced].filter((id) => knownArcs.has(id)).sort()) {
      edges.push({ from: arcId, to: chapter.id, label: null, kind: "advances" });
    }
  }
  return { nodes, edges };
}

function renderArcs({ nodes, edges }) {
  const lines = ["flowchart LR"];
  for (const node of nodes) {
    lines.push(node.kind === "arc" ? `  ${arcNodeId(node.id)}(["${label(node.label)}"])` : chapterLine(node));
  }
  for (const edge of edges) {
    lines.push(`  ${arcNodeId(edge.from)} --> ${nodeId(edge.to)}`);
  }
  return mermaid(lines);
}

function sortedChapters(project) {
  return [...project.chapters].sort((left, right) => left.number - right.number || byId(left, right));
}

function chapterNode(chapter) {
  return { id: chapter.id, label: plainText(chapter.title), kind: "chapter", number: chapter.number };
}

function chapterLine(node) {
  return `  ${nodeId(node.id)}["${node.number}. ${label(node.label)}"]`;
}

function mermaid(lines) {
  return `${lines.join("\n")}\n`;
}

function byId(left, right) {
  return left.id.localeCompare(right.id, "en");
}

// Words Mermaid reads as syntax when they stand alone as a node id; a
// character with the id `end` would otherwise close the graph.
const MERMAID_KEYWORDS = new Set(["end", "graph", "flowchart", "subgraph", "direction", "style", "class", "classdef", "click", "linkstyle", "default"]);

// Mermaid ids cannot safely contain hyphens next to arrows, so ids use
// underscores; labels carry the readable names.
function nodeId(id) {
  const safe = String(id).replace(/[^A-Za-z0-9]/g, "_");
  return MERMAID_KEYWORDS.has(safe.toLowerCase()) ? `${safe}_node` : safe;
}

// Kebab-case ids never contain "--", so the double underscore keeps arc
// nodes apart from chapter nodes whatever their ids.
function arcNodeId(id) {
  // The prefix already keeps an arc id clear of Mermaid keywords.
  return `arc__${String(id).replace(/[^A-Za-z0-9]/g, "_")}`;
}

// A model label: the readable text with runs of whitespace closed up, before
// any Mermaid escaping.
function plainText(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

// Characters Mermaid reads as syntax in a quoted label, each written as an
// entity code that renders as the character: `"` ends the label and `|` an
// edge label; `#`, a word, and `;` is itself an entity code ("Room #101;"
// would show "Room e"); `%` can spell a %%{init}%% directive, which Mermaid
// obeys anywhere in the source; a label in backticks is markdown; `:` lets
// Mermaid's pass for `style ... :#colour;` lines drop the `;` that ends an
// entity code; and `&`, `<`, and `>` are HTML. One pass, so no code is
// escaped twice.
const LABEL_ESCAPES = { "#": "#35;", "\"": "#quot;", "|": "#124;", "%": "#37;", "`": "#96;", ":": "#58;", "&": "&amp;", "<": "&lt;", ">": "&gt;" };

function label(text) {
  return String(text).replace(/\s+/g, " ").trim().replace(/[#"|%`:&<>]/g, (char) => LABEL_ESCAPES[char]);
}

// Edge labels are quoted so brackets and parentheses in them ("(red
// herring)", a route mode) are read as text, not node shapes.
function edgeLabel(text) {
  return `|"${label(text)}"|`;
}

// Mermaid timeline syntax splits on colons, so they become a similar mark.
// `#` and `;` start a comment or end the text in some Mermaid versions, and
// `#` and `%` form entity codes and directives as in a label, and `<br>`
// breaks the line, so those four are numeric entity codes, the only kind a
// timeline renders.
function timelineText(text) {
  return String(text).replace(/:/g, "∶").replace(/\s+/g, " ").trim().replace(/[#;%<]/g, (char) => `#${char.charCodeAt(0)};`);
}
