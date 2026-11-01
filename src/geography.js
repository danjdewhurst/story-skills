// Optional geography for the distance travel check. story.md sets the
// distance unit (free text, such as miles or leagues), the map scale (how
// many of those units one coordinate unit spans), and the travel modes,
// each with its top speed in distance units an hour and, optionally, the
// most distance a day of travel covers. A location gives `coordinates` on
// the story's own map, `[x, y]` in any grid, and `distances` to other
// locations in the distance unit. Nothing here assumes Earth: coordinates
// are a flat map, and a distance table needs no map at all.
//
// The distance between two places is, in this order: a distance listed
// between them, the straight line between their coordinates times the map
// scale, or the shortest chain of listed distances. A listed distance is the
// writer's own figure, so it wins; a straight line is never longer than the
// real way, so it comes before a chain, which may take the long way round.

export const DEFAULT_DISTANCE_UNIT = "units";

function isPositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isEntry(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// An id as story continuity reads it (idText there): text, or the number or
// boolean YAML read, as written.
export function referenceText(value) {
  if (typeof value === "string") {
    return value;
  }
  return typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}

export function foldMode(value) {
  return String(value).trim().replace(/\s+/g, " ").toLowerCase();
}

// The geography story.md describes, and every problem with it. `modes` is
// empty when no usable travel mode is set, and the distance check then runs
// on nothing, so a project without geography gets no new findings.
export function parseGeography(data = {}) {
  const problems = [];
  const unitValue = data["distance-unit"];
  let unit = DEFAULT_DISTANCE_UNIT;
  if (unitValue !== undefined) {
    if (typeof unitValue !== "string" || unitValue.trim() === "") {
      problems.push(`distance-unit must be text, such as miles or leagues, got ${unitValue}`);
    } else {
      unit = unitValue.trim();
    }
  }
  const scaleValue = data["map-scale"];
  let scale = 1;
  if (scaleValue !== undefined) {
    if (isPositive(scaleValue)) {
      scale = scaleValue;
    } else {
      // A scale that cannot be read turns the map off rather than guess.
      scale = null;
      problems.push(`map-scale must be a number greater than 0, the distance one coordinate unit spans, got ${scaleValue}`);
    }
  }
  const modes = [];
  const value = data["travel-modes"];
  if (value !== undefined && !Array.isArray(value)) {
    problems.push("travel-modes must be a list of entries, such as - mode: horse then speed: 8");
  }
  const seen = new Set();
  (Array.isArray(value) ? value : []).forEach((entry, index) => {
    const at = `travel-modes entry ${index + 1}`;
    if (!isEntry(entry)) {
      problems.push(`${at} must be a mode with a speed, such as - mode: horse then speed: 8`);
      return;
    }
    const before = problems.length;
    if (typeof entry.mode !== "string" || entry.mode.trim() === "") {
      problems.push(`${at} mode must be text, such as horse or "on foot", got ${entry.mode ?? "nothing"}`);
    } else if (seen.has(foldMode(entry.mode))) {
      problems.push(`${at} mode ${entry.mode.trim()} appears more than once`);
    } else {
      seen.add(foldMode(entry.mode));
    }
    if (!isPositive(entry.speed)) {
      problems.push(`${at} speed must be a number greater than 0, in ${unit} an hour, got ${entry.speed ?? "nothing"}`);
    }
    if (entry["per-day"] !== undefined && !isPositive(entry["per-day"])) {
      problems.push(`${at} per-day must be a number greater than 0, in ${unit}, got ${entry["per-day"]}`);
    }
    if (problems.length === before) {
      modes.push({ mode: entry.mode.trim(), key: foldMode(entry.mode), speed: entry.speed, perDay: entry["per-day"] });
    }
  });
  return { geography: { unit, scale, modes }, problems };
}

// A location's `coordinates`: two finite numbers, or undefined.
export function locationCoordinates(value) {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((item) => typeof item === "number" && Number.isFinite(item))) {
    return undefined;
  }
  return value;
}

// The distance entries the check uses, one per declared direction: a known
// other location and a positive distance, keeping the shortest when a
// location lists the same destination twice.
export function usableDistances(locations) {
  const known = new Set(locations.map((location) => location.id));
  const shortest = new Map();
  for (const location of locations) {
    for (const entry of location.distances ?? []) {
      if (!isEntry(entry)) {
        continue;
      }
      const to = referenceText(entry.to);
      if (!known.has(to) || to === location.id || !isPositive(entry.distance)) {
        continue;
      }
      const key = `${location.id}>${to}`;
      if (!shortest.has(key) || shortest.get(key).distance > entry.distance) {
        shortest.set(key, { from: location.id, to, distance: entry.distance });
      }
    }
  }
  return [...shortest.values()];
}

// The hours a journey of `distance` takes at the least by `mode`: the
// distance at its speed, and, with `per-day`, a whole day of the story
// calendar for each full day's distance before the last stretch.
export function hoursNeeded(distance, mode, hoursPerDay) {
  const moving = distance / mode.speed;
  if (!isPositive(mode.perDay) || distance <= mode.perDay) {
    return moving;
  }
  const fullDays = Math.ceil(distance / mode.perDay - 1e-9) - 1;
  return Math.max(moving, fullDays * hoursPerDay + (distance - fullDays * mode.perDay) / mode.speed);
}

// A function from two location ids to `{ distance, basis }`, or undefined
// when the geography cannot say how far apart they are. `shortestFrom` is
// the shortest-path search the route check uses, over a graph of the same
// shape.
export function distanceResolver(locations, geography, shortestFrom) {
  const direct = new Map();
  const graph = new Map();
  const addEdge = (from, to, distance) => {
    if (!graph.has(from)) {
      graph.set(from, new Map());
    }
    const edges = graph.get(from);
    if (!edges.has(to) || edges.get(to) > distance) {
      edges.set(to, distance);
    }
  };
  const entries = usableDistances(locations);
  const declared = new Set(entries.map((entry) => `${entry.from}>${entry.to}`));
  // A distance is the same both ways unless the destination lists its own.
  for (const { from, to, distance } of entries) {
    direct.set(`${from}>${to}`, distance);
    addEdge(from, to, distance);
    if (!declared.has(`${to}>${from}`)) {
      direct.set(`${to}>${from}`, distance);
      addEdge(to, from, distance);
    }
  }
  const coordinates = new Map();
  for (const location of locations) {
    const point = locationCoordinates(location.coordinates);
    if (point) {
      coordinates.set(location.id, point);
    }
  }
  const chains = new Map();
  return (from, to) => {
    if (direct.has(`${from}>${to}`)) {
      return { distance: direct.get(`${from}>${to}`), basis: "listed" };
    }
    if (geography.scale !== null && coordinates.has(from) && coordinates.has(to)) {
      const [x1, y1] = coordinates.get(from);
      const [x2, y2] = coordinates.get(to);
      return { distance: Math.hypot(x2 - x1, y2 - y1) * geography.scale, basis: "map" };
    }
    if (!graph.has(from) || !graph.has(to)) {
      return undefined;
    }
    if (!chains.has(from)) {
      chains.set(from, shortestFrom(graph, from));
    }
    const distance = chains.get(from).get(to);
    return distance === undefined ? undefined : { distance, basis: "chain" };
  };
}
