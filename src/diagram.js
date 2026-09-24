import { buildTimeline } from "./timeline.js";

// Mermaid diagram source generated from frontmatter. The output is text, so
// it diffs cleanly, renders on GitHub and in most markdown editors, and is
// rebuilt from the same fields the checks read.

export const DIAGRAM_KINDS = ["relationships", "locations", "timeline", "clues", "arcs"];

const FAMILY_TYPES = new Set([
  "parent", "child", "sibling", "spouse", "partner", "grandparent", "grandchild",
  "aunt", "uncle", "niece", "nephew", "cousin"
]);
// Directed family links are drawn from the elder side only, so each pair has
// one edge.
const ELDER_TYPES = new Set(["parent", "grandparent", "aunt", "uncle"]);
const YOUNGER_TYPES = new Set(["child", "grandchild", "niece", "nephew"]);

export function buildDiagram(project, kind) {
  switch (kind) {
    case "relationships":
      return relationshipDiagram(project);
    case "locations":
      return locationDiagram(project);
    case "timeline":
      return timelineDiagram(project);
    case "clues":
      return clueDiagram(project);
    case "arcs":
      return arcDiagram(project);
    default:
      throw new Error(`Unknown diagram kind: ${kind ?? "(none)"}. Supported kinds: ${DIAGRAM_KINDS.join(", ")}`);
  }
}

function relationshipDiagram(project) {
  const characters = [...project.characters].sort(byId);
  const known = new Set(characters.map((character) => character.id));
  const lines = ["flowchart LR"];
  for (const character of characters) {
    lines.push(`  ${nodeId(character.id)}["${label(character.name)}"]`);
  }
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
      const from = nodeId(character.id);
      const to = nodeId(other);
      if (ELDER_TYPES.has(type)) {
        lines.push(`  ${from} ==>|${label(type)}| ${to}`);
      } else if (FAMILY_TYPES.has(type)) {
        lines.push(`  ${from} ===|${label(type)}| ${to}`);
      } else {
        lines.push(`  ${from} -.-|${label(type || "related")}| ${to}`);
      }
    }
  }
  const deceased = characters.filter((character) => character.status === "deceased").map((character) => nodeId(character.id));
  if (deceased.length > 0) {
    lines.push("  classDef deceased stroke-dasharray: 4 4,color:#888", `  class ${deceased.join(",")} deceased`);
  }
  return `${lines.join("\n")}\n`;
}

function locationDiagram(project) {
  const locations = [...project.locations].sort(byId);
  const known = new Set(locations.map((location) => location.id));
  const lines = ["flowchart LR"];
  for (const location of locations) {
    const region = location.region ? `<br/>${label(location.region)}` : "";
    lines.push(`  ${nodeId(location.id)}["${label(location.name)}${region}"]`);
  }
  const routes = [];
  for (const location of locations) {
    for (const route of location.routes ?? []) {
      if (route && typeof route === "object" && known.has(route.to) && route.to !== location.id && typeof route.hours === "number") {
        routes.push({ from: location.id, to: route.to, hours: route.hours, mode: typeof route.mode === "string" ? route.mode : "" });
      }
    }
  }
  const declared = new Set(routes.map((route) => `${route.from}>${route.to}`));
  for (const route of routes) {
    const text = label([`${route.hours}h`, route.mode].filter(Boolean).join(" "));
    if (declared.has(`${route.to}>${route.from}`)) {
      lines.push(`  ${nodeId(route.from)} -->|${text}| ${nodeId(route.to)}`);
    } else {
      lines.push(`  ${nodeId(route.from)} ---|${text}| ${nodeId(route.to)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function timelineDiagram(project) {
  const { chronology } = buildTimeline(project);
  const lines = ["timeline", `  title ${timelineText(project.story.data.title ?? "Timeline")}`];
  let section = null;
  for (const entry of chronology) {
    if (entry.date !== section) {
      section = entry.date;
      lines.push(`  section ${entry.date}`);
    }
    const when = entry.time || "day";
    const note = entry.toldLate ? ` (told in chapter ${entry.chapterNumber})` : "";
    lines.push(`    ${timelineText(when)} : ${timelineText(`${entry.title}${note}`)}`);
  }
  return `${lines.join("\n")}\n`;
}

function clueDiagram(project) {
  const chapters = [...project.chapters].sort((left, right) => left.number - right.number || byId(left, right));
  const known = new Set(chapters.map((chapter) => chapter.id));
  const lines = ["flowchart LR"];
  for (const chapter of chapters) {
    lines.push(`  ${nodeId(chapter.id)}["${chapter.number}. ${label(chapter.title)}"]`);
  }
  for (let index = 1; index < chapters.length; index += 1) {
    lines.push(`  ${nodeId(chapters[index - 1].id)} ~~~ ${nodeId(chapters[index].id)}`);
  }
  let unrevealed = false;
  for (const clue of [...project.clues].sort(byId)) {
    if (!known.has(clue.planted) || clue.status === "dropped" || clue.status === "abandoned") {
      continue;
    }
    const arrow = clue.redHerring ? "-.->" : "-->";
    const text = label(clue.redHerring ? `${clue.title} (red herring)` : clue.title);
    if (known.has(clue.payoff)) {
      lines.push(`  ${nodeId(clue.planted)} ${arrow}|${text}| ${nodeId(clue.payoff)}`);
    } else {
      unrevealed = true;
      lines.push(`  ${nodeId(clue.planted)} ${arrow}|${text}| unrevealed(("not yet revealed"))`);
    }
  }
  if (unrevealed) {
    lines.push("  classDef open stroke-dasharray: 4 4", "  class unrevealed open");
  }
  return `${lines.join("\n")}\n`;
}

function arcDiagram(project) {
  const chapters = [...project.chapters].sort((left, right) => left.number - right.number || byId(left, right));
  const arcs = [...project.arcs].sort(byId);
  const knownArcs = new Set(arcs.map((arc) => arc.id));
  const lines = ["flowchart LR"];
  for (const arc of arcs) {
    lines.push(`  ${nodeId(`arc-${arc.id}`)}(["${label(arc.name)}"])`);
  }
  for (const chapter of chapters) {
    lines.push(`  ${nodeId(chapter.id)}["${chapter.number}. ${label(chapter.title)}"]`);
  }
  for (const chapter of chapters) {
    const advanced = new Set(chapter.arcsAdvanced);
    for (const scene of project.scenes) {
      if (scene.chapter === chapter.id) {
        scene.arcsAdvanced.forEach((arcId) => advanced.add(arcId));
      }
    }
    for (const arcId of [...advanced].filter((id) => knownArcs.has(id)).sort()) {
      lines.push(`  ${nodeId(`arc-${arcId}`)} --> ${nodeId(chapter.id)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function byId(left, right) {
  return left.id.localeCompare(right.id, "en");
}

// Mermaid ids cannot safely contain hyphens next to arrows, so ids use
// underscores; labels carry the readable names.
function nodeId(id) {
  return String(id).replace(/[^A-Za-z0-9]/g, "_");
}

function label(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "#quot;")
    .replace(/\|/g, "#124;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\s+/g, " ")
    .trim();
}

// Mermaid timeline syntax splits on colons, so they become a similar mark.
function timelineText(text) {
  return String(text).replace(/:/g, "∶").replace(/\s+/g, " ").trim();
}
