import { describe, expect, test } from "bun:test";
import { splitSentences } from "../src/sentences.js";
import { expectLinearTime } from "./helpers.js";

describe("splitSentences", () => {
  test("a run of stops ends a sentence only before a space or the end", () => {
    expect(splitSentences("Wait.....x. Then go!?! Done...")).toEqual(["Wait.....x.", "Then go!?!", "Done..."]);
    expect(splitSentences("He stopped..... She ran.")).toEqual(["He stopped.....", "She ran."]);
  });

  test("a long run of stops with no space after it splits in linear time (#587)", () => {
    expectLinearTime(splitSentences, (n) => `${".".repeat(n)}x`);
    expectLinearTime(splitSentences, (n) => `${"?!…".repeat(n / 3)}x`);
  });
});
