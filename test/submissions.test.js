import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { createStoryProject } from "../src/story.js";
import { SUBMISSION_STATUSES, submissionsReport } from "../src/submissions.js";
import { RESULT_SCHEMA_PATH, validateAgainstSchema } from "../scripts/check-schema.js";
import { makeTempDir, memoryIo, treeDiff, treeSnapshot } from "./helpers.js";

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
      "Today: 2026-11-14; follow up after 90 days without a reply",
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
      "warning: submission/tracker.md line 12 (Jane Agent (Big Lit)): queried, waiting 166 days for a reply since 2026-06-01 (follow up after 90): follow up, or record the reply [submission-overdue]",
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
    // A reply awaited exactly the window is due.
    expect(submissionsReport(root, { today: TODAY, days: 166 }).rows[0].overdue).toBe(true);
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
    expect(result.err).toContain('error: submission/tracker.md line 11 (Bad Status): Status "sent" is not a tracker status; use one of queried, submitted, held, requested-partial, requested-full, offer, declined, no-response, withdrawn\n');
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

  test("never writes, and refuses a symlinked submission folder", () => {
    const { cwd, root } = project();
    writeTracker(root, bookTracker(ROWS));
    const before = treeSnapshot(root);
    invoke(cwd, ["submissions", root, "--date", TODAY]);
    invoke(cwd, ["submissions", root, "--date", TODAY, "--json"]);
    expect(treeDiff(before, treeSnapshot(root))).toEqual(treeDiff(before, before));

    const elsewhere = makeTempDir();
    writeTracker(elsewhere, bookTracker(ROWS));
    fs.rmSync(path.join(root, "submission"), { recursive: true });
    fs.symlinkSync(path.join(elsewhere, "submission"), path.join(root, "submission"), "dir");
    const result = invoke(cwd, ["submissions", root, "--date", TODAY]);
    expect(result.code).toBe(3);
    expect(result.err).toContain("Refusing to use symlinked project directory");
  });

  test("a tracker whose frontmatter does not parse exits 3", () => {
    const { cwd, root } = project();
    writeTracker(root, "---\ntype: [submission-tracker\n---\n\n" + BOOK_HEADER + ROWS[0] + "\n");
    const result = invoke(cwd, ["submissions", root, "--date", TODAY]);
    expect(result.code).toBe(3);
    expect(result.err).toContain("submission/tracker.md cannot be parsed");
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
  });
});

describe("story next and the submission tracker", () => {
  test("mentions the submissions due a follow-up, with --days and the severity settings", () => {
    const { cwd, root } = project();
    expect(invoke(cwd, ["next", root, "--date", TODAY]).out).not.toContain("Follow up on submissions");
    writeTracker(root, bookTracker(ROWS));
    const text = invoke(cwd, ["next", root, "--date", TODAY]);
    expect(text.code).toBe(0);
    expect(text.out).toContain(`- [P2] Follow up on submissions: 1 submission in submission/tracker.md has waited 90 days or more for a reply: run story submissions ${root} to list it.\n`);
    expect(invoke(cwd, ["next", root, "--date", TODAY, "--days", "20"]).out).toContain("3 submissions in submission/tracker.md have waited 20 days or more for a reply: run story submissions");
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
  test("a long run of emphasis marks in a cell reads in linear time", () => {
    const { root } = project();
    const marks = "*".repeat(200000);
    writeTracker(root, bookTracker([`| ${marks}x | 2026-06-01 | query | queried${marks} | | |`]));
    const started = Date.now();
    const report = submissionsReport(root, { today: TODAY, days: 90 });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(report.errors.map((entry) => entry.code)).toEqual(["submission-invalid-status"]);
  });
});
