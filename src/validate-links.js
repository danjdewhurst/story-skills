// Link checks over a scanned project: references between entity files,
// relationship backlinks, and links and ids in file bodies.
import fs from "node:fs";
import path from "node:path";
import { idText } from "./continuity.js";
import { parseFrontmatter } from "./frontmatter.js";
import { isPathInside, readTextFile } from "./files.js";
import { kebabCase } from "./markdown.js";
import { canonicalPath, seriesLinks, validateSeriesLinks } from "./series.js";
import { err, warn } from "./findings.js";
import {
  scanProject,
  canonicalChapterId,
  mayScheduleChapter,
  mapOutsideLinks,
  extractMarkdownLinkTargets,
  branchGraph,
  readMarkdown,
  fileErrorMessage,
  relativePathError,
  asArray,
  relative
} from "./scan.js";
import { hasMessage } from "./validate-fields.js";
import { portableSlashes } from "./validate-story.js";

// Aunt, uncle, niece, and nephew are gendered on both sides, so either
// gendered inverse is a valid backlink.
const RELATIONSHIP_INVERSES = new Map([
  ["parent", ["child"]],
  ["child", ["parent"]],
  ["grandparent", ["grandchild"]],
  ["grandchild", ["grandparent"]],
  ["uncle", ["nephew", "niece"]],
  ["aunt", ["nephew", "niece"]],
  ["nephew", ["uncle", "aunt"]],
  ["niece", ["uncle", "aunt"]],
  ["mentor", ["student"]],
  ["student", ["mentor"]],
  ["employer", ["subordinate"]],
  ["subordinate", ["employer"]],
  ["former-supervisor", ["former-subordinate"]],
  ["former-subordinate", ["former-supervisor"]]
]);

// Backlinks the pre-0.10.0 reference allowed: former-supervisor both ways,
// and adversary answered by antagonist.
const LEGACY_RELATIONSHIP_PAIRS = new Set([
  "former-supervisor>former-supervisor",
  "adversary>antagonist"
]);

const SYMMETRIC_RELATIONSHIPS = new Set([
  "sibling",
  "spouse",
  "partner",
  "friend",
  "ally",
  "rival",
  "enemy",
  "adversary",
  "cousin",
  "in-law",
  "colleague",
  "foil",
  "confidant",
  "love-interest"
]);

export function validateLinks(root) {
  return validateLinksOf(scanProject(root));
}

export function validateLinksOf(project) {
  const errors = [];
  const warnings = [];
  for (const scanError of project.fileErrors ?? []) {
    errors.push(scanError);
  }
  const characters = new Map(project.characters.map((item) => [item.id, item]));
  const locations = new Map(project.locations.map((item) => [item.id, item]));
  const chapters = new Map(project.chapters.map((item) => [item.id, item]));
  const arcs = new Map(project.arcs.map((item) => [item.id, item]));
  const factions = new Map(project.factions.map((item) => [item.id, item]));
  const hasCharacter = (id) => characters.has(id);
  const hasLocation = (id) => locations.has(id);
  const hasChapter = (id) => chapters.has(id);
  // A promise or clue may schedule its chapters ahead of drafting: a
  // `chapter-NN` with no file yet is a plan, not a broken link, until the
  // status says the setup or payoff is already on the page (see
  // mayScheduleChapter). `continuity` reads the same ids by their number.
  // An id whose number belongs to an existing chapter (`chapter-1` beside
  // `chapter-01`) is a typo, and chapter numbers start at 1.
  // A scheduled id must also use the spelling story add chapter writes
  // (chapter-01, not chapter-1), or it breaks once the chapter is added.
  const existingNumbers = new Set(project.chapters.map((chapter) => chapter.number));
  const hasScheduledChapter = (id) => {
    if (chapters.has(id)) {
      return true;
    }
    const match = /^chapter-(\d+)$/.exec(id);
    const number = match ? Number.parseInt(match[1], 10) : 0;
    return number > 0 && !existingNumbers.has(number) && id === canonicalChapterId(number);
  };
  const threadChapter = (kind, entry, field) => (mayScheduleChapter(kind, field, entry.status) ? hasScheduledChapter : hasChapter);
  const hasArc = (id) => arcs.has(id);
  // `mentions` may name characters or artifacts; prop custody checks read
  // artifact ids there.
  const artifactIds = new Set(project.artifacts.map((item) => item.id));
  const hasMention = (id) => characters.has(id) || artifactIds.has(id);

  for (const character of project.characters) {
    const label = relative(project, character.file);
    for (const relationship of character.relationships) {
      if (!relationship || typeof relationship !== "object" || Array.isArray(relationship)) {
        continue;
      }
      const target = relationship.character;
      if (typeof target !== "string" || target === "") {
        continue;
      }
      if (target !== kebabCase(target)) {
        errors.push(err("id-not-kebab", `${label} relationship character ${target} must be kebab-case`, label));
        continue;
      }
      if (!characters.has(target)) {
        errors.push(err("missing-reference", `${label} references missing character ${target}`, label));
      } else {
        const backlinks = [];
        for (const entry of characters.get(target).relationships) {
          if (entry && typeof entry === "object" && !Array.isArray(entry) && entry.character === character.id) {
            backlinks.push(entry);
          }
        }
        if (backlinks.length === 0) {
          errors.push(err("missing-backlink", `${label} relationship to ${target} is missing backlink`, label));
        } else {
          const expectedTypes = inverseRelationshipTypes(relationship.type);
          let matched = expectedTypes.length === 0;
          const types = [];
          for (const entry of backlinks) {
            if (entry.type) {
              types.push(entry.type);
            }
            if (expectedTypes.includes(entry.type)) {
              matched = true;
            }
          }
          const legacy = !matched && types.some((type) => LEGACY_RELATIONSHIP_PAIRS.has(`${relationship.type}>${type}`));
          if (legacy) {
            // Pairings the relationship reference recommended before 0.10.0
            // warn rather than fail, so an upgrade does not break CI.
            warnings.push(warn("legacy-backlink-type", `${label} relationship ${relationship.type} to ${target} has backlink ${types.join(", ")}, a pairing from before story-skills 0.10.0; change the backlink to ${expectedTypes.join(" or ")}`, label));
          } else if (!matched) {
            errors.push(err("backlink-type-mismatch", `${label} relationship ${relationship.type} to ${target} expects backlink type ${expectedTypes.join(" or ")}, got ${types.join(", ") || "none"}`, label));
          }
        }
      }
    }

    for (const locationId of character.locations) {
      checkIdReference(errors, label, locationId, "location", hasLocation);
      if (typeof locationId === "string" && locationId !== "" && locationId === kebabCase(locationId) && locations.has(locationId) && !locations.get(locationId).notableCharacters.includes(character.id)) {
        errors.push(err("missing-backlink", `${label} location ${locationId} is missing notable-character backlink`, label));
      }
    }

    if (character.diedIn) {
      checkIdReference(errors, label, character.diedIn, "chapter", hasChapter);
    }
    if (character.revivedIn) {
      checkIdReference(errors, label, character.revivedIn, "chapter", hasChapter);
    }
  }

  // A progression takes effect from a chapter, which may be one planned but
  // not written yet (`chapter-20` while drafting chapter 5).
  for (const entity of [...project.characters, ...project.locations, ...project.factions]) {
    for (const [index, item] of asArray(entity.frontmatter.progressions).entries()) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        checkIdReference(errors, `${relative(project, entity.file)} progressions[${index}]`, idText(item.from), "chapter", hasScheduledChapter, relative(project, entity.file));
      }
    }
  }

  for (const location of project.locations) {
    const label = relative(project, location.file);
    for (const route of location.routes) {
      const to = route && typeof route === "object" && !Array.isArray(route) ? idText(route.to) : "";
      if (to === "") {
        continue;
      }
      if (to === location.id) {
        errors.push(err("route-to-self", `${label} route points at itself`, label));
        continue;
      }
      checkIdReference(errors, `${label} route`, to, "location", hasLocation, label);
    }
    for (const entry of location.distances ?? []) {
      const to = entry && typeof entry === "object" && !Array.isArray(entry) ? idText(entry.to) : "";
      if (to === "") {
        continue;
      }
      if (to === location.id) {
        errors.push(err("distance-to-self", `${label} distance points at itself`, label));
        continue;
      }
      checkIdReference(errors, `${label} distance`, to, "location", hasLocation, label);
    }
    for (const characterId of location.notableCharacters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
      if (typeof characterId === "string" && characterId !== "" && characterId === kebabCase(characterId) && characters.has(characterId) && !characters.get(characterId).locations.includes(location.id)) {
        errors.push(err("missing-backlink", `${label} notable character ${characterId} is missing location backlink`, label));
      }
    }
  }

  for (const arc of project.arcs) {
    const label = relative(project, arc.file);
    for (const characterId of arc.characters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
    }
  }

  for (const chapter of project.chapters) {
    const label = relative(project, chapter.file);
    if (chapter.pov) {
      const povText = String(chapter.pov);
      if (povText !== kebabCase(povText)) {
        errors.push(err("id-not-kebab", `${label} references POV character ${povText} which must be kebab-case`, label));
      } else if (!characters.has(chapter.pov)) {
        errors.push(err("missing-reference", `${label} references missing POV character ${chapter.pov}`, label));
      }
    }

    for (const characterId of chapter.characters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
    }
    for (const mentionId of chapter.mentions) {
      checkIdReference(errors, label, mentionId, "character or artifact", hasMention);
    }
    for (const locationId of chapter.locations) {
      checkIdReference(errors, label, locationId, "location", hasLocation);
    }
    for (const arcId of chapter.arcsAdvanced) {
      checkIdReference(errors, label, arcId, "arc", hasArc);
    }
  }

  for (const faction of project.factions) {
    const label = relative(project, faction.file);
    for (const characterId of faction.members) {
      checkIdReference(errors, label, characterId, "member", hasCharacter);
    }
    for (const locationId of faction.locations) {
      checkIdReference(errors, label, locationId, "location", hasLocation);
    }
  }

  for (const artifact of project.artifacts) {
    const label = relative(project, artifact.file);
    if (artifact.owner) {
      const ownerText = String(artifact.owner);
      if (ownerText !== kebabCase(ownerText)) {
        errors.push(err("id-not-kebab", `${label} references owner ${ownerText} which must be kebab-case`, label));
      } else if (!characters.has(artifact.owner) && !factions.has(artifact.owner)) {
        errors.push(err("missing-reference", `${label} references missing owner ${artifact.owner}`, label));
      }
    }
    if (artifact.location) {
      checkIdReference(errors, label, artifact.location, "location", hasLocation);
    }
  }

  for (const scene of project.scenes) {
    const label = relative(project, scene.file);
    if (scene.chapter) {
      const chapterText = String(scene.chapter);
      if (chapterText !== kebabCase(chapterText)) {
        errors.push(err("id-not-kebab", `${label} references chapter ${chapterText} which must be kebab-case`, label));
      } else if (!chapters.has(scene.chapter)) {
        errors.push(err("missing-reference", `${label} references missing chapter ${scene.chapter}`, label));
      }
    }
    if (scene.pov) {
      const povText = String(scene.pov);
      if (povText !== kebabCase(povText)) {
        errors.push(err("id-not-kebab", `${label} references POV character ${povText} which must be kebab-case`, label));
      } else if (!characters.has(scene.pov)) {
        errors.push(err("missing-reference", `${label} references missing POV character ${scene.pov}`, label));
      }
    }
    if (scene.location) {
      checkIdReference(errors, label, scene.location, "location", hasLocation);
    }
    for (const characterId of scene.characters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
    }
    for (const mentionId of scene.mentions) {
      checkIdReference(errors, label, mentionId, "character or artifact", hasMention);
    }
    for (const arcId of scene.arcsAdvanced) {
      checkIdReference(errors, label, arcId, "arc", hasArc);
    }
  }

  for (const note of project.research) {
    const label = relative(project, note.file);
    // Research is often done before the chapter that needs it is written.
    for (const chapterId of note.usedIn) {
      checkIdReference(errors, label, chapterId, "chapter", hasScheduledChapter);
    }
  }

  for (const question of project.questions) {
    const label = relative(project, question.file);
    // A question can be planned for a chapter not written yet; its answer
    // must be on the page before `resolved` names a chapter.
    checkIdReference(errors, label, question.introduced, "chapter", threadChapter("question", question, "introduced"));
    checkIdReference(errors, label, question.resolved, "chapter", threadChapter("question", question, "resolved"));
    for (const characterId of question.characters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
    }
  }

  for (const promise of project.promises) {
    const label = relative(project, promise.file);
    checkIdReference(errors, label, promise.planted, "chapter", threadChapter("promise", promise, "planted"));
    checkIdReference(errors, label, promise.payoff, "chapter", threadChapter("promise", promise, "payoff"));
    for (const arcId of promise.arcs) {
      checkIdReference(errors, label, arcId, "arc", hasArc);
    }
    for (const characterId of promise.characters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
    }
  }

  for (const clue of project.clues) {
    const label = relative(project, clue.file);
    checkIdReference(errors, label, clue.planted, "chapter", threadChapter("clue", clue, "planted"));
    checkIdReference(errors, label, clue.payoff, "chapter", threadChapter("clue", clue, "payoff"));
    for (const arcId of clue.arcs) {
      checkIdReference(errors, label, arcId, "arc", hasArc);
    }
    for (const characterId of clue.characters) {
      checkIdReference(errors, label, characterId, "character", hasCharacter);
    }
  }

  // Like a promise's payoff, a choice may lead to a chapter not written yet;
  // the Twee build still needs it.
  const branches = branchGraph(project);
  errors.push(...branches.missing.filter((choice) => !hasScheduledChapter(choice.to)).map((choice) => choice.finding));
  warnings.push(...branches.warnings);
  validateTimelineAndArcBodyRefs(project, chapters, errors, hasScheduledChapter);
  validateMatterBodyLinks(project, errors);
  validateSeriesLinks(project.root, project.story.data, errors);

  return { ok: errors.length === 0, errors, warnings };
}

// Arc bodies plan ahead (Plot Points and Foreshadowing rows for chapters not
// yet written), so they accept a scheduled chapter-NN like promises do; the
// timeline records what happened and needs chapters that exist.
function validateTimelineAndArcBodyRefs(project, chapters, errors, hasScheduledChapter) {
  const chapterIds = new Set(chapters.keys());
  const sceneIds = new Set(project.scenes.map((scene) => scene.id));
  const checkTokens = (label, body, hasChapterToken = (token) => chapterIds.has(token)) => {
    for (const token of extractChapterIdTokens(body)) {
      if (!hasChapterToken(token)) {
        errors.push(err("missing-reference", `${label} references missing chapter ${token}`, label));
      }
    }
    for (const token of extractSceneIdTokens(body)) {
      if (!sceneIds.has(token)) {
        errors.push(err("missing-reference", `${label} references missing scene ${token}`, label));
      }
    }
  };
  const timelinePath = path.join(project.root, "plot", "timeline.md");
  if (fs.existsSync(timelinePath)) {
    try {
      const raw = readTextFile(timelinePath);
      const body = parseFrontmatter(raw, timelinePath).body ?? raw;
      checkTokens("plot/timeline.md", body);
      for (const target of extractMarkdownLinkTargets(body)) {
        checkBodyLinkTarget(project, "plot/timeline.md", target, errors);
      }
    } catch (error) {
      const message = fileErrorMessage("plot/timeline.md", relativePathError(error, timelinePath, project.root));
      if (!hasMessage(errors, message)) {
        errors.push(err("unreadable-file", message, "plot/timeline.md"));
      }
    }
  }

  for (const arc of project.arcs) {
    const label = relative(project, arc.file);
    let body = '';
    try {
      body = readMarkdown(arc.file, project.root).body ?? '';
    } catch (error) {
      const message = fileErrorMessage(label, error);
      if (!hasMessage(errors, message)) {
        errors.push(err("unreadable-file", message, label));
      }
      continue;
    }
    checkTokens(label, body, hasScheduledChapter);
    for (const target of extractMarkdownLinkTargets(body)) {
      checkBodyLinkTarget(project, label, target, errors);
    }
  }
}

// Matter pages (an epigraph's credit, an also-by list) can link to project
// files; builds print only the link text, so a broken target goes unseen.
function validateMatterBodyLinks(project, errors) {
  for (const matter of project.matter) {
    const label = relative(project, matter.file);
    let body = "";
    try {
      body = readMarkdown(matter.file, project.root).body ?? "";
    } catch (error) {
      // The file changed or went missing after the scan.
      const message = fileErrorMessage(label, error);
      if (!hasMessage(errors, message)) {
        errors.push(err("unreadable-file", message, label));
      }
      continue;
    }
    for (const target of extractMarkdownLinkTargets(body)) {
      checkBodyLinkTarget(project, label, target, errors);
    }
  }
}

// A --dry-run stages the targets of these links that lie outside the project
// (copyLinkTargets in preview.js), for the timeline, arcs, and matter pages:
// check links in another file and that list needs it too.
function checkBodyLinkTarget(project, label, target, errors) {
  const cleaned = String(target).trim();
  if (!cleaned || /^(https?:|mailto:|#)/i.test(cleaned)) {
    return;
  }
  const pathOnly = cleaned.split("#")[0].split("?")[0];
  // Checked before the id: on Linux a backslash is part of the file name, so
  // the kebab-case message below would hide the real problem.
  if (pathOnly.includes("\\") && /\.md$/i.test(pathOnly)) {
    errors.push(err("link-backslash", `${label} links to ${cleaned} with a backslash; write ${portableSlashes(cleaned)} so the link works on every system`, label));
    return;
  }
  const base = path.basename(pathOnly);
  if (!base.endsWith(".md")) {
    return;
  }
  const id = base.slice(0, -3);
  if (!id || id === "_index" || id.includes("*")) {
    return;
  }
  if (id !== kebabCase(id)) {
    errors.push(err("link-not-kebab", `${label} links to ${cleaned} which must be kebab-case`, label));
    return;
  }
  const resolved = path.resolve(path.dirname(path.join(project.root, label)), pathOnly);
  if (!isPathInside(path.resolve(project.root), resolved)) {
    // A link into a book this one follows or precedes cites that book's
    // record (a Backstory Events row, say): accept it when the file exists.
    const linkedBook = ["follows", "precedes"]
      .flatMap((field) => seriesLinks(project.root, project.story.data, field))
      .find((bookRoot) => isPathInside(bookRoot, resolved));
    if (linkedBook && fs.existsSync(resolved) && fs.statSync(resolved).isFile()
      && isPathInside(canonicalPath(linkedBook), canonicalPath(resolved))) {
      return;
    }
    errors.push(linkedBook || !fs.existsSync(resolved)
      ? err("broken-link", `${label} links to missing file ${cleaned}`, label)
      : err("link-outside-project", `${label} links to ${cleaned} which resolves outside the project`, label));
    return;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    errors.push(err("broken-link", `${label} links to missing file ${cleaned}`, label));
    return;
  }
  // existsSync and statSync follow symlinks, so a link can pass the lexical
  // check above and still land outside the project.
  if (!isPathInside(fs.realpathSync(project.root), fs.realpathSync(resolved))) {
    errors.push(err("link-outside-project", `${label} links to ${cleaned} which resolves outside the project`, label));
    return;
  }
  const known = new Set();
  for (const collection of [
    project.characters,
    project.locations,
    project.systems,
    project.factions,
    project.artifacts,
    project.arcs,
    project.chapters,
    project.scenes,
    project.questions,
    project.promises,
    project.clues,
    project.glossaryTerms,
    project.research,
    project.matter
  ]) {
    for (const item of collection) {
      known.add(item.id);
    }
  }
  if (!known.has(id)) {
    errors.push(err("broken-link", `${label} links to missing file ${cleaned}`, label));
  }
}

function checkIdReference(errors, label, value, kind, exists, file = label) {
  const text = String(value ?? "");
  if (text === "") {
    return;
  }
  if (text !== kebabCase(text)) {
    errors.push(err("id-not-kebab", `${label} references ${kind} ${text} which must be kebab-case`, file));
    return;
  }
  if (!exists(text)) {
    errors.push(err("missing-reference", `${label} references missing ${kind} ${text}`, file));
  }
}

// Bare chapter and scene ids, with the boundaries move uses when it rewrites
// them: `chapter-01-draft` and `pre-chapter-01` are not ids. Link destinations
// and URLs are skipped: links are checked as files, and a URL or a path into
// another book does not name this book's chapter.
function extractChapterIdTokens(body) {
  return idTokensOutsideLinks(body, /(?<![\w-])chapter-\d+(?![\w-])/g);
}

function extractSceneIdTokens(body) {
  return idTokensOutsideLinks(body, /(?<![\w-])chapter-\d+-scene-\d+(?![\w-])/g);
}

function idTokensOutsideLinks(body, pattern) {
  const found = [];
  mapOutsideLinks(body, (text) => {
    found.push(...(text.match(pattern) ?? []));
    return text;
  });
  return found;
}

function inverseRelationshipTypes(type) {
  if (RELATIONSHIP_INVERSES.has(type)) {
    return RELATIONSHIP_INVERSES.get(type);
  }

  return SYMMETRIC_RELATIONSHIPS.has(type) ? [type] : [];
}
