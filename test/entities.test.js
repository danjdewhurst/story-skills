import { describe, expect, test } from "bun:test";
import { characterReference, decodeCharacterReferences } from "../src/entities.js";
import { expectLinearTime } from "./helpers.js";

describe("character references (#592)", () => {
  test("named, decimal, and hexadecimal references are the characters they name", () => {
    expect(decodeCharacterReferences("&mdash; &nbsp; &#8212; &#x2014; &#X2014; &amp; &AMP; &eacute;")).toBe("—   — — — & & é");
    // The first and last names in the HTML5 list, the longest, and two that
    // name two code points.
    expect(decodeCharacterReferences("&AElig;&zwnj;&CounterClockwiseContourIntegral;&NotEqualTilde;&bne;")).toBe("Æ‌∳≂̸=⃥");
  });

  test("a number that names no character is U+FFFD", () => {
    expect(decodeCharacterReferences("&#0; &#xD800; &#xdfff; &#1114112; &#x110000;")).toBe("� � � � �");
    expect(decodeCharacterReferences("&#1114111; &#x10FFFF;")).toBe("\u{10ffff} \u{10ffff}");
  });

  test("anything else that starts with & stays as written", () => {
    // No `;`, a name HTML lacks, a name in the wrong case, too many digits,
    // or no digits at all.
    const text = "&copy &madeup; &MDASH; &#12345678; &#x1234567; &#; &#x; & ; &;";
    expect(decodeCharacterReferences(text)).toBe(text);
  });

  test("characterReference reads the reference at an offset", () => {
    expect(characterReference("a &mdash; b", 2)).toEqual({ value: "—", length: 7 });
    expect(characterReference("a &#42;", 2)).toEqual({ value: "*", length: 5 });
    expect(characterReference("a &mdash; b", 0)).toBeNull();
    expect(characterReference("&madeup;", 0)).toBeNull();
    expect(characterReference("&mdash", 0)).toBeNull();
  });

  test("a long run of & or digits is read in linear time", () => {
    expectLinearTime(decodeCharacterReferences, (n) => "&".repeat(n));
    expectLinearTime(decodeCharacterReferences, (n) => "&#1".repeat(n / 3));
  });
});
