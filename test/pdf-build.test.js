import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { findCommand, PDF_ENGINES, renderPdf, resolvePdfEngine, windowsScriptCommand } from "../src/pdf.js";
import { shunnHtml } from "../src/packaging.js";
import { createStoryProject } from "../src/story.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

// The fake engines are scripts with a shebang, which Windows cannot run.
const posix = process.platform !== "win32";

function pdfProject(extra = "") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Paper Lanterns", force: false });
  const storyPath = path.join(root, "story.md");
  const raw = fs.readFileSync(storyPath, "utf8");
  fs.writeFileSync(storyPath, raw.replace("title: Paper Lanterns\n", `title: Paper Lanterns\nauthor: Mara Quill\ncontact:\n  - Mara Quill\n  - mara@example.com\n${extra}`), "utf8");
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), `
title: First Light
number: 1
status: draft
word-count: 0
`, "## Chapter Text\n\nThe lanterns rose over the *harbour*.\n\nNobody counted them.\n");
  return root;
}

// A fake engine: records its name, arguments, and the HTML it was given in
// $FAKE_PDF_LOG, then writes a tiny PDF where its kind of engine is told to.
// FAKE_PDF_MODE=fail exits 3 with a message; nopdf exits 0 and writes nothing.
function fakeEngine(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const flag = args.find((arg) => arg.startsWith("--print-to-pdf="));
const out = flag ? flag.slice("--print-to-pdf=".length) : args.includes("-o") ? args[args.indexOf("-o") + 1] : args[1];
const input = flag ? new URL(args[args.length - 1]) : args[0];
fs.appendFileSync(process.env.FAKE_PDF_LOG, JSON.stringify({ name: ${JSON.stringify(name)}, args, html: fs.readFileSync(input, "utf8") }) + "\\n");
if (process.env.FAKE_PDF_MODE === "fail") { process.stderr.write("fake engine: font not found\\n"); process.exit(3); }
if (process.env.FAKE_PDF_MODE === "crash") { process.stderr.write("[1:2:FATAL:zygote_host_impl_linux.cc(127)] No usable sandbox!\\n" + Array.from({ length: 12 }, (_, n) => "#" + n + " 0x7f4e18a2a1ca").join("\\n") + "\\n"); process.exit(5); }
if (process.env.FAKE_PDF_MODE !== "nopdf") { fs.writeFileSync(out, "%PDF-1.7\\n% fake\\n"); }
`, { mode: 0o755 });
  return file;
}

function runWith(env, argv, cwd) {
  const saved = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    process.env[key] = env[key];
  }
  try {
    const io = memoryIo(cwd);
    const code = runCli(argv, io);
    return { code, out: io.output(), err: io.error() };
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function readLog(log) {
  return fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
}

describe.skipIf(!posix)("build --pdf with a stub engine", () => {
  test("renders the print interior with the first engine found and removes its temp files", () => {
    const root = pdfProject();
    const bin = makeTempDir();
    fakeEngine(bin, "weasyprint");
    fakeEngine(bin, "chromium");
    const log = path.join(makeTempDir(), "log.jsonl");
    const result = runWith({ PATH: bin, FAKE_PDF_LOG: log, FAKE_PDF_MODE: "" }, ["build", root, "--format", "print", "--pdf", "--trim", "6x9"], root);

    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    const outFile = path.join(root, "dist", "paper-lanterns.pdf");
    expect(result.out).toBe(`Built 1 chapters as print PDF (weasyprint) to ${outFile}\n`);
    expect(fs.readFileSync(outFile, "utf8")).toStartWith("%PDF-1.7");
    const [call] = readLog(log);
    expect(call.name).toBe("weasyprint");
    expect(call.args).toHaveLength(2);
    expect(path.basename(call.args[0])).toBe("book.html");
    expect(path.basename(call.args[1])).toBe("book.pdf");
    expect(call.html).toContain("@page { size: 6in 9in;");
    expect(call.html).toContain("The lanterns rose over the <em>harbour</em>.");
    expect(fs.existsSync(path.dirname(call.args[0]))).toBe(false);
    expect(fs.existsSync(path.join(root, "dist", "paper-lanterns.print.html"))).toBe(false);
  });

  test("renders a Shunn manuscript to .shunn.pdf, with Prince ahead of everything else", () => {
    const root = pdfProject();
    const bin = makeTempDir();
    fakeEngine(bin, "pagedjs-cli");
    fakeEngine(bin, "prince");
    const log = path.join(makeTempDir(), "log.jsonl");
    const result = runWith({ PATH: bin, FAKE_PDF_LOG: log, FAKE_PDF_MODE: "" }, ["build", root, "--format", "shunn", "--pdf"], root);

    expect(result.code).toBe(0);
    expect(result.out).toContain(`as shunn PDF (prince) to ${path.join(root, "dist", "paper-lanterns.shunn.pdf")}`);
    const [call] = readLog(log);
    expect(call.name).toBe("prince");
    expect(call.args[1]).toBe("-o");
    expect(call.html).toContain("@page { size: letter; margin: 1in;");
    expect(call.html).toContain(`content: "Quill / " "Paper Lanterns / " counter(page)`);
    expect(call.html).toContain("Approximately 9 words");
    expect(call.html).toContain("<p>mara@example.com</p>");
    expect(call.html).toContain("<h2>Chapter 1: First Light</h2>");
  });

  test("a print PDF warns about a [TODO marker on a matter page it prints; a Shunn PDF prints no matter (#557)", () => {
    const root = pdfProject();
    writeMarkdown(path.join(root, "matter", "copyright.md"), "title: Copyright\nplacement: front\norder: 0\nheading: false", "Copyright © 2026 Mara Quill\n\nISBN [TODO: author to supply]\n");
    const bin = makeTempDir();
    fakeEngine(bin, "prince");
    const log = path.join(makeTempDir(), "log.jsonl");
    const env = { PATH: bin, FAKE_PDF_LOG: log, FAKE_PDF_MODE: "" };

    const print = runWith(env, ["build", root, "--format", "print", "--pdf"], root);
    expect(print.code).toBe(0);
    expect(print.err).toBe("warning: matter/copyright.md still has 1 [TODO marker, which this build prints: ask the author to supply the text before you publish [matter-todo-markers]\n");
    const shunn = runWith(env, ["build", root, "--format", "shunn", "--pdf"], root);
    expect(shunn.code).toBe(0);
    expect(shunn.err).toBe("");
  });

  test("--anonymous leaves every name out of the Shunn PDF, the running head included", () => {
    const root = pdfProject("short-title: Lanterns\n");
    const bin = makeTempDir();
    fakeEngine(bin, "prince");
    const log = path.join(makeTempDir(), "log.jsonl");
    const result = runWith({ PATH: bin, FAKE_PDF_LOG: log, FAKE_PDF_MODE: "" }, ["build", root, "--format", "shunn", "--pdf", "--anonymous"], root);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    const [call] = readLog(log);
    expect(call.html).toContain(`@top-right { content: "Lanterns / " counter(page);`);
    expect(call.html).not.toContain("Mara");
    expect(call.html).not.toContain("Quill");
    expect(call.html).toContain("Approximately 9 words");
  });

  test("--paper a4 sets the Shunn PDF on A4, from the command line or a story.md default", () => {
    const bin = makeTempDir();
    fakeEngine(bin, "prince");
    const log = path.join(makeTempDir(), "log.jsonl");
    const root = pdfProject();
    const flagged = runWith({ PATH: bin, FAKE_PDF_LOG: log, FAKE_PDF_MODE: "" }, ["build", root, "--format", "shunn", "--pdf", "--paper", "A4"], root);
    expect(flagged.err).toBe("");
    expect(flagged.code).toBe(0);

    const defaulted = pdfProject("cli-defaults:\n  - command: build\n    paper: a4\n");
    const fromDefault = runWith({ PATH: bin, FAKE_PDF_LOG: log, FAKE_PDF_MODE: "" }, ["build", defaulted, "--format", "shunn", "--pdf"], defaulted);
    expect(fromDefault.err).toBe("");
    expect(fromDefault.code).toBe(0);

    const calls = readLog(log);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.html).toContain("@page { size: A4; margin: 1in;");
    }
  });

  test("falls back to Chrome's headless print to PDF with a file URL and a profile of its own", () => {
    const root = pdfProject();
    const bin = makeTempDir();
    fakeEngine(bin, "google-chrome");
    const log = path.join(makeTempDir(), "log.jsonl");
    const result = runWith({ PATH: bin, FAKE_PDF_LOG: log, FAKE_PDF_MODE: "" }, ["build", root, "--format", "print", "--pdf", "--out", "dist/proof.pdf"], root);

    expect(result.code).toBe(0);
    expect(result.out).toContain("as print PDF (chrome)");
    const [call] = readLog(log);
    expect(call.args).toContain("--headless");
    expect(call.args).toContain("--no-pdf-header-footer");
    expect(call.args.some((arg) => arg.startsWith("--user-data-dir="))).toBe(true);
    expect(call.args.some((arg) => arg.startsWith("--print-to-pdf=") && arg.endsWith("book.pdf"))).toBe(true);
    expect(call.args[call.args.length - 1]).toMatch(/^file:\/\/.*book\.html$/);
    expect(fs.readFileSync(path.join(root, "dist", "proof.pdf"), "utf8")).toStartWith("%PDF-");
  });

  test("--pdf-engine picks an engine by name or by path, wherever it is", () => {
    const root = pdfProject();
    const bin = makeTempDir();
    fakeEngine(bin, "prince");
    fakeEngine(bin, "weasyprint");
    const elsewhere = fakeEngine(path.join(makeTempDir(), "tools"), "pagedjs-cli");
    const log = path.join(makeTempDir(), "log.jsonl");
    const env = { PATH: bin, FAKE_PDF_LOG: log, FAKE_PDF_MODE: "" };

    expect(runWith(env, ["build", root, "--format", "print", "--pdf", "--pdf-engine", "WeasyPrint"], root).code).toBe(0);
    expect(runWith(env, ["build", root, "--format", "print", "--pdf", "--pdf-engine", elsewhere], root).out).toContain("(pagedjs-cli)");
    expect(readLog(log).map((call) => call.name)).toEqual(["weasyprint", "pagedjs-cli"]);
  });

  test("no title or output name reaches the engine's command line", () => {
    const root = pdfProject();
    const bin = makeTempDir();
    fakeEngine(bin, "weasyprint");
    const log = path.join(makeTempDir(), "log.jsonl");
    const out = "dist/$(touch pwned); rm -rf x \"q\".pdf";
    const result = runWith({ PATH: bin, FAKE_PDF_LOG: log, FAKE_PDF_MODE: "" }, ["build", root, "--format", "print", "--pdf", "--out", out], root);

    expect(result.code).toBe(0);
    expect(fs.existsSync(path.join(root, out))).toBe(true);
    expect(fs.existsSync(path.join(root, "pwned"))).toBe(false);
    const [call] = readLog(log);
    expect(call.args.every((arg) => !arg.includes("pwned") && !arg.includes("Paper"))).toBe(true);
  });

  test("a failing engine, or one that writes no PDF, is a refused write that leaves nothing behind", () => {
    const root = pdfProject();
    const bin = makeTempDir();
    fakeEngine(bin, "weasyprint");
    const log = path.join(makeTempDir(), "log.jsonl");
    const outFile = path.join(root, "dist", "paper-lanterns.pdf");

    const failed = runWith({ PATH: bin, FAKE_PDF_LOG: log, FAKE_PDF_MODE: "fail" }, ["build", root, "--format", "print", "--pdf"], root);
    expect(failed.code).toBe(4);
    expect(failed.err).toContain("PDF engine weasyprint");
    expect(failed.err).toContain("exited with code 3:\nfake engine: font not found");

    const crashed = runWith({ PATH: bin, FAKE_PDF_LOG: log, FAKE_PDF_MODE: "crash" }, ["build", root, "--format", "print", "--pdf"], root);
    expect(crashed.code).toBe(4);
    expect(crashed.err).toContain("exited with code 5:\n[1:2:FATAL:zygote_host_impl_linux.cc(127)] No usable sandbox!\n...\n#2 0x7f4e18a2a1ca\n");
    expect(crashed.err).toContain("#11 0x7f4e18a2a1ca");

    const empty = runWith({ PATH: bin, FAKE_PDF_LOG: log, FAKE_PDF_MODE: "nopdf" }, ["build", root, "--format", "print", "--pdf"], root);
    expect(empty.code).toBe(4);
    expect(empty.err).toContain("wrote no PDF");
    expect(fs.existsSync(outFile)).toBe(false);
  });

  test("--json names the engine that rendered the PDF, or would have, and a failed engine is the JSON error", () => {
    const root = pdfProject();
    const bin = makeTempDir();
    fakeEngine(bin, "pagedjs-cli");
    const log = path.join(makeTempDir(), "log.jsonl");
    const outFile = path.join(root, "dist", "paper-lanterns.shunn.pdf");
    const run = (mode, extra = []) => {
      const result = runWith({ PATH: bin, FAKE_PDF_LOG: log, FAKE_PDF_MODE: mode }, ["build", root, "--format", "shunn", "--pdf", "--json", ...extra], root);
      expect(result.err).toBe("");
      return { code: result.code, envelope: JSON.parse(result.out) };
    };

    const preview = run("", ["--dry-run"]);
    expect(preview.envelope.data).toEqual({ format: "shunn", outFile, chapters: 1, pages: null, pdf: true, engine: "pagedjs-cli", dryRun: true, changes: [{ action: "mkdir", path: "dist" }, { action: "create", path: "dist/paper-lanterns.shunn.pdf" }] });
    expect(preview.envelope.writes).toEqual([]);
    expect(readLog(log)).toEqual([]);

    const built = run("");
    expect(built.code).toBe(0);
    expect(built.envelope.data).toEqual({ ...preview.envelope.data, dryRun: false });
    expect(built.envelope.writes).toEqual([outFile]);
    expect(readLog(log)).toHaveLength(1);

    const failed = run("fail");
    expect(failed.code).toBe(4);
    expect(failed.envelope).toMatchObject({ command: "build", ok: false, data: null, writes: [] });
    expect(failed.envelope.diagnostics[0]).toMatchObject({ code: "write-refused", message: expect.stringContaining("fake engine: font not found") });
  });

  test("a story.md default engine applies to PDF builds and waits out the others", () => {
    const root = pdfProject("cli-defaults:\n  - command: build\n    pdf-engine: prince\n");
    const bin = makeTempDir();
    fakeEngine(bin, "prince");
    fakeEngine(bin, "weasyprint");
    const log = path.join(makeTempDir(), "log.jsonl");
    const env = { PATH: bin, FAKE_PDF_LOG: log, FAKE_PDF_MODE: "" };

    expect(runWith(env, ["build", root, "--format", "epub"], root).code).toBe(0);
    expect(runWith(env, ["build", root, "--format", "print", "--pdf"], root).out).toContain("(prince)");
    expect(runWith(env, ["build", root, "--format", "print", "--pdf", "--pdf-engine", "weasyprint"], root).out).toContain("(weasyprint)");
  });

  test("a story.md default cannot name a program for build to run", () => {
    const root = pdfProject("cli-defaults:\n  - command: build\n    format: print\n    pdf: true\n    pdf-engine: ./tools/prince\n");
    const tools = path.join(root, "tools");
    const log = path.join(makeTempDir(), "log.jsonl");
    fakeEngine(tools, "prince");

    const build = runWith({ PATH: makeTempDir(), FAKE_PDF_LOG: log, FAKE_PDF_MODE: "" }, ["build", root], root);
    expect(build.code).toBe(3);
    expect(build.err).toContain("cli-defaults[0] pdf-engine must name an engine (prince, weasyprint, pagedjs-cli, chrome)");
    expect(readLog(log)).toEqual([]);

    const validate = runWith({}, ["validate", root], root);
    expect(validate.code).toBe(1);
    expect(validate.err).toContain("pdf-engine must name an engine");
  });

  test("the engine's output is kept when it times out, and helpers it left running are ended", () => {
    const dir = makeTempDir();
    const pidFile = path.join(dir, "helper.pid");
    const file = path.join(dir, "chromium");
    // Starts a helper that would outlive it by 20 seconds, holding the log
    // open, then exits after writing a PDF.
    fs.writeFileSync(file, `#!${process.execPath}
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const helper = spawn(${JSON.stringify(process.execPath)}, ["-e", "setTimeout(() => {}, 20000)"], { stdio: "inherit" });
fs.writeFileSync(${JSON.stringify(pidFile)}, String(helper.pid));
helper.unref();
const out = process.argv.find((arg) => arg.startsWith("--print-to-pdf=")).slice("--print-to-pdf=".length);
fs.writeFileSync(out, "%PDF-1.7\\n");
`, { mode: 0o755 });
    const started = Date.now();
    expect(renderPdf("<p>x</p>", { name: "chrome", file }).subarray(0, 5).toString()).toBe("%PDF-");
    expect(Date.now() - started).toBeLessThan(15000);
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    let alive = true;
    for (let tries = 0; tries < 50 && alive; tries += 1) {
      try {
        process.kill(pid, 0);
        Bun.sleepSync(20);
      } catch {
        alive = false;
      }
    }
    expect(alive).toBe(false);

    const slow = path.join(dir, "weasyprint");
    fs.writeFileSync(slow, `#!${process.execPath}\nprocess.stderr.write("loading fonts\\n");\nsetTimeout(() => {}, 10000);\n`, { mode: 0o755 });
    expect(() => renderPdf("<p>x</p>", { name: "weasyprint", file: slow }, { timeout: 1000 })).toThrow("did not finish within 1 seconds:\nloading fonts");
    // As Windows runs it: taskkill ends the tree (and, missing here, fails
    // harmlessly), and the timeout is still reported.
    expect(() => renderPdf("<p>x</p>", { name: "weasyprint", file: slow }, { timeout: 500, platform: "win32" })).toThrow("did not finish within 0.5 seconds");
  });
});

describe("build --pdf errors", () => {
  // Chrome or Edge in the usual Windows install folders, or in
  // /Applications on macOS (as on CI runners), would count as an engine.
  test.skipIf(process.platform === "darwin")("no engine installed stops with install hints and exit 4", () => {
    const root = pdfProject();
    const result = runWith({ PATH: makeTempDir(), ProgramFiles: "", "ProgramFiles(x86)": "", LOCALAPPDATA: "" }, ["build", root, "--format", "print", "--pdf"], root);

    expect(result.code).toBe(4);
    expect(result.err).toContain("No PDF engine found on PATH (looked for prince, weasyprint, pagedjs-cli, chrome)");
    expect(result.err).toContain("pip install weasyprint");
    expect(result.err).toContain("npm install -g pagedjs-cli");
    expect(result.err).toContain("--pdf-engine <name|path>");
    expect(fs.existsSync(path.join(root, "dist"))).toBe(false);
  });

  test("a named engine that is not installed is exit 4; an unknown one is a usage error", () => {
    const root = pdfProject();
    const missing = runWith({ PATH: makeTempDir() }, ["build", root, "--format", "shunn", "--pdf", "--pdf-engine", "prince"], root);
    expect(missing.code).toBe(4);
    expect(missing.err).toContain("PDF engine prince was not found on PATH");

    const unknown = runWith({ PATH: makeTempDir() }, ["build", root, "--format", "shunn", "--pdf", "--pdf-engine", "wkhtmltopdf"], root);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain("Unknown PDF engine: wkhtmltopdf");
  });

  test("--pdf only goes with print and shunn, and --pdf-engine only with --pdf", () => {
    const root = pdfProject();
    for (const format of ["epub", "docx", "html", "markdown"]) {
      const result = runWith({}, ["build", root, "--format", format, "--pdf"], root);
      expect(result.code).toBe(2);
      expect(result.err).toContain("--pdf applies only to --format print and --format shunn");
    }
    const engineOnly = runWith({}, ["build", root, "--format", "print", "--pdf-engine", "prince"], root);
    expect(engineOnly.code).toBe(2);
    expect(engineOnly.err).toContain("--pdf-engine applies only with --pdf");
  });

  test("build --help lists the PDF flags", () => {
    const result = runWith({}, ["build", "--help"], makeTempDir());
    expect(result.out).toContain("--pdf ");
    expect(result.out).toContain("--pdf-engine <name|path>");
  });
});

describe("PDF engine lookup", () => {
  test("Windows lookup tries each PATHEXT extension, reading Path in any case", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "pagedjs-cli.CMD"), "");
    expect(findCommand("pagedjs-cli", { Path: dir, PATHEXT: ".EXE;.CMD" }, "win32")).toBe(path.join(dir, "pagedjs-cli.CMD"));
    expect(findCommand("pagedjs-cli", { Path: dir, PATHEXT: ".EXE" }, "win32")).toBe(null);
    expect(resolvePdfEngine(undefined, { env: { PATH: dir, PATHEXT: ".CMD" }, platform: "win32" })).toEqual({ name: "pagedjs-cli", file: path.join(dir, "pagedjs-cli.CMD") });
  });

  test.skipIf(!posix)("a file that is not executable is not an engine on POSIX", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "weasyprint"), "", { mode: 0o644 });
    expect(findCommand("weasyprint", { PATH: dir }, "linux")).toBe(null);
  });

  test("a .cmd engine runs through cmd.exe with every argument quoted, refusing what cmd would expand", () => {
    const run = windowsScriptCommand("C:\\npm\\pagedjs-cli.cmd", ["C:\\Temp\\story-pdf-1\\book.html", "-o", "C:\\Temp\\story-pdf-1\\book.pdf"], { ComSpec: "C:\\Windows\\system32\\cmd.exe" });
    expect(run.command).toBe("C:\\Windows\\system32\\cmd.exe");
    expect(run.args).toEqual(["/d", "/s", "/c", "\"\"C:\\npm\\pagedjs-cli.cmd\" \"C:\\Temp\\story-pdf-1\\book.html\" \"-o\" \"C:\\Temp\\story-pdf-1\\book.pdf\"\""]);
    expect(run.options.windowsVerbatimArguments).toBe(true);
    expect(() => windowsScriptCommand("C:\\npm\\pagedjs-cli.cmd", ["C:\\Users\\100%\\book.html"], {})).toThrow("cmd.exe");
  });

  test("Chrome and Edge are found in their Windows install folders when PATH has none", () => {
    const programs = makeTempDir();
    const chrome = path.join(programs, "Google", "Chrome", "Application", "chrome.exe");
    fs.mkdirSync(path.dirname(chrome), { recursive: true });
    fs.writeFileSync(chrome, "");
    expect(resolvePdfEngine(undefined, { env: { PATH: "", ProgramFiles: programs }, platform: "win32" })).toEqual({ name: "chrome", file: chrome });
    expect(() => resolvePdfEngine("chrome", { env: { PATH: "" }, platform: "win32" })).toThrow("PDF engine chrome was not found");
    expect(() => resolvePdfEngine("edge", { env: { PATH: "" }, platform: "win32" })).toThrow("Unknown PDF engine: edge");
    // macOS looks in /Applications, where a Mac (or CI runner) may have Chrome.
    if (process.platform !== "darwin") {
      expect(() => resolvePdfEngine(undefined, { env: { PATH: "" }, platform: "darwin" })).toThrow("No PDF engine found");
    }
  });

  test.skipIf(!posix)("--pdf-engine reads the engine from an executable's file name, as a path or a command", () => {
    const dir = makeTempDir();
    const make = (name) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, "", { mode: 0o755 });
      return file;
    };
    expect(resolvePdfEngine(make("prince-15")).name).toBe("prince");
    expect(resolvePdfEngine(make("weasyprint3")).name).toBe("weasyprint");
    expect(resolvePdfEngine(make("Google Chrome")).name).toBe("chrome");
    make("chromium-snap");
    expect(resolvePdfEngine("chromium-snap", { env: { PATH: dir } })).toEqual({ name: "chrome", file: path.join(dir, "chromium-snap") });
    expect(resolvePdfEngine("./prince-15", { cwd: dir })).toEqual({ name: "prince", file: path.join(dir, "prince-15") });

    fs.mkdirSync(path.join(dir, "bin", "weasyprint"), { recursive: true });
    expect(findCommand("weasyprint", { PATH: path.join(dir, "bin") }, "linux")).toBe(null);
    expect(() => resolvePdfEngine(path.join(dir, "missing", "prince"))).toThrow("or is not an executable file");
    expect(() => resolvePdfEngine("pagedjs-cli-9", { env: { PATH: dir } })).toThrow("PDF engine pagedjs-cli-9 was not found on PATH");
    expect(() => resolvePdfEngine("  ")).toThrow("--pdf-engine needs an engine name");
  });

  test("an engine that cannot be started or runs too long is a refused write", () => {
    let error;
    try {
      renderPdf("<p>x</p>", { name: "weasyprint", file: path.join(makeTempDir(), "weasyprint") });
    } catch (caught) {
      error = caught;
    }
    expect(error.exitCode).toBe(4);
    expect(error.message).toContain("could not be run");
  });

  test("engines are tried in the documented order", () => {
    expect(PDF_ENGINES.map((engine) => engine.name)).toEqual(["prince", "weasyprint", "pagedjs-cli", "chrome"]);
  });
});

describe("Shunn manuscript HTML", () => {
  const manuscript = (chapters) => ({ meta: { language: "en" }, chapters });
  const meta = { title: "A \"Quoted\" </style> Title", author: "Mara Quill", labels: undefined, contact: ["Mara"], words: 12, pack: undefined, shortForm: true };

  test("a short story runs on after the byline with # between sections and skips empty chapters", () => {
    const html = shunnHtml(manuscript([
      { heading: "Chapter 1", body: "One.\n\n***\n\nTwo." },
      { heading: "Chapter 2", body: "" },
      { heading: "Chapter 3", body: "Three." }
    ]), { ...meta, labels: { by: "by", "approximate-words": "Approximately {words} words" } });

    expect(html).not.toContain("Chapter 1");
    expect(html).toContain("<p>One.</p>\n<p class=\"break\">#</p>\n<p>Two.</p>\n<p class=\"break\">#</p>\n<p>Three.</p>");
    expect(html).toContain("<div class=\"short-form\">");
  });

  test("the page is US Letter by default and A4 on request, with 1in margins on both", () => {
    const labels = { by: "by", "approximate-words": "Approximately {words} words" };
    const book = manuscript([{ heading: "Chapter 1", body: "One." }]);
    expect(shunnHtml(book, { ...meta, labels })).toContain("@page { size: letter; margin: 1in;");
    expect(shunnHtml(book, { ...meta, labels }, "letter")).toContain("@page { size: letter; margin: 1in;");
    expect(shunnHtml(book, { ...meta, labels }, "a4")).toContain("@page { size: A4; margin: 1in;");
    expect(() => shunnHtml(book, { ...meta, labels }, "a3")).toThrow("Unsupported paper: a3");
  });

  test("the running head escapes the title for CSS", () => {
    const html = shunnHtml(manuscript([{ heading: "Chapter 1", body: "One." }]), { ...meta, labels: { by: "by", "approximate-words": "Approximately {words} words" } });
    expect(html).toContain("\"A \\\"Quoted\\\" \\3C /style\\3E  Title / \"");
    expect(html).toContain("<h1>A &quot;Quoted&quot; &lt;/style&gt; Title</h1>");
  });

  // CSS reads a form feed as a line break, which ended the author's string
  // in the running head and let the text after it add CSS rules.
  test("a form feed in the surname stays inside the running head's CSS string", () => {
    const html = shunnHtml(manuscript([{ heading: "Chapter 1", body: "One." }]), { ...meta, surname: "Ann\f}} body {", labels: { by: "by", "approximate-words": "Approximately {words} words" } });
    // The head's CSS string tokens, each a quote, then anything but a quote,
    // backslash, or line break, or a backslash and the character it escapes.
    const head = /@top-right \{ content: ((?:"(?:[^"\\\n\r\f]|\\[\s\S])*" )*)counter\(page\);/.exec(html);
    expect(head?.[1]).toBe('"Ann }} body { / " "A \\"Quoted\\" \\3C /style\\3E  Title / " ');
  });
});

// A real paged-media engine, when this machine has one: the PDF it writes
// is a PDF. Browsers are left out: whether headless Chrome runs at all
// depends on the machine's sandbox and first-run state (CI runners crash or
// hang), which the stub engine tests cover instead.
let realEngine = null;
try {
  realEngine = resolvePdfEngine();
} catch {
  realEngine = null;
}
if (realEngine?.name === "chrome") {
  realEngine = null;
}

describe.skipIf(realEngine === null)("build --pdf with an installed engine", () => {
  test("renders the print interior and the Shunn manuscript", () => {
    const root = pdfProject();
    for (const format of ["print", "shunn"]) {
      const io = memoryIo(root);
      const code = runCli(["build", root, "--format", format, "--pdf"], io);
      expect(`${code} ${realEngine.file} ${io.error()}`).toBe(`0 ${realEngine.file} `);
      const file = path.join(root, "dist", format === "print" ? "paper-lanterns.pdf" : "paper-lanterns.shunn.pdf");
      expect(fs.readFileSync(file).subarray(0, 5).toString()).toBe("%PDF-");
    }
  }, 120000);
});
