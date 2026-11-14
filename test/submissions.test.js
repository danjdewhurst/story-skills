import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { createStoryProject, shellWord } from "../src/story.js";
import { SUBMISSION_STATUSES, submissionsReport } from "../src/submissions.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { SYMLINKS_SUPPORTED, expectLinearGrowth, makeTempDir, memoryIo, treeDiff, treeSnapshot } from "./helpers.js";

const resultSchema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));
const TODAY = "2026-11-14";

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

function json(cwd, argv) {
  const result = invoke(cwd, [...argv, "--json"]);
  expect(result.err).toBe("");
  const envelope = JSON.parse(result.out);
  expect(validateAgainstSchema(envelope, resultSchema)).toEqual([]);
  expect(envelope.ok).toBe(result.code === 0);
  return { ...result, envelope };
}

function project(title = "Query Book") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title, force: false });
  return { cwd, root };
}

function writeTracker(root, text) {
  fs.mkdirSync(path.join(root, "submission"), { recursive: true });
  fs.writeFileSync(path.join(root, "submission", "tracker.md"), text);
}

const HEAD = "---\ntype: submission-tracker\nstory: query-book\nupdated: 2026-11-01\n---\n\n# Submission Tracker: Query Book\n\n";
const BOOK_HEADER = "| Agent/Publisher | Date Sent | Materials | Status | Response Date | Notes |\n|-----------------|-----------|-----------|--------|---------------|-------|\n";

function bookTracker(rows, tail = "\n## Summary\n\n- Queried: 9\n") {
  return `${HEAD}${BOOK_HEADER}${rows.join("\n")}\n${tail}`;
}

const ROWS = [
  "| Jane Agent (Big Lit) | 2026-06-01 | query + first 10 pages | queried | | personalized |",
  "| Mark Smith | 2026-05-01 | query | requested-full | 2026-09-01 | sent the full |",
  "| Ann \\| Co | 2026-04-01 | query | `declined` | 2026-04-20 | form rejection |",
  "| Ola Press | 2026-10-20 | query + synopsis | queried | | |"
];

describe("story submissions", () => {
  test("a project without a tracker prints a note and exits 0", () => {
    const { cwd, root } = project();
    const text = invoke(cwd, ["submissions", root, "--date", TODAY]);
    expect(text.code).toBe(0);
    expect(text.out).toBe("No submission tracker: submission/tracker.md does not exist yet. The submission skill creates it when the first submission goes out.\n");
    expect(text.err).toBe("Submissions checked: 0 errors, 0 warnings, 0 dismissed\n");
    const { code, envelope } = json(cwd, ["submissions", root, "--date", TODAY]);
    expect(code).toBe(0);
    expect(envelope.data).toMatchObject({ file: "submission/tracker.md", found: false, rows: [], waiting: 0, overdue: 0, days: 90, today: TODAY });
    expect(Object.keys(envelope.data.counts)).toEqual(SUBMISSION_STATUSES);
  });

  test("lists the rows, counts each status from the table, and flags replies awaited 90 days or more", () => {
    const { cwd, root } = project();
    writeTracker(root, bookTracker(["| *No submissions yet* | | | | | |", ...ROWS]));
    const text = invoke(cwd, ["submissions", root, "--date", TODAY]);
    expect(text.code).toBe(0);
    expect(text.out).toBe([
      "# Submissions: submission/tracker.md",
      "",
      "Today: 2026-11-14; follow up after 90 days or more without a reply",
      "",
      "- Jane Agent (Big Lit): queried, sent 2026-06-01; waiting 166 days: follow up",
      "- Mark Smith: requested-full, sent 2026-05-01, reply 2026-09-01; waiting 74 days",
      "- Ann | Co: declined, sent 2026-04-01, reply 2026-04-20",
      "- Ola Press: queried, sent 2026-10-20; waiting 25 days",
      "",
      "Counts: queried 2, requested-full 1, declined 1 (4 submissions)",
      "Waiting for a reply: 3; due a follow-up: 1",
      ""
    ].join("\n"));
    expect(text.err).toBe([
      "Submissions checked: 0 errors, 1 warnings, 0 dismissed",
      "warning: submission/tracker.md line 12 (Jane Agent (Big Lit)): queried, waiting 166 days for a reply since 2026-06-01 (90 or more is due a follow-up): follow up, or record the reply [submission-overdue]",
      ""
    ].join("\n"));

    const { envelope } = json(cwd, ["submissions", root, "--date", TODAY]);
    expect(envelope.command).toBe("submissions");
    expect(envelope.writes).toEqual([]);
    expect(envelope.data.counts).toEqual({ queried: 2, submitted: 0, held: 0, "requested-partial": 0, "requested-full": 1, offer: 0, declined: 1, "no-response": 0, withdrawn: 0 });
    expect(envelope.data.rows[1]).toEqual({
      line: 13, name: "Mark Smith", story: null, dateSent: "2026-05-01", materials: "query", type: null, rights: null,
      status: "requested-full", responseDate: "2026-09-01", notes: "sent the full", waitingSince: "2026-09-01", waitingDays: 74, overdue: false
    });
    expect(envelope.diagnostics).toEqual([expect.objectContaining({ severity: "warning", code: "submission-overdue", file: "submission/tracker.md", check: "submissions" })]);
  });

  test("--days changes the follow-up window", () => {
    const { cwd, root } = project();
    writeTracker(root, bookTracker(ROWS));
    expect(submissionsReport(root, { today: TODAY, days: 20 }).overdue).toBe(3);
    const { envelope } = json(cwd, ["submissions", root, "--date", TODAY, "--days", "200"]);
    expect(envelope.data).toMatchObject({ days: 200, waiting: 3, overdue: 0 });
    expect(envelope.diagnostics).toEqual([]);
    // A reply awaited exactly the window is due; one day short is not.
    expect(submissionsReport(root, { today: TODAY, days: 166 }).rows[0].overdue).toBe(true);
    expect(submissionsReport(root, { today: TODAY, days: 167 }).rows[0].overdue).toBe(false);
  });

  test("an unknown status or a malformed date is an error, and exits 1", () => {
    const { cwd, root } = project();
    writeTracker(root, bookTracker([
      "| Bad Status | 2026-06-01 | query | sent | | |",
      "| Bad Date | 2026-13-01 | query | queried | | |",
      "| Bad Reply | 2026-06-01 | query | declined | June 5 | |",
      "| | | | | | |"
    ]));
    const result = invoke(cwd, ["submissions", root, "--date", TODAY]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("Submissions check failed: 5 errors, 0 warnings, 0 dismissed\n");
    expect(result.err).toContain('error: submission/tracker.md line 11 (Bad Status): Status "sent" is not a tracker status; use one of queried, requested-partial, requested-full, offer, declined, no-response, withdrawn\n');
    expect(result.err).toContain('error: submission/tracker.md line 12 (Bad Date): Date Sent "2026-13-01" must be a real YYYY-MM-DD calendar day\n');
    expect(result.err).toContain('error: submission/tracker.md line 13 (Bad Reply): Response Date "June 5" must be a real YYYY-MM-DD calendar day\n');
    expect(result.err).toContain("error: submission/tracker.md line 14: Status is empty;");
    expect(result.err).toContain("error: submission/tracker.md line 14: Date Sent is empty; write the date as YYYY-MM-DD\n");
    const { envelope } = json(cwd, ["submissions", root, "--date", TODAY]);
    expect(envelope.diagnostics.map((entry) => entry.code)).toEqual(["submission-invalid-status", "submission-invalid-date", "submission-invalid-date", "submission-invalid-status", "submission-invalid-date"]);
    // The row with a bad date is still counted by its status.
    expect(envelope.data.counts).toMatchObject({ queried: 1, declined: 1 });
  });

  test("a tracker with no tracker table is an error", () => {
    const { cwd, root } = project();
    writeTracker(root, `${HEAD}Sent to Jane on 2026-06-01.\n\n\`\`\`markdown\n${BOOK_HEADER}| Jane | 2026-06-01 | query | queried | | |\n\`\`\`\n`);
    const result = invoke(cwd, ["submissions", root, "--date", TODAY]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("error: submission/tracker.md has no tracker table: add one with a Status and a Date Sent column");
  });

  test("reads a short-fiction tracker by its headers and leaves the publication history alone", () => {
    const { cwd, root } = project("Short Fiction");
    writeTracker(root, [
      "---\ntype: submission-tracker\nupdated: 2026-11-01\n---\n\n# Submission Tracker: Short Fiction\n",
      "| Market | Story | Date Sent | Type | Rights Offered | Status | Response Date | Notes |",
      "|--------|-------|-----------|------|----------------|--------|---------------|-------|",
      "| Lantern Quarterly | the-gull-rock-light | 2026-07-01 | exclusive | first | held | 2026-08-01 | shortlist |",
      "| Tidewater Review | salt-and-lantern | **2026-10-01** | simultaneous | first | submitted | | |",
      "| Dusk Anthology | salt-and-lantern | 2026-03-01 | simultaneous | reprint | offer | 2026-04-01 | |",
      "",
      "## Publication History",
      "",
      "| Story | Venue | Date | Rights Sold | Rights Revert |",
      "|-------|-------|------|-------------|---------------|",
      "| salt-and-lantern | Dusk Anthology | 2026-06-01 | reprint | |",
      ""
    ].join("\n"));
    const text = invoke(cwd, ["submissions", root, "--date", TODAY]);
    expect(text.code).toBe(0);
    expect(text.out).toContain("- Lantern Quarterly [the-gull-rock-light]: held, sent 2026-07-01, reply 2026-08-01; waiting 105 days: follow up\n");
    expect(text.out).toContain("- Tidewater Review [salt-and-lantern]: submitted, sent 2026-10-01; waiting 44 days\n");
    expect(text.out).toContain("Counts: submitted 1, held 1, offer 1 (3 submissions)\n");
    const { envelope } = json(cwd, ["submissions", root, "--date", TODAY]);
    expect(envelope.data.rows.map((row) => [row.story, row.type, row.rights])).toEqual([
      ["the-gull-rock-light", "exclusive", "first"],
      ["salt-and-lantern", "simultaneous", "first"],
      ["salt-and-lantern", "simultaneous", "reprint"]
    ]);
  });

  test("never writes", () => {
    const { cwd, root } = project();
    writeTracker(root, bookTracker(ROWS));
    const before = treeSnapshot(root);
    invoke(cwd, ["submissions", root, "--date", TODAY]);
    invoke(cwd, ["submissions", root, "--date", TODAY, "--json"]);
    expect(treeDiff(before, treeSnapshot(root))).toEqual([]);
  });

  test.skipIf(!SYMLINKS_SUPPORTED)("refuses a symlinked submission folder, and next ignores it", () => {
    const { cwd, root } = project();
    const elsewhere = makeTempDir();
    writeTracker(elsewhere, bookTracker(ROWS));
    fs.symlinkSync(path.join(elsewhere, "submission"), path.join(root, "submission"), "dir");
    const result = invoke(cwd, ["submissions", root, "--date", TODAY]);
    expect(result.code).toBe(3);
    expect(result.err).toContain("Refusing to use symlinked project directory");
    const next = invoke(cwd, ["next", root, "--date", TODAY]);
    expect(next.code).toBe(0);
    expect(next.out).not.toContain("Follow up on submissions");
  });

  test("a tracker whose frontmatter does not parse exits 3", () => {
    const { cwd, root } = project();
    writeTracker(root, "---\ntype: [submission-tracker\n---\n\n" + BOOK_HEADER + ROWS[0] + "\n");
    const result = invoke(cwd, ["submissions", root, "--date", TODAY]);
    expect(result.code).toBe(3);
    expect(result.err).toContain("submission/tracker.md cannot be parsed");
  });

  test("only the statuses that await a reply wait, each counted once", () => {
    const { cwd, root } = project();
    writeTracker(root, `| Market | Date Sent | Type | Status |\n|---|---|---|---|\n${SUBMISSION_STATUSES.map((status, index) => `| Market ${index} | 2026-01-01 | simultaneous | ${index === 0 ? "Queried" : status} |`).join("\n")}\n`);
    const { code, envelope } = json(cwd, ["submissions", root, "--date", TODAY]);
    expect(code).toBe(0);
    expect(envelope.data.counts).toEqual(Object.fromEntries(SUBMISSION_STATUSES.map((status) => [status, 1])));
    expect(Object.fromEntries(envelope.data.rows.map((row) => [row.status, row.overdue]))).toEqual({
      queried: true, submitted: true, held: true, "requested-partial": true, "requested-full": true,
      offer: false, declined: false, "no-response": false, withdrawn: false
    });
    expect(envelope.data.rows.filter((row) => row.waitingSince !== null).map((row) => row.status)).toEqual(["queried", "submitted", "held", "requested-partial", "requested-full"]);
    // No frontmatter: rows count from line 3.
    expect(envelope.data.rows[0].line).toBe(3);
    expect(envelope.data).toMatchObject({ waiting: 5, overdue: 5 });
  });

  test("a book's table refuses the short-fiction statuses submitted and held", () => {
    const { cwd, root } = project();
    writeTracker(root, bookTracker([
      "| Ada Byrne | 2026-01-01 | query | held | | |",
      "| Tom Reyes | 2026-01-01 | query | Submitted | | |",
      "| Lena Okafor | 2026-01-01 | query | queried | | |"
    ]));
    const result = invoke(cwd, ["submissions", root, "--date", TODAY]);
    expect(result.code).toBe(1);
    const books = "a book's tracker uses one of queried, requested-partial, requested-full, offer, declined, no-response, withdrawn";
    expect(result.err).toContain(`error: submission/tracker.md line 11 (Ada Byrne): Status "held" is for short fiction, in a table with a Market, Type, or Rights Offered column; ${books}\n`);
    expect(result.err).toContain(`error: submission/tracker.md line 12 (Tom Reyes): Status "submitted" is for short fiction, in a table with a Market, Type, or Rights Offered column; ${books}\n`);
    const { envelope } = json(cwd, ["submissions", root, "--date", TODAY]);
    // Neither row is counted or waiting; only the query is due.
    expect(envelope.data.counts).toMatchObject({ queried: 1, submitted: 0, held: 0 });
    expect(envelope.data).toMatchObject({ waiting: 1, overdue: 1 });
    expect(envelope.diagnostics.map((entry) => entry.code)).toEqual(["submission-invalid-status", "submission-invalid-status", "submission-overdue"]);
    // The same rows in a short-fiction table, marked by any one of its columns, pass.
    for (const header of ["Market", "Type", "Rights Offered"]) {
      writeTracker(root, `| ${header === "Market" ? "Market" : "Name"} | Date Sent | ${header === "Market" ? "Notes" : header} | Status |\n|---|---|---|---|\n| A | 2026-10-01 | x | held |\n| B | 2026-10-01 | x | submitted |\n`);
      expect(json(cwd, ["submissions", root, "--date", TODAY]).envelope.diagnostics).toEqual([]);
    }
  });

  test("strips marks from every column, and skips only the template's placeholder row", () => {
    const { cwd, root } = project();
    writeTracker(root, bookTracker([
      "| *No submissions yet* | | | | | |",
      "| **Ada Byrne** | 2026-10-01 | _query_ | queried | | `fast` |",
      "| _Uncanny_ / _Fireside_ | 2026-10-01 | query | queried | | *Requested* full, see *email* |",
      "| *Emphasised Only* | | | | | |"
    ]));
    const { code, envelope } = json(cwd, ["submissions", root, "--date", TODAY]);
    expect(code).toBe(1);
    expect(envelope.data.rows.map((row) => [row.name, row.materials, row.notes])).toEqual([["Ada Byrne", "query", "fast"], ["_Uncanny_ / _Fireside_", "query", "*Requested* full, see *email*"], ["Emphasised Only", "", ""]]);
    expect(envelope.diagnostics.map((entry) => entry.code)).toEqual(["submission-invalid-status", "submission-invalid-date"]);
  });

  test("an exemption or severity off leaves a row out of the follow-ups, in text, JSON, and next", () => {
    const { cwd, root } = project();
    writeTracker(root, bookTracker(ROWS));
    fs.mkdirSync(path.join(root, "continuity"), { recursive: true });
    fs.writeFileSync(path.join(root, "continuity", "exemptions.md"), "---\ntype: exemption-log\nexemptions:\n  - code: submission-overdue\n    pattern: \"Jane Agent\"\n    reason: \"Nudged by phone.\"\n---\n");
    const text = invoke(cwd, ["submissions", root, "--date", TODAY]);
    expect(text.code).toBe(0);
    expect(text.out).toContain("- Jane Agent (Big Lit): queried, sent 2026-06-01; waiting 166 days\n");
    expect(text.out).toContain("Waiting for a reply: 3; due a follow-up: 0\n");
    expect(text.err).toStartWith("Submissions checked: 0 errors, 0 warnings, 1 dismissed\n");
    const { envelope } = json(cwd, ["submissions", root, "--date", TODAY]);
    expect(envelope.data.overdue).toBe(0);
    expect(envelope.data.rows[0].overdue).toBe(false);
    expect(invoke(cwd, ["next", root, "--date", TODAY]).out).not.toContain("Follow up on submissions");
    // Another row is still due once the window is shorter.
    expect(invoke(cwd, ["next", root, "--date", TODAY, "--days", "60"]).out).toContain("1 submission in submission/tracker.md has waited 60 days or more");
  });

  test("story.md cli-defaults: --days is checked by validate, and --date cannot be a default", () => {
    const { cwd, root } = project();
    writeTracker(root, bookTracker(ROWS));
    const story = path.join(root, "story.md");
    const original = fs.readFileSync(story, "utf8");
    const configure = (entries) => fs.writeFileSync(story, original.replace(/^---\n/, `---\ncli-defaults:\n${entries}`));
    configure("  - command: submissions\n    days: 20\n");
    expect(json(cwd, ["submissions", root, "--date", TODAY]).envelope.data).toMatchObject({ days: 20, overdue: 3 });
    for (const entry of ["  - command: next\n    days: 0\n", "  - command: submissions\n    days: 5000\n"]) {
      configure(entry);
      const validate = invoke(cwd, ["validate", root]);
      expect(validate.code).toBe(1);
      expect(validate.err).toContain("--days must be a whole number 1 to 3650");
    }
    configure("  - command: submissions\n    date: 2026-01-01\n");
    const validate = invoke(cwd, ["validate", root]);
    expect(validate.code).toBe(1);
    expect(validate.err).toContain("story.md cli-defaults[0] sets date, which names one target and cannot be a default");
    expect(invoke(cwd, ["submissions", root]).code).toBe(3);
  });

  test("reads rows without outer pipes, and warns about a date after today", () => {
    const { cwd, root } = project();
    writeTracker(root, bookTracker([
      "| A | 2026-01-01 | q | queried | | |",
      "B | 2026-01-01 | q | queried | | ",
      "| C | 2027-11-01 | q | queried | | |",
      "| D | 2026-01-01 | q | requested-full | 2027-01-01 | |"
    ], "\nSome text.\n| E | 2026-01-01 | q | queried | | |\n"));
    const { code, envelope } = json(cwd, ["submissions", root, "--date", TODAY]);
    expect(code).toBe(0);
    expect(envelope.data.rows.map((row) => row.name)).toEqual(["A", "B", "C", "D"]);
    expect(envelope.data.overdue).toBe(2);
    expect(envelope.diagnostics.filter((entry) => entry.code === "submission-date-in-future").map((entry) => entry.message)).toEqual([
      "submission/tracker.md line 13 (C): Date Sent 2027-11-01 is after today, 2026-11-14: check the year",
      "submission/tracker.md line 14 (D): Response Date 2027-01-01 is after today, 2026-11-14: check the year"
    ]);
  });

  test("a tracker with more than 10,000 rows is refused without reading a row", () => {
    const { cwd, root } = project();
    writeTracker(root, `${BOOK_HEADER}${"|x|2026-01-01|q|queried||\n".repeat(10001)}`);
    const { code, envelope } = json(cwd, ["submissions", root, "--date", TODAY]);
    expect(code).toBe(1);
    expect(envelope.data.rows).toEqual([]);
    expect(envelope.diagnostics).toEqual([expect.objectContaining({ code: "submission-tracker-too-large", message: "submission/tracker.md has more than 10000 tracker rows: split it, or move old rows to another file" })]);
    expect(invoke(cwd, ["next", root, "--date", TODAY]).out).not.toContain("Follow up on submissions");
  });

  test("a folder with no story.md is not a story project", () => {
    const cwd = makeTempDir();
    const root = path.join(cwd, "trackers");
    writeTracker(root, bookTracker(ROWS));
    const result = invoke(cwd, ["submissions", root, "--date", TODAY]);
    expect(result.code).toBe(3);
    expect(result.err).toContain("is not a story project: missing story.md");
  });

  test("a bad --date or --days is a usage error", () => {
    const { cwd, root } = project();
    expect(invoke(cwd, ["submissions", root, "--date", "2026-02-30"]).code).toBe(2);
    for (const days of ["0", "-3", "1.5", "ninety", "3651"]) {
      const result = invoke(cwd, ["submissions", root, "--days", days]);
      expect(result.code).toBe(2);
      expect(result.err).toContain("--days must be a whole number 1 to 3650, such as 90");
    }
    expect(invoke(cwd, ["next", root, "--days", "0"]).code).toBe(2);
  });
});

describe("story next and the submission tracker", () => {
  test("mentions the submissions due a follow-up, with --days and the severity settings", () => {
    const { cwd, root } = project();
    expect(invoke(cwd, ["next", root, "--date", TODAY]).out).not.toContain("Follow up on submissions");
    writeTracker(root, bookTracker(ROWS));
    const text = invoke(cwd, ["next", root, "--date", TODAY]);
    expect(text.code).toBe(0);
    expect(text.out).toContain(`- [P2] Follow up on submissions: 1 submission in submission/tracker.md has waited 90 days or more for a reply: run story submissions ${shellWord(root)} --days 90 --date 2026-11-14 to list it.\n`);
    expect(invoke(cwd, ["next", root, "--date", TODAY, "--days", "20"]).out).toContain(`3 submissions in submission/tracker.md have waited 20 days or more for a reply: run story submissions ${shellWord(root)} --days 20 --date 2026-11-14 to list them.`);
    expect(invoke(cwd, ["next", root, "--date", TODAY, "--days", "200"]).out).not.toContain("Follow up on submissions");

    const story = path.join(root, "story.md");
    fs.writeFileSync(story, fs.readFileSync(story, "utf8").replace(/^---\n/, "---\nseverity:\n  - warning: submission-overdue\n    level: off\n"));
    expect(invoke(cwd, ["next", root, "--date", TODAY]).out).not.toContain("Follow up on submissions");
    expect(invoke(cwd, ["submissions", root, "--date", TODAY]).err).toStartWith("Submissions checked: 0 errors, 0 warnings, 1 dismissed\n");
  });

  test("a tracker that cannot be read does not stop next", () => {
    const { cwd, root } = project();
    writeTracker(root, "---\ntype: [submission-tracker\n---\n");
    const result = invoke(cwd, ["next", root, "--date", TODAY]);
    expect(result.code).toBe(0);
    expect(result.out).not.toContain("Follow up on submissions");
  });
});

describe("tracker cells", () => {
  test("marks around a cell are taken off in linear time", () => {
    const { root } = project();
    const report = expectLinearGrowth(
      (text) => {
        writeTracker(root, text);
        return submissionsReport(root, { today: TODAY, days: 90 });
      },
      (size) => bookTracker([`| ${"*".repeat(size)}Ada${"*".repeat(size)} | 2026-06-01 | query | ${"`".repeat(size)}queried${"`".repeat(size)} | | |`]),
      200000
    );
    expect(report.rows[0]).toMatchObject({ name: "Ada", status: "queried" });
    expect(report.errors).toEqual([]);
  });
});
