import { describe, expect, test } from "bun:test";
import { characterIndex, extractMarkdownLinkTargets, mapOutsideLinks } from "../src/scan.js";
import { expectLinearTime } from "./helpers.js";

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
