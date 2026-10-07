import { describe, expect, test } from "bun:test";
import { characterReference } from "../src/entities.js";
import { expectLinearTime } from "./helpers.js";

// The text with each reference read as characterReference reads it.
function decode(text) {
  let result = "";
  for (let index = 0; index < text.length;) {
    const reference = characterReference(text, index);
    result += reference === null ? text[index] : reference.value;
    index += reference === null ? 1 : reference.length;
  }
  return result;
}

describe("character references (#592)", () => {
  test("named, decimal, and hexadecimal references are the characters they name", () => {
    expect(decode("&mdash; &nbsp; &#8212; &#x2014; &#X2014; &amp; &AMP; &eacute; &Tab;&NewLine;")).toBe("\u2014 \u00a0 \u2014 \u2014 \u2014 & & \u00e9 \t\n");
    // The first and last names in the HTML5 list, the longest, and two that
    // name two code points.
    expect(decode("&AElig;&zwnj;&CounterClockwiseContourIntegral;&NotEqualTilde;&bne;")).toBe("\u00c6\u200c\u2233\u2242\u0338=\u20e5");
  });

  test("a number that names no character, or a character a reference never stands for, is U+FFFD", () => {
    expect(decode("&#0; &#xD800; &#xdfff; &#1114112; &#x110000;")).toBe("\ufffd \ufffd \ufffd \ufffd \ufffd");
    expect(decode("&#1114111; &#x10FFFF;")).toBe("\u{10ffff} \u{10ffff}");
    // Control characters other than a tab or line break, which a terminal
    // would act on, and the markers word counts and builds use.
    expect(decode("&#27;]0;title&#7; &#x7F; &#128; &#x9F; &#xE000; &#xE001; &#xE002;")).toBe("\ufffd]0;title\ufffd \ufffd \ufffd \ufffd \ufffd \ufffd \ue002");
    expect(decode("&#9;&#10;&#13;")).toBe("\t\n\r");
  });

  test("anything else that starts with & stays as written", () => {
    // No `;`, a name HTML lacks, a name in the wrong case, too many digits,
    // or no digits at all.
    const text = "&copy &madeup; &MDASH; &#12345678; &#x1234567; &#; &#x; & ; &;";
    expect(decode(text)).toBe(text);
  });

  test("characterReference reads the reference at an offset", () => {
    expect(characterReference("a &mdash; b", 2)).toEqual({ value: "\u2014", length: 7 });
    expect(characterReference("a &#42;", 2)).toEqual({ value: "*", length: 5 });
    expect(characterReference("a &mdash; b", 0)).toBeNull();
    expect(characterReference("&madeup;", 0)).toBeNull();
    expect(characterReference("&mdash", 0)).toBeNull();
  });

  test("a long run of & or digits is read in linear time", () => {
    expectLinearTime(decode, (n) => "&".repeat(n));
    expectLinearTime(decode, (n) => "&#1".repeat(n / 3));
  }, 15000);
});
