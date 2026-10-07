import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { deflateRaw, huffmanLengths } from "../src/deflate.js";
import { NODE_ON_PATH } from "./helpers.js";

const repoRoot = path.resolve(import.meta.dir, "..");
const FALLBACK = path.join(repoRoot, "skills", "story-maintenance", "scripts", "story.js");

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

// Every four bytes are a fixed prefix and then varying letters, so each hash
// chain is long and every match is short: the search's worst case.
function crowdedChains(prefix, count, seed) {
  const letters = seededBytes(count * 2, 26, seed);
  return Buffer.from(Array.from({ length: count }, (_, index) => `${prefix}${String.fromCharCode(65 + letters[2 * index], 65 + letters[2 * index + 1])}`).join(""));
}

function roundTrips(input, options) {
  return inflateRawSync(deflateRaw(input, options)).equals(input);
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

  test("fixed blocks that are not the last, and a dynamic block before a fixed one, inflate", () => {
    const short = Buffer.from("Hello, hello, hello.");
    const smallBlocks = {};
    expect(roundTrips(short, { blockSymbols: 4, stats: smallBlocks })).toBe(true);
    expect(smallBlocks.blocks).toEqual(["fixed", "fixed", "fixed"]);

    // A full block of random literals takes its own codes; the few left over
    // are cheaper with the fixed ones.
    const random = seededBytes(16384 + 40, 256, 21);
    const switched = {};
    expect(roundTrips(random, { stats: switched })).toBe(true);
    expect(switched.blocks).toEqual(["dynamic", "fixed"]);
  });

  test("compresses within a few percent of zlib's best level", () => {
    for (const file of ["docs/cli-reference.md", FALLBACK]) {
      const text = fs.readFileSync(path.resolve(repoRoot, file));
      const stream = deflateRaw(text);
      expect(inflateRawSync(stream).equals(text)).toBe(true);
      expect(stream.length).toBeLessThan(deflateRawSync(text, { level: 9 }).length * 1.03);
    }
    const random = seededBytes(70000, 256, 3);
    const stream = deflateRaw(random);
    expect(inflateRawSync(stream).equals(random)).toBe(true);
    expect(stream.length).toBeLessThan(random.length * 1.01);
  });

  test("its bytes are pinned", () => {
    // Pinned so a change to the encoder, which changes every EPUB and DOCX
    // build, is a deliberate one. The next test checks Node gives the same
    // bytes as Bun.
    const input = Buffer.concat([PROSE, seededBytes(20000, 256, 13), Buffer.alloc(5000)]);
    const stream = deflateRaw(input);
    expect(inflateRawSync(stream).equals(input)).toBe(true);
    expect(crypto.createHash("sha256").update(stream).digest("hex")).toBe("f01078944f1716c231feb5d1907af3cbe8fbd0422f4a1f472ab5002ee5fb7a3a");
  });

  // process.execPath is Bun under `bun test`, so Node is looked up on PATH.
  test.skipIf(!NODE_ON_PATH)("node deflates a multi-block input to the same bytes as bun", () => {
    const stats = {};
    const stream = deflateRaw(fs.readFileSync(FALLBACK), { stats });
    expect(stats.blocks.length).toBeGreaterThan(5);
    const script = [
      `import crypto from "node:crypto";`,
      `import fs from "node:fs";`,
      `import { deflateRaw } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, "src", "deflate.js")).href)};`,
      `process.stdout.write(crypto.createHash("sha256").update(deflateRaw(fs.readFileSync(process.argv[1]))).digest("hex"));`
    ].join("\n");
    const result = spawnSync("node", ["--input-type=module", "-e", script, FALLBACK], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(crypto.createHash("sha256").update(stream).digest("hex"));
  });

  test("crafted input that crowds the hash chains costs linear work", () => {
    // Each byte adds 16 tries to the search budget, on top of one chain of
    // 256. Both inputs use it all; without it they take about 60 a byte.
    for (const [prefix, seed] of [["xy", 9], ["ABC", 17]]) {
      const input = crowdedChains(prefix, 1 << 18, seed);
      const stats = {};
      expect(roundTrips(input, { stats })).toBe(true);
      expect(stats.tries).toBeLessThanOrEqual(16 * input.length + 256);
      expect(stats.tries).toBeGreaterThan(15 * input.length);
    }
  });

  test("Huffman code lengths stay within the limit and form a complete code", () => {
    // Fibonacci weights give the deepest possible tree: 24 levels for 25
    // symbols, and 18 for 19.
    const literals = [...fibonacci(25), ...new Array(261).fill(0)];
    expect(Math.max(...huffmanLengths(literals, 30))).toBe(24);
    const codeLengths = huffmanLengths(fibonacci(19), 30);
    expect(Math.max(...codeLengths)).toBe(18);
    for (const [weights, limit] of [[literals, 15], [fibonacci(19), 7], [literals, 9], [fibonacci(19), 5]]) {
      const lengths = huffmanLengths(weights, limit);
      expect(Math.max(...lengths)).toBeLessThanOrEqual(limit);
      expect(kraft(lengths)).toBe(2 ** 15);
      // Flattening never drops a symbol in use.
      expect(weights.map((weight, symbol) => weight > 0 && lengths[symbol] === 0).filter(Boolean)).toEqual([]);
    }
  });

  test("streams whose Huffman codes had to be flattened still inflate", () => {
    // Real text rarely needs codes longer than 15 bits or code length codes
    // longer than 7, so the limits are lowered until this text does.
    const text = fs.readFileSync(path.join(repoRoot, "docs", "cli-reference.md"));
    const plain = deflateRaw(text);
    for (const options of [{ codeBits: 9 }, { codeBits: 12 }, { codeLengthBits: 5 }]) {
      const flattened = deflateRaw(text, options);
      expect(flattened.equals(plain)).toBe(false);
      expect(inflateRawSync(flattened).equals(text)).toBe(true);
    }
  });

  test("a code with fewer than two symbols in use gets two one-bit codes", () => {
    expect(huffmanLengths([0, 0, 0, 0], 15)).toEqual([1, 1, 0, 0]);
    expect(huffmanLengths([0, 0, 5, 0], 15)).toEqual([1, 0, 1, 0]);
  });
});
