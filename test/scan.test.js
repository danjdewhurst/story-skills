import { describe, expect, test } from "bun:test";
import { characterIndex, extractMarkdownLinkTargets, mapOutsideLinks } from "../src/scan.js";
import { expectComparableTime, expectLinearTime } from "./helpers.js";

const upper = (text) => mapOutsideLinks(text, (part) => part.toUpperCase());
const row = (name) => characterIndex("s", [{ id: "a", name, role: "lead", status: "alive" }], new Map(), []).split("\n").find((line) => line.includes("[a]"));

describe("link and URL scans", () => {
  test("text outside link destinations and URLs is mapped, in linear time", () => {
    expect(upper("See [a](chapter-01.md) and https://x.test/chapter-02 or <mailto:chapter-03@x> chapter-04.")).toBe("SEE [A](chapter-01.md) AND https://x.test/chapter-02 OR <mailto:chapter-03@x> CHAPTER-04.");
    // Each of these fails fast, so the text is longer.
    expectLinearTime(upper, (n) => "a.".repeat(n / 2), { length: 64000 });
    expectLinearTime(upper, (n) => "](".repeat(n / 2), { length: 64000 });
    expectLinearTime(upper, (n) => "<a:".repeat(n / 3), { length: 64000 });
  });

  test("a link, autolink, or URL of any length is kept whole, and unclosed ones cost little (#587)", () => {
    const path = "x/".repeat(520);
    expect(upper(`[map](${path}chapter-01.md) chapter-02`)).toBe(`[MAP](${path}chapter-01.md) CHAPTER-02`);
    expect(upper(`<mailto:${path}chapter-01@x.test> chapter-02`)).toBe(`<mailto:${path}chapter-01@x.test> CHAPTER-02`);
    const scheme = `${"a".repeat(70)}+x`;
    expect(upper(`${scheme}://x.test/chapter-01 chapter-02`)).toBe(`${scheme}://x.test/chapter-01 CHAPTER-02`);
    // Each unclosed `](` or `<a:` once read up to a thousand characters
    // ahead.
    expectComparableTime(upper, "](".repeat(128000), "]x".repeat(128000));
    expectComparableTime(upper, "<a:".repeat(128000), "<a;".repeat(128000));
  });

  test("link targets are found in linear time", () => {
    expect(extractMarkdownLinkTargets("[a](one.md) [b](<two words.md>) [c](three.md \"Title\") []() [d](four.md#x) ](five.md")).toEqual(["one.md", "two words.md", "three.md", "four.md"]);
    expectLinearTime(extractMarkdownLinkTargets, (n) => "](".repeat(n / 2));
    expectLinearTime(extractMarkdownLinkTargets, (n) => `[a](a${" ".repeat(n)}b)`);
  });
});

describe("registry cells", () => {
  test("flatten newlines and escape pipes in linear time", () => {
    expect(row("Ann \\| Bo  \n  Cy")).toBe("| Ann \\\\\\| Bo Cy | lead | alive | [a](a.md) |");
    expectLinearTime(row, (n) => `a${" ".repeat(n)}b`);
    expectLinearTime(row, (n) => `a${"\\".repeat(n)}b`);
  });
});
