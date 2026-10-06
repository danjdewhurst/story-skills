// `story build --pdf`: renders a print interior or Shunn manuscript HTML to
// PDF with a paged-media engine the writer has installed. Nothing is bundled:
// the engine is found on PATH, or named with --pdf-engine, and run directly
// (never through a shell for an executable), with only paths the CLI made in
// its own temporary folder as arguments, so no title or file name reaches the
// engine's command line.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { refusedError, usageError } from "./exit-codes.js";

// The engines `--pdf` looks for, in this order: the three CSS paged-media
// engines first, since they set running heads, page numbers, and mirrored
// margins in full, then a Chromium browser's built-in print to PDF. Each
// engine's `commands` are the executable names searched on PATH, in order.
export const PDF_ENGINES = [
  {
    name: "prince",
    label: "Prince",
    commands: ["prince"],
    install: "https://www.princexml.com/",
    args: (input, output) => [input, "-o", output]
  },
  {
    name: "weasyprint",
    label: "WeasyPrint",
    commands: ["weasyprint"],
    install: "pip install weasyprint",
    args: (input, output) => [input, output]
  },
  {
    name: "pagedjs-cli",
    label: "Paged.js CLI",
    commands: ["pagedjs-cli"],
    install: "npm install -g pagedjs-cli",
    args: (input, output) => [input, "-o", output]
  },
  {
    name: "chrome",
    label: "Chrome or Chromium",
    commands: ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "chrome", "msedge"],
    install: "https://www.google.com/chrome/",
    // A profile of its own, so a Chrome the writer has open neither blocks
    // the run nor sees it.
    args: (input, output, work) => [
      "--headless",
      "--disable-gpu",
      "--no-first-run",
      "--no-pdf-header-footer",
      `--user-data-dir=${path.join(work, "profile")}`,
      `--print-to-pdf=${output}`,
      pathToFileURL(input).href
    ]
  }
];

const ENGINE_NAMES = PDF_ENGINES.map((engine) => engine.name);

// Names --pdf-engine accepts for an engine besides its own.
const ENGINE_ALIASES = { chromium: "chrome", pagedjs: "pagedjs-cli", "paged.js": "pagedjs-cli", edge: "chrome", msedge: "chrome" };

// Browsers that install outside PATH: checked after the PATH search for
// chrome, only where they exist.
function browserLocations(env, platform) {
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    ];
  }
  if (platform === "win32") {
    const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA].filter(Boolean);
    return roots.flatMap((root) => [
      path.join(root, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(root, "Microsoft", "Edge", "Application", "msedge.exe")
    ]);
  }
  return [];
}

// An environment variable read as Windows reads it there (`Path`, `PATHEXT`
// in any case), exactly elsewhere.
function envValue(env, name, platform) {
  if (platform !== "win32") {
    return env[name];
  }
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

function isExecutableFile(file, platform) {
  try {
    if (!fs.statSync(file).isFile()) {
      return false;
    }
    if (platform !== "win32") {
      fs.accessSync(file, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

// The full path of a command on PATH, as the shell would find it, or null.
// On Windows each PATHEXT extension is tried in turn (a name that already
// ends in one is tried as it is first), so `weasyprint` finds weasyprint.exe
// and `pagedjs-cli` finds pagedjs-cli.cmd.
export function findCommand(name, env = process.env, platform = process.platform) {
  const dirs = String(envValue(env, "PATH", platform) ?? "").split(platform === "win32" ? ";" : ":").filter((dir) => dir !== "");
  const extensions = platform === "win32"
    ? String(envValue(env, "PATHEXT", platform) || ".COM;.EXE;.BAT;.CMD").split(";").filter((ext) => ext !== "")
    : [];
  const names = platform === "win32"
    ? [...(extensions.some((ext) => name.toUpperCase().endsWith(ext.toUpperCase())) ? [name] : []), ...extensions.map((ext) => `${name}${ext}`)]
    : [name];
  for (const dir of dirs) {
    for (const candidate of names) {
      // A relative PATH entry is read from the current directory, not the
      // temporary folder the engine later runs in.
      const file = path.resolve(dir, candidate);
      if (isExecutableFile(file, platform)) {
        return file;
      }
    }
  }
  return null;
}

function locateEngine(engine, env, platform) {
  for (const command of engine.commands) {
    const file = findCommand(command, env, platform);
    if (file !== null) {
      return file;
    }
  }
  if (engine.name === "chrome") {
    return browserLocations(env, platform).find((file) => isExecutableFile(file, platform)) ?? null;
  }
  return null;
}

// Which engine an executable is, from its file name: `prince`, a
// `weasyprint` script, `pagedjs-cli.cmd`, or any Chromium browser.
function engineForExecutable(file) {
  const base = path.basename(file).toLowerCase().replace(/\.(?:exe|cmd|bat|com)$/, "");
  if (base.startsWith("prince")) {
    return "prince";
  }
  if (base.startsWith("weasyprint")) {
    return "weasyprint";
  }
  if (base.startsWith("pagedjs")) {
    return "pagedjs-cli";
  }
  if (/chrom|msedge|microsoft edge|brave/.test(base)) {
    return "chrome";
  }
  return null;
}

function installHints() {
  return PDF_ENGINES.map((engine) => `${engine.label} (${engine.install})`).join(", ");
}

// The engine to run: the one --pdf-engine names (an engine name, or the
// path or command name of its executable), or else the first installed one
// in PDF_ENGINES order. Returns { name, file }.
export function resolvePdfEngine(choice, { env = process.env, platform = process.platform, cwd = process.cwd() } = {}) {
  if (choice === undefined || choice === null) {
    for (const engine of PDF_ENGINES) {
      const file = locateEngine(engine, env, platform);
      if (file !== null) {
        return { name: engine.name, file };
      }
    }
    throw refusedError(`No PDF engine found on PATH (looked for ${ENGINE_NAMES.join(", ")}). Install one: ${installHints()}. Or name an installed one with --pdf-engine <name|path>, or build without --pdf and render the HTML yourself`);
  }
  const value = String(choice).trim();
  if (value === "") {
    throw usageError(`--pdf-engine needs an engine name (${ENGINE_NAMES.join(", ")}) or the path to one`);
  }
  const named = ENGINE_ALIASES[value.toLowerCase()] ?? (ENGINE_NAMES.includes(value.toLowerCase()) ? value.toLowerCase() : null);
  if (named !== null) {
    const engine = PDF_ENGINES.find((entry) => entry.name === named);
    const file = locateEngine(engine, env, platform);
    if (file === null) {
      throw refusedError(`PDF engine ${engine.name} was not found on PATH (looked for ${engine.commands.join(", ")}). Install ${engine.label} (${engine.install}), or give --pdf-engine the path to its executable`);
    }
    return { name: engine.name, file };
  }
  const kind = engineForExecutable(value);
  if (kind === null) {
    throw usageError(`Unknown PDF engine: ${value}. Name one of ${ENGINE_NAMES.join(", ")}, or the path to its executable, whose file name says which it is`);
  }
  const isPath = value.includes("/") || (platform === "win32" && value.includes("\\"));
  const file = isPath ? path.resolve(cwd, value) : findCommand(value, env, platform);
  if (file === null || !isExecutableFile(file, platform)) {
    throw refusedError(`PDF engine ${value} was not found${isPath ? " or is not an executable file" : " on PATH"}`);
  }
  return { name: kind, file };
}

// How long an engine may run before the build gives up on it.
const ENGINE_TIMEOUT_MS = 10 * 60 * 1000;

// Windows runs a .cmd or .bat script (npm installs pagedjs-cli as one) only
// through cmd.exe. Every argument here is a path the CLI made, quoted, and
// any character cmd.exe would still read inside quotes is refused.
export function windowsScriptCommand(file, args, env) {
  const parts = [file, ...args];
  const unsafe = parts.find((part) => /["%!\r\n]/.test(part));
  if (unsafe !== undefined) {
    throw refusedError(`Cannot run ${file} safely through cmd.exe: ${unsafe} contains a quote, %, or !. Give --pdf-engine an .exe instead`);
  }
  return {
    command: envValue(env, "COMSPEC", "win32") || "cmd.exe",
    args: ["/d", "/s", "/c", `"${parts.map((part) => `"${part}"`).join(" ")}"`],
    options: { windowsVerbatimArguments: true }
  };
}

// Renders `html` to PDF bytes with `engine` ({ name, file }). The HTML and
// the PDF live in a temporary folder that is removed afterwards. A failed
// run, or one that leaves no PDF, is a refused write carrying the engine's
// last lines of output.
export function renderPdf(html, engine, { env = process.env, platform = process.platform, timeout = ENGINE_TIMEOUT_MS } = {}) {
  const spec = PDF_ENGINES.find((entry) => entry.name === engine.name);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "story-pdf-"));
  try {
    const input = path.join(work, "book.html");
    const output = path.join(work, "book.pdf");
    fs.writeFileSync(input, html, "utf8");
    const args = spec.args(input, output, work);
    const run = platform === "win32" && /\.(?:cmd|bat)$/i.test(engine.file)
      ? windowsScriptCommand(engine.file, args, env)
      : { command: engine.file, args, options: {} };
    const result = spawnSync(run.command, run.args, {
      ...run.options,
      cwd: work,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true
    });
    const detail = lastLines(`${result.stderr ?? ""}\n${result.stdout ?? ""}`);
    if (result.error) {
      const reason = result.error.code === "ETIMEDOUT" ? `did not finish within ${timeout / 1000} seconds` : `could not be run (${result.error.message})`;
      throw refusedError(`PDF engine ${engine.name} (${engine.file}) ${reason}`);
    }
    const pdf = fs.existsSync(output) ? fs.readFileSync(output) : null;
    if (result.status !== 0 || pdf === null || !pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      const outcome = result.status !== 0
        ? `exited with ${result.status === null ? `signal ${result.signal}` : `code ${result.status}`}`
        : pdf === null ? "wrote no PDF" : "wrote a file that is not a PDF";
      throw refusedError(`PDF engine ${engine.name} (${engine.file}) ${outcome}${detail === "" ? "" : `:\n${detail}`}`);
    }
    return pdf;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function lastLines(text, count = 10) {
  return text.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line !== "").slice(-count).join("\n");
}
