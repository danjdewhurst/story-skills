import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { deflateRaw, huffmanLengths } from "../src/deflate.js";

const repoRoot = path.resolve(import.meta.dir, "..");

// xorshift32, so every run tests the same bytes.
function seededBytes(size, range, seed = 1) {
  let state = seed;
  const bytes = Buffer.alloc(size);
  for (let index = 0; index < size; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = (state >>> 0) % range;
  }
  return bytes;
}

const PROSE = Buffer.from(
  Array.from({ length: 400 }, (_, index) => `<p id="p${index}">The lamps came on along the harbor wall, and Mara counted ${index} boats — «déjà vu», she said.</p>\n`).join(""),
  "utf8"
);

function roundTrips(input) {
  return inflateRawSync(deflateRaw(input)).equals(input);
}

// Kraft's sum for a set of code lengths, scaled so a complete code sums to
// 2^15: deflate needs every code complete (no unused bit patterns), except
// a code that is not used at all.
function kraft(lengths) {
  return lengths.reduce((sum, length) => sum + (length === 0 ? 0 : 2 ** (15 - length)), 0);
}

function fibonacci(count) {
  const values = [1, 1];
  while (values.length < count) {
    values.push(values[values.length - 1] + values[values.length - 2]);
  }
  return values.slice(0, count);
}

describe("deflate (#589)", () => {
  test("zlib inflates every stream back to its input", () => {
    const unit = seededBytes(30000, 256, 7);
    const cases = {
      empty: Buffer.alloc(0),
      oneByte: Buffer.from("a"),
      twoBytes: Buffer.from("ab"),
      short: Buffer.from("Hello, hello, hello."),
      prose: PROSE,
      // Runs longer than the longest match.
      zeros: Buffer.alloc(100000),
      // Incompressible, and longer than the window.
      random: seededBytes(70000, 256, 3),
      // Many short matches.
      fourLetters: seededBytes(50000, 4, 5),
      // Matches near the far end of the window.
      repeatedUnit: Buffer.concat([unit, unit, unit]),
      windowApart: Buffer.concat([seededBytes(32768, 256, 11), seededBytes(32768, 256, 11)]),
      // Three-byte matches, near and far.
      shortRepeats: Buffer.from(Array.from(seededBytes(40000, 26, 9), (letter) => `xyz${String.fromCharCode(97 + letter)}`).join(""))
    };
    for (const [name, input] of Object.entries(cases)) {
      expect({ name, ok: roundTrips(input) }).toEqual({ name, ok: true });
    }
  });

  test("an empty input is one fixed block holding only the end-of-block code", () => {
    expect([...deflateRaw(Buffer.alloc(0))]).toEqual([0x03, 0x00]);
  });

  test("a short input takes the fixed codes and a long one its own codes", () => {
    // The first bit is BFINAL, then two bits of BTYPE: 1 fixed, 2 dynamic.
    const blockType = (stream) => (stream[0] >> 1) & 0b11;
    expect(blockType(deflateRaw(Buffer.from("Hello, hello, hello.")))).toBe(1);
    expect(blockType(deflateRaw(PROSE))).toBe(2);
  });

  test("compresses within a few percent of zlib's best level", () => {
    for (const file of ["docs/cli-reference.md", "skills/story-maintenance/scripts/story.js"]) {
      const text = fs.readFileSync(path.join(repoRoot, file));
      expect(deflateRaw(text).length).toBeLessThan(deflateRawSync(text, { level: 9 }).length * 1.03);
    }
    const random = seededBytes(70000, 256, 3);
    expect(deflateRaw(random).length).toBeLessThan(random.length * 1.01);
  });

  test("its bytes are pinned", () => {
    // Pinned so a change to the encoder, which changes every EPUB and DOCX
    // build, is a deliberate one. The cross-runtime build test in
    // zip-writer.test.js checks Node gives these bytes too.
    const input = Buffer.concat([PROSE, seededBytes(20000, 256, 13), Buffer.alloc(5000)]);
    const digest = crypto.createHash("sha256").update(deflateRaw(input)).digest("hex");
    expect(digest).toBe("f01078944f1716c231feb5d1907af3cbe8fbd0422f4a1f472ab5002ee5fb7a3a");
  });

  test("Huffman code lengths stay within the limit and form a complete code", () => {
    // Fibonacci weights give the deepest possible tree: 24 levels for 25
    // symbols, and 18 for 19.
    const literals = [...fibonacci(25), ...new Array(261).fill(0)];
    expect(Math.max(...huffmanLengths(literals, 30))).toBe(24);
    const literalLengths = huffmanLengths(literals, 15);
    expect(Math.max(...literalLengths)).toBeLessThanOrEqual(15);
    expect(kraft(literalLengths)).toBe(2 ** 15);

    expect(Math.max(...huffmanLengths(fibonacci(19), 30))).toBe(18);
    const codeLengths = huffmanLengths(fibonacci(19), 7);
    expect(Math.max(...codeLengths)).toBeLessThanOrEqual(7);
    expect(kraft(codeLengths)).toBe(2 ** 15);
  });

  test("a code with fewer than two symbols in use gets two one-bit codes", () => {
    expect(huffmanLengths([0, 0, 0, 0], 15)).toEqual([1, 1, 0, 0]);
    expect(huffmanLengths([0, 0, 5, 0], 15)).toEqual([1, 0, 1, 0]);
  });
});
