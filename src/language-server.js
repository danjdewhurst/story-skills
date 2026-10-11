import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { formatKnowledgeMark } from "./chronology.js";
import { findingOverrides, readCliConfig } from "./config.js";
import { makeDirectories, portablePath, readTextFile, recordChanges, withOpenDocuments, writeFile } from "./files.js";
import { findingMessage, findingRange } from "./finding-locations.js";
import { encodeMessage, messageReader } from "./lsp-transport.js";
import { frontmatterEnd, idAt, itemField, keyAt, linkTargetAt, listItemAt, minimalEdit, range, textLines, tokenColumns } from "./lsp-text.js";
import { NESTED_TO_KINDS, REFERENCE_FIELD_KINDS, resolveLinkTarget } from "./mutate.js";
import { previewChanges } from "./preview.js";
import { PROGRESSION_KINDS } from "./progressions.js";
import { SKIPPED_SCAN_DIRECTORIES, isKebabId, markdownFiles, scanProject } from "./scan.js";
import { computeWordCounts, entityStateAtChapter, knowledgeAtChapter, projectCheck, reindexProject, renameEntity } from "./story.js";
import { VERSION } from "./version.js";

// `story lsp`: a Language Server Protocol server over stdin and stdout. It
// runs story check on each project the editor has open, with the text of
// unsaved documents in place of the files on disk, and reports the findings
// as diagnostics. In a project's markdown it resolves entity ids for go to
// definition, find references, and hover, completes ids in frontmatter
// reference fields, renames entities as story rename does, and fixes stale
// registries and word counts. Every edit is worked out on a scratch copy of
// the project (see preview.js) and returned for the editor to apply, so the
// server itself never writes a project file.

// How long after the last keystroke a project is checked again.
export const CHECK_DELAY_MS = 300;

// How deep below a workspace folder to look for story projects, and the
// most projects checked when the editor starts.
const PROJECT_SEARCH_DEPTH = 3;
const MAX_WORKSPACE_PROJECTS = 50;

const JSONRPC = "2.0";
export const ERROR_CODES = { invalidRequest: -32600, methodNotFound: -32601, requestFailed: -32803 };
const SEVERITY = { error: 1, warning: 2 };
const LOG_ERROR = 1;
const SYNC_FULL = 1;
const COMPLETION_REFERENCE = 18;
const SOURCE = "story";

// Each entity kind, and the scanProject list that holds its entities.
const KIND_COLLECTIONS = {
  character: "characters",
  location: "locations",
  system: "systems",
  faction: "factions",
  artifact: "artifacts",
  arc: "arcs",
  chapter: "chapters",
  scene: "scenes",
  question: "questions",
  promise: "promises",
  clue: "clues",
  term: "glossaryTerms",
  matter: "matter",
  research: "research"
};

// The quick fix each finding code offers: the command that repairs it, run
// on a scratch copy so its changes come back as an edit.
const QUICK_FIXES = {
  "stale-registry": { title: "Rebuild registries (story reindex)", run: (root) => reindexProject(root) },
  "stale-word-count": { title: "Update word counts (story wordcount --write)", run: (root) => computeWordCounts(root, { write: true }) }
};

const SERVER_CAPABILITIES = {
  textDocumentSync: { openClose: true, change: SYNC_FULL, save: { includeText: false } },
  definitionProvider: true,
  referencesProvider: true,
  hoverProvider: true,
  completionProvider: { triggerCharacters: [" ", "[", ","] },
  renameProvider: { prepareProvider: true },
  codeActionProvider: { codeActionKinds: ["quickfix"], resolveProvider: true },
  workspace: { workspaceFolders: { supported: true, changeNotifications: true } }
};

// Serves the protocol on two streams until the editor says exit, or closes
// the input; `exit(code)` ends the process.
export function serveLanguageServer({ input, output, exit }) {
  const server = createLanguageServer({ send: (message) => output.write(encodeMessage(message)), exit });
  input.on("data", messageReader(server.handle, server.log));
  input.on("end", () => server.handle({ jsonrpc: JSONRPC, method: "exit" }));
  return server;
}

// The server, apart from its transport: `handle(message)` takes each message
// from the editor, and `send(message)` writes one back. `schedule` and
// `cancel` time the check after a change (setTimeout and clearTimeout).
export function createLanguageServer({ send, exit, schedule = setTimeout, cancel = clearTimeout, delay = CHECK_DELAY_MS }) {
  // Open documents by absolute path: the editor's uri and current text.
  const documents = new Map();
  // The uris each project's last check published diagnostics for.
  const published = new Map();
  const pending = new Map();
  // Each workspace folder, and the projects checked for it.
  const folders = new Map();
  let capabilities = {};
  let shuttingDown = false;
  let registrations = 0;

  const notify = (method, params) => send({ jsonrpc: JSONRPC, method, params });
  const log = (message) => notify("window/logMessage", { type: LOG_ERROR, message: `story lsp: ${message}` });
  const underOpenDocuments = (run) => withOpenDocuments(new Map([...documents].map(([file, document]) => [file, document.text])), run);
  const uriFor = (file) => documents.get(file)?.uri ?? pathToFileURL(file).href;

  function textOf(file) {
    if (documents.has(file)) {
      return documents.get(file).text;
    }
    try {
      return readTextFile(file);
    } catch {
      return "";
    }
  }

  function documentContext(uri) {
    const file = uriPath(uri);
    const root = file === null ? null : projectRootOf(file);
    if (root === null) {
      return null;
    }
    const text = textOf(file);
    return { file, root, text, lines: textLines(text) };
  }

  // Diagnostics

  function checkProject(root) {
    const found = new Map();
    const add = (file, diagnostic) => {
      const uri = uriFor(file);
      found.set(uri, [...(found.get(uri) ?? []), diagnostic]);
    };
    try {
      const result = underOpenDocuments(() => checkWithUnsaved(root));
      for (const [severity, findings] of [[SEVERITY.error, result.errors], [SEVERITY.warning, result.warnings]]) {
        for (const finding of findings) {
          const file = path.join(root, finding.file ?? "story.md");
          add(file, { range: findingRange(textOf(file), finding), severity, code: finding.code, source: SOURCE, message: findingMessage(finding) });
        }
      }
    } catch (error) {
      add(path.join(root, "story.md"), { range: range(0, 0), severity: SEVERITY.error, source: SOURCE, message: error.message });
    }
    for (const uri of published.get(root) ?? []) {
      if (!found.has(uri)) {
        notify("textDocument/publishDiagnostics", { uri, diagnostics: [] });
      }
    }
    for (const [uri, diagnostics] of found) {
      notify("textDocument/publishDiagnostics", { uri, diagnostics });
    }
    published.set(root, new Set(found.keys()));
  }

  // story check on the project, as the editor has it. A file the editor has
  // open but not yet saved is not on disk for the scan to list, so then the
  // check runs on a scratch copy with those files written into it.
  function checkWithUnsaved(root) {
    const unsaved = [...documents.keys()].filter((file) => file.endsWith(".md") && !fs.existsSync(file) && projectRootOf(file) === root);
    if (unsaved.length === 0) {
      return projectCheck(root, { overrides: projectOverrides(root) });
    }
    return previewChanges(root, (copyRoot) => {
      for (const file of unsaved) {
        const copy = path.join(copyRoot, path.relative(root, file));
        makeDirectories(path.dirname(copy));
        writeFile(copy, documents.get(file).text);
      }
      return projectCheck(copyRoot, { overrides: projectOverrides(copyRoot) });
    }).result;
  }

  function clearProject(root) {
    for (const uri of published.get(root)) {
      notify("textDocument/publishDiagnostics", { uri, diagnostics: [] });
    }
    published.delete(root);
  }

  function checkNow(root) {
    cancel(pending.get(root));
    pending.delete(root);
    checkProject(root);
  }

  function checkLater(root) {
    cancel(pending.get(root));
    pending.set(root, schedule(() => {
      pending.delete(root);
      checkProject(root);
    }, delay));
  }

  function checkFolder(folder) {
    const roots = projectsIn(folder);
    folders.set(folder, roots);
    for (const root of roots) {
      checkNow(root);
    }
  }

  // Entities

  function scan(root) {
    return underOpenDocuments(() => scanProject(root));
  }

  // The entity the id under `position` names, as { token, project, matches,
  // explicit }: in a link, the entity whose file it resolves to; in a
  // frontmatter field that takes ids, the entities of the kinds it names.
  // Both are explicit references, which story rename rewrites. Anywhere
  // else, such as prose, every entity with that id. null for no entity.
  function referenceAt(context, position) {
    const lineText = context.lines[position.line] ?? "";
    const token = idAt(lineText, position.character);
    if (token === null) {
      return null;
    }
    const project = scan(context.root);
    const linked = linkedFile(context, lineText, token.start);
    const kinds = linked === null ? referenceKinds(context.lines, position.line, token.start) : undefined;
    const matches = (projectEntities(project).get(token.text) ?? [])
      .filter((entry) => (linked === null ? kinds === undefined || kinds.includes(entry.kind) : entry.file === linked));
    return matches.length === 0 ? null : { token, project, matches, line: position.line, explicit: linked !== null || kinds !== undefined };
  }

  // The project file the link around `column` resolves to, or null.
  function linkedFile(context, lineText, column) {
    const target = linkTargetAt(lineText, column);
    return target === null ? null : resolveLinkTarget(context.root, context.file, target);
  }

  function tokenRange(reference) {
    return range(reference.line, reference.token.start, reference.line, reference.token.end);
  }

  function definition(params) {
    const context = documentContext(params.textDocument.uri);
    const reference = context === null ? null : referenceAt(context, params.position);
    return reference?.matches.map((entry) => ({ uri: uriFor(entry.file), range: range(0, 0) })) ?? null;
  }

  // Where the entity is named: frontmatter fields that take its kind, and
  // markdown links to its file (`(../characters/sera-voss.md)`).
  function references(params) {
    const context = documentContext(params.textDocument.uri);
    const reference = context === null ? null : referenceAt(context, params.position);
    if (reference === null) {
      return null;
    }
    const id = reference.token.text;
    const kinds = new Set(reference.matches.map((entry) => entry.kind));
    const files = new Set(reference.matches.map((entry) => entry.file));
    const locations = params.context?.includeDeclaration ? reference.matches.map((entry) => ({ uri: uriFor(entry.file), range: range(0, 0) })) : [];
    for (const file of underOpenDocuments(() => markdownFiles(context.root)).sort()) {
      const lines = textLines(textOf(file));
      const fileContext = { ...context, file };
      for (const [line, lineText] of lines.entries()) {
        for (const column of tokenColumns(lineText, id)) {
          const linked = linkedFile(fileContext, lineText, column);
          if (linked === null ? (referenceKinds(lines, line, column) ?? []).some((kind) => kinds.has(kind)) : files.has(linked)) {
            locations.push({ uri: uriFor(file), range: range(line, column, line, column + id.length) });
          }
        }
      }
    }
    return locations;
  }

  function hover(params) {
    const context = documentContext(params.textDocument.uri);
    const reference = context === null ? null : referenceAt(context, params.position);
    if (reference === null) {
      return null;
    }
    const { project } = reference;
    const chapter = project.chapters.find((entry) => entry.file === context.file)?.id ?? (project.scenes.find((entry) => entry.file === context.file)?.chapter || null);
    const value = reference.matches.map((entry) => describeEntity(entry, context.root, chapter, project)).join("\n\n---\n\n");
    return { contents: { kind: "markdown", value }, range: tokenRange(reference) };
  }

  // Ids of the kinds the frontmatter field at the cursor takes, replacing
  // the id typed so far.
  function completion(params) {
    const context = documentContext(params.textDocument.uri);
    if (context === null) {
      return [];
    }
    const { line, character } = params.position;
    const typed = /[a-z0-9-]*$/.exec((context.lines[line] ?? "").slice(0, character))[0];
    const start = character - typed.length;
    const kinds = referenceKinds(context.lines, line, start);
    if (kinds === undefined) {
      return [];
    }
    return [...projectEntities(scan(context.root)).values()].flat()
      .filter((entry) => kinds.includes(entry.kind))
      .sort((left, right) => left.id.localeCompare(right.id, "en") || left.kind.localeCompare(right.kind, "en"))
      .map((entry) => ({ label: entry.id, kind: COMPLETION_REFERENCE, detail: `${entry.kind}: ${entry.name}`, textEdit: { range: range(line, start, line, character), newText: entry.id } }));
  }

  // Rename

  // The entity to rename, or null when the position holds no explicit
  // reference to one: story rename leaves an id in prose as it is.
  function renameTarget(params) {
    const context = documentContext(params.textDocument.uri);
    const reference = context === null ? null : referenceAt(context, params.position);
    if (reference === null || !reference.explicit) {
      return null;
    }
    if (reference.matches.length > 1) {
      throw requestFailed(`${reference.token.text} is the id of more than one entity (${reference.matches.map((entry) => entry.kind).join(", ")}): rename it from a field that takes one kind, or with story rename`);
    }
    const [entry] = reference.matches;
    if (entry.kind === "chapter" || entry.kind === "scene") {
      throw requestFailed(`A ${entry.kind} id follows its number: renumber it with story move`);
    }
    return { context, reference, entry };
  }

  function prepareRename(params) {
    const target = renameTarget(params);
    return target === null ? null : { range: tokenRange(target.reference), placeholder: target.reference.token.text };
  }

  // A new name in kebab case is the new id, and the entity keeps its name;
  // any other text is the new name, and the id follows it, as story rename
  // derives one.
  function rename(params) {
    const target = renameTarget(params);
    if (target === null) {
      throw requestFailed("Rename works on the id of a story entity in a frontmatter field or a link to its file");
    }
    const { context, entry } = target;
    const newName = String(params.newName).trim();
    const options = isKebabId(newName) ? { kind: entry.kind, id: entry.id, newId: newName, name: entry.name } : { kind: entry.kind, id: entry.id, name: newName };
    return projectEdit(context.root, (copyRoot) => renameEntity(copyRoot, options));
  }

  // Quick fixes

  function codeAction(params) {
    const context = documentContext(params.textDocument.uri);
    if (context === null) {
      return [];
    }
    const lazy = capabilities.textDocument?.codeAction?.resolveSupport?.properties?.includes("edit") === true;
    const actions = [];
    for (const [code, fix] of Object.entries(QUICK_FIXES)) {
      const diagnostics = (params.context?.diagnostics ?? []).filter((diagnostic) => diagnostic.source === SOURCE && diagnostic.code === code);
      if (diagnostics.length > 0) {
        const action = { title: fix.title, kind: "quickfix", diagnostics, data: { root: context.root, code } };
        actions.push(lazy ? action : resolveOrDisable(action));
      }
    }
    return actions;
  }

  // A fix this editor cannot apply is shown disabled, with the reason, so
  // the other fixes are still offered.
  function resolveOrDisable(action) {
    try {
      return resolveCodeAction(action);
    } catch (error) {
      return { ...action, disabled: { reason: error.message } };
    }
  }

  function resolveCodeAction(action) {
    const { root, code } = action.data ?? {};
    if (typeof root !== "string" || !Object.hasOwn(QUICK_FIXES, code)) {
      throw requestFailed("Not a story quick fix");
    }
    return { ...action, edit: projectEdit(root, QUICK_FIXES[code].run) };
  }

  // Runs `run(copyRoot)` on a scratch copy of the project, open documents
  // and all, and returns what it changed as a workspace edit.
  function projectEdit(root, run) {
    const { result: texts, changes } = underOpenDocuments(() => previewChanges(root, (copyRoot) => {
      const written = recordChanges(copyRoot, () => run(copyRoot)).changes.filter((change) => change.action === "create" || change.action === "update");
      return Object.fromEntries(written.map((change) => [change.path, readTextFile(path.join(copyRoot, change.path))]));
    }));
    const operations = [];
    for (const change of changes) {
      const file = path.join(root, change.path);
      const uri = uriFor(file);
      const version = documents.get(file)?.version ?? null;
      if (change.action === "update") {
        operations.push(textDocumentEdit(uri, version, minimalEdit(textOf(file), texts[change.path])));
      } else if (change.action === "create") {
        operations.push({ kind: "create", uri, options: { ignoreIfExists: true } }, textDocumentEdit(uri, null, { range: range(0, 0), newText: texts[change.path] }));
      } else if (change.action === "delete") {
        operations.push({ kind: "delete", uri, options: { ignoreIfNotExists: true } });
      }
    }
    const fileOperations = new Set(operations.filter((operation) => operation.kind !== undefined).map((operation) => operation.kind));
    const workspaceEdit = capabilities.workspace?.workspaceEdit ?? {};
    const missing = [...fileOperations].filter((kind) => !(workspaceEdit.resourceOperations ?? []).includes(kind));
    if (missing.length > 0) {
      throw requestFailed(`This change needs to ${missing.join(" and ")} files, which this editor cannot do in an edit: run the story command in a terminal instead`);
    }
    if (workspaceEdit.documentChanges === true || fileOperations.size > 0) {
      return { documentChanges: operations };
    }
    return { changes: Object.fromEntries(operations.map((operation) => [operation.textDocument.uri, operation.edits])) };
  }

  // The protocol

  const requests = {
    initialize(params) {
      capabilities = params.capabilities ?? {};
      const workspaceFolders = params.workspaceFolders ?? (params.rootUri ? [{ uri: params.rootUri }] : []);
      for (const folder of workspaceFolders) {
        addFolder(folder.uri);
      }
      return { capabilities: SERVER_CAPABILITIES, serverInfo: { name: "story", version: VERSION } };
    },
    shutdown() {
      shuttingDown = true;
      for (const timer of pending.values()) {
        cancel(timer);
      }
      pending.clear();
      return null;
    },
    "textDocument/definition": definition,
    "textDocument/references": references,
    "textDocument/hover": hover,
    "textDocument/completion": completion,
    "textDocument/prepareRename": prepareRename,
    "textDocument/rename": rename,
    "textDocument/codeAction": codeAction,
    "codeAction/resolve": resolveCodeAction
  };

  function addFolder(uri) {
    const folder = uriPath(uri);
    if (folder !== null && !folders.has(folder)) {
      folders.set(folder, []);
    }
    return folder;
  }

  const notifications = {
    initialized() {
      if (capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration === true) {
        registrations += 1;
        send({
          jsonrpc: JSONRPC,
          id: `story-register-${registrations}`,
          method: "client/registerCapability",
          params: { registrations: [{ id: "story-markdown-files", method: "workspace/didChangeWatchedFiles", registerOptions: { watchers: [{ globPattern: "**/*.md" }] } }] }
        });
      }
      for (const folder of folders.keys()) {
        checkFolder(folder);
      }
    },
    exit() {
      exit(shuttingDown ? 0 : 1);
    },
    "textDocument/didOpen"({ textDocument }) {
      const file = uriPath(textDocument.uri);
      if (file !== null) {
        documents.set(file, { uri: textDocument.uri, text: textDocument.text, version: textDocument.version ?? null });
        checkDocumentProject(file, checkNow);
      }
    },
    "textDocument/didChange"({ textDocument, contentChanges }) {
      const file = uriPath(textDocument.uri);
      const document = documents.get(file);
      if (document !== undefined && contentChanges.length > 0) {
        document.text = contentChanges[contentChanges.length - 1].text;
        document.version = textDocument.version ?? null;
        checkDocumentProject(file, checkLater);
      }
    },
    "textDocument/didSave"({ textDocument }) {
      checkDocumentProject(uriPath(textDocument.uri), checkNow);
    },
    "textDocument/didClose"({ textDocument }) {
      const file = uriPath(textDocument.uri);
      documents.delete(file);
      checkDocumentProject(file, checkNow);
    },
    "workspace/didChangeWatchedFiles"({ changes }) {
      for (const root of [...published.keys()].filter((root) => !fs.existsSync(path.join(root, "story.md")))) {
        clearProject(root);
      }
      const roots = new Set(changes.map((change) => uriPath(change.uri)).filter((file) => file !== null).map(projectRootOf));
      for (const root of roots) {
        if (root !== null) {
          checkNow(root);
        }
      }
    },
    // A removed folder's projects are cleared unless another folder or an
    // open document still holds them.
    "workspace/didChangeWorkspaceFolders"({ event }) {
      for (const removed of event.removed) {
        const folder = uriPath(removed.uri);
        if (folder === null) {
          continue;
        }
        const roots = new Set([...(folders.get(folder) ?? []), ...[...published.keys()].filter((root) => isInside(folder, root))]);
        folders.delete(folder);
        const kept = new Set([...[...folders.values()].flat(), ...[...documents.keys()].map(projectRootOf)]);
        for (const root of roots) {
          if (published.has(root) && !kept.has(root)) {
            clearProject(root);
          }
        }
      }
      for (const added of event.added) {
        const folder = addFolder(added.uri);
        if (folder !== null) {
          checkFolder(folder);
        }
      }
    }
  };

  function checkDocumentProject(file, check) {
    const root = file === null ? null : projectRootOf(file);
    if (root !== null) {
      check(root);
    }
  }

  function handle(message) {
    if (typeof message?.method !== "string") {
      // A reply to a request the server sent, such as registerCapability.
      return;
    }
    const params = message.params ?? {};
    if (message.id === undefined) {
      if (Object.hasOwn(notifications, message.method) && (!shuttingDown || message.method === "exit")) {
        try {
          notifications[message.method](params);
        } catch (error) {
          log(`${message.method} failed: ${error.message}`);
        }
      }
      return;
    }
    const reply = (fields) => send({ jsonrpc: JSONRPC, id: message.id, ...fields });
    if (shuttingDown) {
      reply({ error: { code: ERROR_CODES.invalidRequest, message: "story lsp is shutting down" } });
    } else if (!Object.hasOwn(requests, message.method)) {
      reply({ error: { code: ERROR_CODES.methodNotFound, message: `story lsp does not handle ${message.method}` } });
    } else {
      try {
        reply({ result: requests[message.method](params) ?? null });
      } catch (error) {
        reply({ error: { code: ERROR_CODES.requestFailed, message: error.message } });
      }
    }
  }

  return { handle, log };
}

// The severity overrides and exemptions story.md sets, as story check
// applies them. Invalid cli-defaults or severity are a validate error, so
// the check still runs, with the exemptions alone, and reports them.
function projectOverrides(root) {
  const config = readCliConfig(root);
  return findingOverrides(config.errors.length === 0 ? config : { severity: {}, exemptions: config.exemptions });
}

// The absolute path of a file: uri, or null for any other scheme (an
// unsaved new document). A Windows drive letter is upper case, as Node
// spells the paths it resolves.
export function uriPath(uri) {
  if (typeof uri !== "string" || !uri.startsWith("file:")) {
    return null;
  }
  const file = fileURLToPath(uri);
  return /^[a-z]:/.test(file) ? `${file[0].toUpperCase()}${file.slice(1)}` : file;
}

// The project a file belongs to: the nearest folder at or above it that
// holds a story.md, or null.
export function projectRootOf(file) {
  for (let folder = path.dirname(file); ; folder = path.dirname(folder)) {
    if (fs.existsSync(path.join(folder, "story.md"))) {
      return folder;
    }
    if (path.dirname(folder) === folder) {
      return null;
    }
  }
}

// The story projects in a workspace folder: the project it is in, or else
// the projects below it, a few folders deep, past hidden, dist, and
// node_modules folders.
export function projectsIn(folder) {
  const enclosing = projectRootOf(path.join(folder, "story.md"));
  if (enclosing !== null) {
    return [enclosing];
  }
  const found = [];
  findProjects(folder, 0, found);
  return found;
}

function findProjects(folder, depth, found) {
  let entries;
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    if (found.length >= MAX_WORKSPACE_PROJECTS) {
      return;
    }
    if (entry.isDirectory() && !entry.name.startsWith(".") && !SKIPPED_SCAN_DIRECTORIES.has(entry.name)) {
      const child = path.join(folder, entry.name);
      if (fs.existsSync(path.join(child, "story.md"))) {
        found.push(child);
      } else if (depth < PROJECT_SEARCH_DEPTH) {
        findProjects(child, depth + 1, found);
      }
    }
  }
}

function isInside(folder, file) {
  const relative = path.relative(folder, file);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

// Every entity in a scanned project, by id: a list, since two kinds may
// share an id.
function projectEntities(project) {
  const entities = new Map();
  for (const [kind, collection] of Object.entries(KIND_COLLECTIONS)) {
    for (const entity of project[collection]) {
      const entry = { kind, id: entity.id, file: entity.file, name: String(entity.name ?? entity.title ?? entity.term), entity };
      entities.set(entity.id, [...(entities.get(entity.id) ?? []), entry]);
    }
  }
  return entities;
}

// The frontmatter key the value at a position belongs to, or null outside
// the frontmatter.
function frontmatterKey(lines, line, character) {
  return line > 0 && line < frontmatterEnd(lines) ? keyAt(lines, line, character) : null;
}

// The entity kinds the frontmatter value at a position takes ids of, or
// undefined for a value that takes none. Some keys depend on the list item
// they sit in, as story rename reads them: a route's `to` names a location
// and a choice's `to` a chapter, a progression's `from` names a chapter,
// and its `value` takes what the field it changes takes.
function referenceKinds(lines, line, character) {
  const key = frontmatterKey(lines, line, character);
  if (key === null) {
    return undefined;
  }
  const item = listItemAt(lines, line, frontmatterEnd(lines));
  const listKey = item?.listKey ?? null;
  if (key === "to") {
    return Object.hasOwn(NESTED_TO_KINDS, listKey) ? [NESTED_TO_KINDS[listKey]] : undefined;
  }
  if (listKey === "progressions" && key === "from") {
    return ["chapter"];
  }
  if (listKey === "progressions" && key === "value") {
    return fieldKinds(itemField(lines, item, "field"));
  }
  return fieldKinds(key);
}

// The entity kinds a frontmatter field takes ids of, or undefined for a
// field that takes none.
function fieldKinds(key) {
  return key !== null && Object.hasOwn(REFERENCE_FIELD_KINDS, key) ? REFERENCE_FIELD_KINDS[key] : undefined;
}

function describeEntity(entry, root, chapter, project) {
  const lines = [`**${escapeMarkdown(entry.name)}** · ${entry.kind} · \`${portablePath(path.relative(root, entry.file))}\``];
  const atChapter = chapter !== null && PROGRESSION_KINDS.includes(entry.kind) ? stateAtChapter(entry, root, chapter, project) : null;
  const status = String((atChapter === null ? entry.entity.status : atChapter.status) ?? "");
  if (status !== "") {
    lines.push("", `Status: ${escapeMarkdown(status)}`);
  }
  if (atChapter !== null && atChapter.lines.length > 0) {
    lines.push("", `At ${chapter}:`, ...atChapter.lines);
  }
  return lines.join("\n");
}

// The status of a character (or a location or a faction) by the chapter
// the document is in, with what it knows and what its progressions changed,
// as { status, lines }. null when the project cannot say: a chapter or the
// state file fails to parse.
function stateAtChapter(entry, root, chapter, project) {
  try {
    const knowledge = entry.kind === "character" ? knowledgeAtChapter(root, entry.id, chapter, project) : [];
    const { state, changes } = entityStateAtChapter(root, entry.kind, entry.id, chapter, project);
    return {
      status: state.status,
      lines: [
        ...knowledge.map((item) => `- Knows: ${escapeMarkdown(item.knows)} (${formatKnowledgeMark(item.learnedIn, item.audience, { atChapterId: chapter })})`),
        ...changes.map((change) => `- ${change.field}: ${change.value === "" ? "(cleared)" : escapeMarkdown(String(change.value))} (from ${change.from})`)
      ]
    };
  } catch {
    return null;
  }
}

function escapeMarkdown(text) {
  return text.replace(/[\\`*_{}[\]()#+!|<>~]/g, "\\$&");
}

// An edit to one document. `version` is the version of the open document
// the edit was worked out from, so the editor refuses it once the writer
// has typed on; null for a document the editor does not have open.
function textDocumentEdit(uri, version, edit) {
  return { textDocument: { uri, version }, edits: [edit] };
}

function requestFailed(message) {
  return new Error(message);
}
