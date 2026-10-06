import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { RESULT_SCHEMA_PATH, checkProjectSchema, validateAgainstSchema } from "../scripts/check-schema.js";
import { runCli } from "../src/cli.js";
import { formatNextRelease, releaseSchedule } from "../src/release-schedule.js";
import { projectActions } from "../src/report.js";
import { createStoryProject, projectProgress, validateProject } from "../src/story.js";
import { makeTempDir, memoryIo, messages, writeMarkdown } from "./helpers.js";

function serialProject(storyFields = "release-every: 7\nrelease-start: 2026-09-04") {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Serial Story", force: false });
  const storyPath = path.join(root, "story.md");
  fs.writeFileSync(storyPath, fs.readFileSync(storyPath, "utf8").replace("tense: past\n", `tense: past\nform: serial\n${storyFields}\n`), "utf8");
  writeChapter(root, 1, 100, "");
  writeChapter(root, 2, 100, "");
  writeChapter(root, 3, 0, "");
  return { root, cwd };
}

function writeChapter(root, number, words, extra) {
  writeMarkdown(path.join(root, "chapters", `chapter-0${number}.md`), `title: Chapter ${number}\nnumber: ${number}\nstatus: draft\n${extra}`, `## Chapter Text\n\n${"word ".repeat(words)}\n`);
}

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

const resultSchema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, "utf8"));

const episode = (id, releaseDate, drafted) => ({ id, file: `chapters/${id}.md`, releaseDate: releaseDate === "" ? undefined : releaseDate, drafted });

describe("releaseSchedule", () => {
  const data = { "release-every": 7, "release-start": "2026-09-04" };
  const chapters = [episode("chapter-01", "", true), episode("chapter-02", "", true), episode("chapter-03", "", false)];

  test("is null without a cadence or any release-date", () => {
    expect(releaseSchedule({ data: {}, chapters, today: "2026-09-01" })).toBeNull();
    // Half a cadence schedules nothing; validate reports it.
    expect(releaseSchedule({ data: { "release-every": 7 }, chapters, today: "2026-09-01" })).toBeNull();
    expect(formatNextRelease(null)).toBeNull();
  });

  test("schedules each chapter from the cadence and finds the next release", () => {
    const release = releaseSchedule({ data, chapters, today: "2026-09-05" });
    expect(release.every).toBe(7);
    expect(release.start).toBe("2026-09-04");
    expect(release.episodes.map((entry) => [entry.episode, entry.chapter, entry.date])).toEqual([[1, "chapter-01", "2026-09-04"], [2, "chapter-02", "2026-09-11"], [3, "chapter-03", "2026-09-18"]]);
    expect(release.next).toEqual({ episode: 2, chapter: "chapter-02", file: "chapters/chapter-02.md", date: "2026-09-11", drafted: true, daysUntil: 6 });
    expect(release.warnings).toEqual([]);
    expect(formatNextRelease(release)).toBe("Next release: episode 2 (chapter-02) on 2026-09-11, in 6 days (drafted)");
  });

  test("warns when an undrafted episode is due within 3 days or past, and not before", () => {
    expect(releaseSchedule({ data, chapters, today: "2026-09-14" }).warnings).toEqual([]);
    const soon = releaseSchedule({ data, chapters, today: "2026-09-15" });
    expect(soon.warnings).toEqual([{ code: "release-undrafted", message: "chapters/chapter-03.md (episode 3) releases 2026-09-18, in 3 days, and has no prose yet", file: "chapters/chapter-03.md", chapter: null }]);
    expect(formatNextRelease(soon)).toBe("Next release: episode 3 (chapter-03) on 2026-09-18, in 3 days (not drafted)");
    expect(messages(releaseSchedule({ data, chapters, today: "2026-09-18" }).warnings)).toEqual(["chapters/chapter-03.md (episode 3) releases today (2026-09-18) and has no prose yet"]);
    expect(formatNextRelease(releaseSchedule({ data, chapters, today: "2026-09-18" }))).toBe("Next release: episode 3 (chapter-03) on 2026-09-18, today (not drafted)");
  });

  test("projects the episodes past the last chapter, and warns once about those due", () => {
    const release = releaseSchedule({ data, chapters, today: "2026-09-19" });
    expect(release.next).toMatchObject({ episode: 4, chapter: null, file: null, date: "2026-09-25", daysUntil: 6 });
    expect(formatNextRelease(release)).toBe("Next release: episode 4 on 2026-09-25, in 6 days (no chapter yet)");
    expect(messages(release.warnings)).toEqual(["chapters/chapter-03.md (episode 3) was due 2026-09-18, 1 day ago, and has no prose yet"]);

    const late = releaseSchedule({ data, chapters, today: "2026-10-06" });
    expect(late.next).toMatchObject({ episode: 6, date: "2026-10-09", daysUntil: 3 });
    expect(late.warnings.map((warning) => [warning.file, warning.message])).toEqual([
      ["chapters/chapter-03.md", "chapters/chapter-03.md (episode 3) was due 2026-09-18, 18 days ago, and has no prose yet"],
      ["story.md", "episode 4 was due 2026-09-25, 11 days ago, and has no chapter yet (and 2 more scheduled episodes after it)"]
    ]);
    expect(messages(releaseSchedule({ data, chapters: chapters.slice(0, 2), today: "2026-09-18" }).warnings)).toEqual(["episode 3 releases today (2026-09-18) and has no chapter yet"]);
  });

  test("a chapter release-date moves that episode only, and works without a cadence", () => {
    const moved = [episode("chapter-01", "", true), episode("chapter-02", "2026-09-14", true), episode("chapter-03", "", false)];
    const release = releaseSchedule({ data, chapters: moved, today: "2026-09-12" });
    expect(release.episodes.map((entry) => entry.date)).toEqual(["2026-09-04", "2026-09-14", "2026-09-18"]);
    expect(release.next).toMatchObject({ episode: 2, date: "2026-09-14" });

    const explicit = [episode("chapter-01", "2026-09-04", true), episode("chapter-02", "", true), episode("chapter-03", "2026-09-20", false)];
    const own = releaseSchedule({ data: {}, chapters: explicit, today: "2026-09-10" });
    expect(own).toMatchObject({ every: null, start: null, next: { episode: 3, date: "2026-09-20", daysUntil: 10 }, warnings: [] });
    expect(own.episodes.map((entry) => entry.chapter)).toEqual(["chapter-01", "chapter-03"]);
    const after = releaseSchedule({ data: {}, chapters: explicit, today: "2026-09-21" });
    expect(after.next).toBeNull();
    expect(formatNextRelease(after)).toBe("Next release: none scheduled after today");
    expect(messages(after.warnings)).toEqual(["chapters/chapter-03.md (episode 3) was due 2026-09-20, 1 day ago, and has no prose yet"]);
  });

  test("an invalid release-date leaves its episode out instead of putting it back on the cadence", () => {
    const invalid = [episode("chapter-01", "", true), episode("chapter-02", "2026-02-30", false), episode("chapter-03", 20260918, false)];
    expect(releaseSchedule({ data, chapters: invalid, today: "2026-09-12" }).episodes.map((entry) => entry.chapter)).toEqual(["chapter-01"]);
    expect(releaseSchedule({ data: {}, chapters: invalid.slice(1), today: "2026-09-12" })).toBeNull();
  });

  test("a cadence past 9999-12-31 schedules nothing more, and never crashes", () => {
    const huge = releaseSchedule({ data: { "release-every": 100000000, "release-start": "2026-09-04" }, chapters, today: "2026-09-05" });
    expect(huge.episodes.map((entry) => entry.date)).toEqual(["2026-09-04"]);
    expect(huge.next).toBeNull();
    const late = releaseSchedule({ data: { "release-every": 7, "release-start": "9999-12-20" }, chapters, today: "9999-12-21" });
    expect(late.episodes.map((entry) => entry.date)).toEqual(["9999-12-20", "9999-12-27"]);
    expect(late.next).toMatchObject({ episode: 2, date: "9999-12-27" });
    expect(releaseSchedule({ data: { "release-every": 7, "release-start": "9999-12-20" }, chapters, today: "9999-12-28" }).next).toBeNull();
  });

  test("before release-start the first episode is next", () => {
    expect(releaseSchedule({ data, chapters, today: "2026-08-01" }).next).toMatchObject({ episode: 1, daysUntil: 34 });
    expect(releaseSchedule({ data, chapters: [], today: "2026-08-01" }).next).toMatchObject({ episode: 1, chapter: null, date: "2026-09-04" });
  });
});

describe("release schedule in the project", () => {
  test("validate checks the fields, and accepts Gregorian release dates in a calendar book", () => {
    const { root } = serialProject();
    writeChapter(root, 2, 100, "release-date: 2026-09-12");
    expect(messages(validateProject(root).errors)).toEqual([]);
    expect(checkProjectSchema(root)).toEqual([]);

    const half = serialProject("release-every: 7");
    expect(messages(validateProject(half.root).errors)).toContain("story.md release-every needs release-start too: an episode every release-every days from release-start");
    expect(checkProjectSchema(half.root).join("\n")).toContain("release-start");
    const other = serialProject("release-start: 2026-09-04");
    expect(messages(validateProject(other.root).errors)).toContain("story.md release-start needs release-every too: an episode every release-every days from release-start");
    expect(checkProjectSchema(other.root).join("\n")).toContain("release-every");

    const bad = serialProject("release-every: 0\nrelease-start: 2026-02-30");
    writeChapter(bad.root, 1, 100, "release-date: 4 Thaw 302 AE");
    const errors = validateProject(bad.root).errors;
    expect(messages(errors)).toContain("story.md frontmatter field release-every must be at least 1");
    expect(messages(errors)).toContain("story.md release-start date must be a real YYYY-MM-DD calendar day, got 2026-02-30");
    expect(errors.find((error) => error.message.includes("release-date"))).toMatchObject({ code: "invalid-date", message: "chapters/chapter-01.md release-date date must be a real YYYY-MM-DD calendar day, got 4 Thaw 302 AE" });
    // progress reports the bad fields too, and schedules nothing from them.
    const progress = projectProgress(bad.root, { date: "2026-09-05" });
    expect(progress.ok).toBe(false);
    expect(messages(progress.errors)).toContain("chapters/chapter-01.md release-date date must be a real YYYY-MM-DD calendar day, got 4 Thaw 302 AE");
    expect(progress.release).toBeNull();

    const calendar = serialProject("release-every: 7\nrelease-start: 2026-09-04\ncalendar:\n  - month: Thaw\n    days: 30\n  - era: Age of Embers\n    abbrev: AE");
    writeChapter(calendar.root, 1, 100, "date: 3 Thaw 302 AE\nrelease-date: 2026-09-05");
    expect(messages(validateProject(calendar.root).errors)).toEqual([]);
    expect(projectProgress(calendar.root, { date: "2026-09-01" }).release.next).toMatchObject({ episode: 1, date: "2026-09-05" });
  });

  test("progress prints the next release and warns, in text and JSON", () => {
    const { root, cwd } = serialProject();
    const text = invoke(cwd, ["progress", root, "--date", "2026-09-16"]);
    expect(text.code).toBe(0);
    expect(text.out).toContain("Next release: episode 3 (chapter-03) on 2026-09-18, in 2 days (not drafted)\n");
    expect(text.err).toContain("warning: chapters/chapter-03.md (episode 3) releases 2026-09-18, in 2 days, and has no prose yet [release-undrafted]");

    const json = JSON.parse(invoke(cwd, ["progress", root, "--date", "2026-09-16", "--json"]).out);
    expect(validateAgainstSchema(json, resultSchema)).toEqual([]);
    expect(json.data.release).toMatchObject({ every: 7, start: "2026-09-04", next: { episode: 3, chapter: "chapter-03", daysUntil: 2, drafted: false } });
    expect(json.data.release.warnings).toBeUndefined();
    expect(json.diagnostics).toEqual([expect.objectContaining({ severity: "warning", code: "release-undrafted", file: "chapters/chapter-03.md", check: "progress" })]);

    // Without a schedule the line and the JSON field stay out of the way.
    const plain = makeTempDir();
    const { root: plainRoot } = createStoryProject({ cwd: plain, title: "Plain Story", force: false });
    expect(invoke(plain, ["progress", plainRoot]).out).not.toContain("Next release");
    expect(projectProgress(plainRoot, {}).release).toBeNull();
  });

  test("story.md severity can turn the warning off or into an error", () => {
    const off = serialProject("release-every: 7\nrelease-start: 2026-09-04\nseverity:\n  - warning: release-undrafted\n    level: off");
    const result = invoke(off.cwd, ["progress", off.root, "--date", "2026-09-16"]);
    expect(result.code).toBe(0);
    expect(result.err).toContain("dismissed: chapters/chapter-03.md (episode 3)");
    expect(invoke(off.cwd, ["next", off.root, "--date", "2026-09-16"]).out).not.toContain("Draft the scheduled episode");

    const error = serialProject("release-every: 7\nrelease-start: 2026-09-04\nseverity:\n  - warning: release-undrafted\n    level: error");
    expect(invoke(error.cwd, ["progress", error.root, "--date", "2026-09-16"]).code).toBe(1);
  });

  test("next shows the next release and a P1 action, with --date and --json", () => {
    const { root, cwd } = serialProject();
    const text = invoke(cwd, ["next", root, "--date", "2026-09-19"]);
    expect(text.code).toBe(0);
    expect(text.out).toContain("Next release: episode 4 on 2026-09-25, in 6 days (no chapter yet)\n\nActions:\n");
    expect(text.out).toContain(`- [P1] Draft the scheduled episode: chapters/chapter-03.md (episode 3) was due 2026-09-18, 1 day ago, and has no prose yet: draft it under ## Chapter Text, then run story wordcount `);

    const json = JSON.parse(invoke(cwd, ["next", root, "--date", "2026-09-19", "--json"]).out);
    expect(validateAgainstSchema(json, resultSchema)).toEqual([]);
    expect(json.ok).toBe(true);
    expect(json.data.release.next).toMatchObject({ episode: 4, chapter: null });
    expect(json.data.releaseFindings).toBeUndefined();
    expect(json.diagnostics.filter((entry) => entry.code === "release-undrafted")).toEqual([expect.objectContaining({ severity: "warning", check: "next" })]);

    expect(projectActions(root, { date: "2026-09-05" }).actions.some((entry) => entry.title === "Draft the scheduled episode")).toBe(false);
    const bad = invoke(cwd, ["next", root, "--date", "2026-02-30"]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain("next --date date must be a real YYYY-MM-DD calendar day, got 2026-02-30");
  });

  test("doctor leaves the schedule to next", () => {
    const { root, cwd } = serialProject();
    const doctor = invoke(cwd, ["doctor", root]);
    expect(doctor.out).not.toContain("Draft the scheduled episode");
    const json = JSON.parse(invoke(cwd, ["doctor", root, "--json"]).out);
    expect(json.data.release).toBeUndefined();
    expect(json.data.releaseFindings).toBeUndefined();
    expect(json.diagnostics.some((entry) => entry.code === "release-undrafted")).toBe(false);
  });

  test("next --date cannot be a cli-defaults entry", () => {
    const { root } = serialProject("release-every: 7\nrelease-start: 2026-09-04\ncli-defaults:\n  - command: next\n    date: 2026-08-01");
    expect(messages(validateProject(root).errors).join("\n")).toContain("sets date, which names one target and cannot be a default");
  });
});
