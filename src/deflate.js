// A small raw deflate (RFC 1951) encoder for the ZIP writer. node:zlib is
// not used because its output depends on the runtime: Bun and Node link
// different zlib builds, so the same entry deflated to different bytes under
// `bun`, `node`, and the bundled fallback. Every step here is plain
// JavaScript with fixed tables and fixed tie-breaks, so an archive is
// byte-identical wherever it is built.
//
// It is the usual design, kept short: LZ77 matching over a 32 KiB window
// with hash chains and one step of lazy matching, then Huffman coding in
// blocks of up to BLOCK_SYMBOLS symbols, each sent with the fixed codes or
// its own dynamic codes, whichever is smaller.
import { Buffer } from "node:buffer";

const WINDOW_SIZE = 32768;
const WINDOW_MASK = WINDOW_SIZE - 1;
const MIN_MATCH = 3;
const MAX_MATCH = 258;
// How many earlier positions with the same hash each match search tries.
const MAX_CHAIN = 256;
// A three-byte match further back than this costs more bits than the three
// literals it replaces.
const FAR_MATCH = 4096;
const HASH_BITS = 15;
const HASH_MASK = (1 << HASH_BITS) - 1;
const BLOCK_SYMBOLS = 16384;
const END_OF_BLOCK = 256;
const MAX_CODE_BITS = 15;
const MAX_CODE_LENGTH_BITS = 7;

// RFC 1951 section 3.2.5: the first length and distance of each code, and
// the extra bits that follow it.
const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
// Section 3.2.7: the order code length code lengths are sent in, and the
// extra bits of the three repeat codes.
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
const CODE_LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7];

// Index into the base tables for every length (3-258) and distance (1-32768).
function codeTable(bases, size) {
  const table = new Uint8Array(size);
  let code = 0;
  for (let value = bases[0]; value < size; value += 1) {
    if (code + 1 < bases.length && bases[code + 1] <= value) {
      code += 1;
    }
    table[value] = code;
  }
  return table;
}

const LENGTH_CODE = codeTable(LENGTH_BASE, MAX_MATCH + 1);
const DISTANCE_CODE = codeTable(DISTANCE_BASE, WINDOW_SIZE + 1);

// Section 3.2.6: the fixed literal/length and distance codes.
const FIXED_LITERAL_LENGTHS = Array.from({ length: 288 }, (_, symbol) => (symbol < 144 ? 8 : symbol < 256 ? 9 : symbol < 280 ? 7 : 8));
const FIXED_DISTANCE_LENGTHS = new Array(30).fill(5);
const FIXED_LITERAL_CODES = canonicalCodes(FIXED_LITERAL_LENGTHS);
const FIXED_DISTANCE_CODES = canonicalCodes(FIXED_DISTANCE_LENGTHS);

// Compresses a Buffer or Uint8Array to a raw deflate stream (no zlib header
// or checksum), as a ZIP entry holds it.
export function deflateRaw(data) {
  const length = data.length;
  const writer = bitWriter(length);
  const head = new Int32Array(HASH_MASK + 1).fill(-1);
  const prev = new Int32Array(WINDOW_SIZE);
  // Each symbol of the current block: a literal byte (distance 0) or a match
  // length and distance.
  const block = {
    values: new Uint16Array(BLOCK_SYMBOLS),
    distances: new Uint16Array(BLOCK_SYMBOLS),
    count: 0,
    literals: new Array(286).fill(0),
    distanceCodes: new Array(30).fill(0)
  };
  let foundDistance = 0;

  const hashAt = (position) => ((data[position] << 10) ^ (data[position + 1] << 5) ^ data[position + 2]) & HASH_MASK;

  const insert = (position) => {
    if (position + MIN_MATCH <= length) {
      const hash = hashAt(position);
      prev[position & WINDOW_MASK] = head[hash];
      head[hash] = position;
    }
  };

  // The longest earlier match for the bytes at position, among the positions
  // inserted so far; sets foundDistance. Every candidate is within the
  // window, so its prev entry has not been overwritten yet.
  const longestMatch = (position) => {
    if (position + MIN_MATCH > length) {
      return 0;
    }
    const limit = Math.min(MAX_MATCH, length - position);
    let best = 0;
    let candidate = head[hashAt(position)];
    for (let chain = MAX_CHAIN; candidate >= 0 && position - candidate <= WINDOW_SIZE && chain > 0; chain -= 1) {
      if (data[candidate + best] === data[position + best]) {
        let run = 0;
        while (run < limit && data[candidate + run] === data[position + run]) {
          run += 1;
        }
        if (run > best) {
          best = run;
          foundDistance = position - candidate;
          if (best === limit) {
            break;
          }
        }
      }
      candidate = prev[candidate & WINDOW_MASK];
    }
    return best < MIN_MATCH || (best === MIN_MATCH && foundDistance > FAR_MATCH) ? 0 : best;
  };

  const emit = (value, distance, symbol) => {
    if (block.count === BLOCK_SYMBOLS) {
      writeBlock(writer, block, false);
    }
    block.values[block.count] = value;
    block.distances[block.count] = distance;
    block.count += 1;
    block.literals[symbol] += 1;
    if (distance > 0) {
      block.distanceCodes[DISTANCE_CODE[distance]] += 1;
    }
  };
  const emitLiteral = (byte) => emit(byte, 0, byte);
  const emitMatch = (matchLength, distance) => emit(matchLength, distance, 257 + LENGTH_CODE[matchLength]);

  // One step of lazy matching: a match is put off by a byte when the next
  // position has a longer one. A match of the greatest length is taken
  // straight away.
  let position = 0;
  let matchLength = longestMatch(0);
  let matchDistance = foundDistance;
  while (position < length) {
    insert(position);
    if (matchLength > 0 && matchLength < MAX_MATCH) {
      const nextLength = longestMatch(position + 1);
      if (nextLength > matchLength) {
        emitLiteral(data[position]);
        position += 1;
        matchLength = nextLength;
        matchDistance = foundDistance;
        continue;
      }
    }
    if (matchLength > 0) {
      emitMatch(matchLength, matchDistance);
      for (let step = 1; step < matchLength; step += 1) {
        insert(position + step);
      }
      position += matchLength;
    } else {
      emitLiteral(data[position]);
      position += 1;
    }
    matchLength = longestMatch(position);
    matchDistance = foundDistance;
  }
  writeBlock(writer, block, true);
  return writer.finish();
}

// Bits go out least significant first, as deflate packs them. Text shrinks
// to well under half, so the buffer starts there and doubles when an entry
// compresses less.
function bitWriter(size) {
  let bytes = new Uint8Array(Math.max(64, size >> 1));
  let used = 0;
  let pending = 0;
  let pendingBits = 0;
  const push = (byte) => {
    if (used === bytes.length) {
      const grown = new Uint8Array(bytes.length * 2);
      grown.set(bytes);
      bytes = grown;
    }
    bytes[used] = byte;
    used += 1;
  };
  return {
    write(value, bits) {
      pending |= value << pendingBits;
      pendingBits += bits;
      while (pendingBits >= 8) {
        push(pending & 0xff);
        pending >>>= 8;
        pendingBits -= 8;
      }
    },
    finish() {
      if (pendingBits > 0) {
        push(pending);
      }
      return Buffer.from(bytes.buffer, 0, used);
    }
  };
}

function writeBlock(writer, block, final) {
  block.literals[END_OF_BLOCK] = 1;
  const literalLengths = huffmanLengths(block.literals, MAX_CODE_BITS);
  const distanceLengths = huffmanLengths(block.distanceCodes, MAX_CODE_BITS);
  const header = dynamicHeader(literalLengths, distanceLengths);
  // Extra bits cost the same under either code, so they are left out.
  const dynamicBits = header.bits + codedBits(block.literals, literalLengths) + codedBits(block.distanceCodes, distanceLengths);
  const fixedBits = codedBits(block.literals, FIXED_LITERAL_LENGTHS) + codedBits(block.distanceCodes, FIXED_DISTANCE_LENGTHS);
  writer.write(final ? 1 : 0, 1);
  if (fixedBits <= dynamicBits) {
    writer.write(1, 2);
    writeSymbols(writer, block, FIXED_LITERAL_CODES, FIXED_LITERAL_LENGTHS, FIXED_DISTANCE_CODES, FIXED_DISTANCE_LENGTHS);
  } else {
    writer.write(2, 2);
    header.write(writer);
    writeSymbols(writer, block, canonicalCodes(literalLengths), literalLengths, canonicalCodes(distanceLengths), distanceLengths);
  }
  block.count = 0;
  block.literals.fill(0);
  block.distanceCodes.fill(0);
}

function writeSymbols(writer, block, literalCodes, literalLengths, distanceCodes, distanceLengths) {
  for (let index = 0; index < block.count; index += 1) {
    const value = block.values[index];
    const distance = block.distances[index];
    if (distance === 0) {
      writer.write(literalCodes[value], literalLengths[value]);
      continue;
    }
    const lengthCode = LENGTH_CODE[value];
    writer.write(literalCodes[257 + lengthCode], literalLengths[257 + lengthCode]);
    writer.write(value - LENGTH_BASE[lengthCode], LENGTH_EXTRA[lengthCode]);
    const distanceCode = DISTANCE_CODE[distance];
    writer.write(distanceCodes[distanceCode], distanceLengths[distanceCode]);
    writer.write(distance - DISTANCE_BASE[distanceCode], DISTANCE_EXTRA[distanceCode]);
  }
  writer.write(literalCodes[END_OF_BLOCK], literalLengths[END_OF_BLOCK]);
}

function codedBits(frequencies, lengths) {
  let bits = 0;
  for (let symbol = 0; symbol < frequencies.length; symbol += 1) {
    bits += frequencies[symbol] * lengths[symbol];
  }
  return bits;
}

// Section 3.2.7: a dynamic block opens with its code lengths, run-length
// coded and then Huffman coded themselves.
function dynamicHeader(literalLengths, distanceLengths) {
  const literalCount = lastUsed(literalLengths) + 1;
  const distanceCount = lastUsed(distanceLengths) + 1;
  const items = runLengths([...literalLengths.slice(0, literalCount), ...distanceLengths.slice(0, distanceCount)]);
  const frequencies = new Array(19).fill(0);
  for (const [symbol] of items) {
    frequencies[symbol] += 1;
  }
  const lengths = huffmanLengths(frequencies, MAX_CODE_LENGTH_BITS);
  const codes = canonicalCodes(lengths);
  let orderCount = CODE_LENGTH_ORDER.length;
  while (orderCount > 4 && lengths[CODE_LENGTH_ORDER[orderCount - 1]] === 0) {
    orderCount -= 1;
  }
  let bits = 5 + 5 + 4 + 3 * orderCount;
  for (const [symbol] of items) {
    bits += lengths[symbol] + CODE_LENGTH_EXTRA[symbol];
  }
  return {
    bits,
    write(writer) {
      writer.write(literalCount - 257, 5);
      writer.write(distanceCount - 1, 5);
      writer.write(orderCount - 4, 4);
      for (let index = 0; index < orderCount; index += 1) {
        writer.write(lengths[CODE_LENGTH_ORDER[index]], 3);
      }
      for (const [symbol, extra] of items) {
        writer.write(codes[symbol], lengths[symbol]);
        writer.write(extra, CODE_LENGTH_EXTRA[symbol]);
      }
    }
  };
}

function lastUsed(lengths) {
  let index = lengths.length - 1;
  while (lengths[index] === 0) {
    index -= 1;
  }
  return index;
}

// Code lengths as [symbol, extra] pairs: 16 repeats the previous length 3-6
// times, 17 and 18 send 3-10 and 11-138 zeros.
function runLengths(lengths) {
  const items = [];
  for (let index = 0; index < lengths.length;) {
    const value = lengths[index];
    let run = 1;
    while (index + run < lengths.length && lengths[index + run] === value) {
      run += 1;
    }
    index += run;
    if (value === 0) {
      for (; run >= 11; run -= Math.min(run, 138)) {
        items.push([18, Math.min(run, 138) - 11]);
      }
      if (run >= 3) {
        items.push([17, run - 3]);
        run = 0;
      }
    } else {
      items.push([value, 0]);
      run -= 1;
      for (; run >= 3; run -= Math.min(run, 6)) {
        items.push([16, Math.min(run, 6) - 3]);
      }
    }
    for (; run > 0; run -= 1) {
      items.push([value, 0]);
    }
  }
  return items;
}

// Huffman code lengths no longer than limit (exported for tests). A code
// needs at least two symbols, since a lone symbol would get a zero-bit code
// deflate cannot send, so the first unused symbols fill in. While the tree
// is too deep the weights are halved, which flattens it.
export function huffmanLengths(frequencies, limit) {
  let weights = Array.from(frequencies);
  let used = weights.filter((weight) => weight > 0).length;
  for (let symbol = 0; used < 2; symbol += 1) {
    if (weights[symbol] === 0) {
      weights[symbol] = 1;
      used += 1;
    }
  }
  let lengths = treeDepths(weights);
  while (Math.max(...lengths) > limit) {
    weights = weights.map((weight) => (weight + 1) >> 1);
    lengths = treeDepths(weights);
  }
  return lengths;
}

// The depth of every used symbol in a Huffman tree built with two queues:
// leaves sorted by weight, then symbol, and internal nodes in the order they
// are made, which is already sorted. Ties take the leaf, so the tree is the
// same on every runtime.
function treeDepths(weights) {
  const leaves = [];
  for (let symbol = 0; symbol < weights.length; symbol += 1) {
    if (weights[symbol] > 0) {
      leaves.push(symbol);
    }
  }
  leaves.sort((a, b) => weights[a] - weights[b] || a - b);
  const nodeWeights = leaves.map((symbol) => weights[symbol]);
  const parents = [];
  let leaf = 0;
  let inner = leaves.length;
  const lightest = () => (leaf < leaves.length && (inner === nodeWeights.length || nodeWeights[leaf] <= nodeWeights[inner]) ? leaf++ : inner++);
  while (nodeWeights.length < 2 * leaves.length - 1) {
    const first = lightest();
    const second = lightest();
    parents[first] = nodeWeights.length;
    parents[second] = nodeWeights.length;
    nodeWeights.push(nodeWeights[first] + nodeWeights[second]);
  }
  // Every parent comes after its children, so one pass from the root down
  // gives every depth.
  const depths = new Array(nodeWeights.length).fill(0);
  for (let node = nodeWeights.length - 2; node >= 0; node -= 1) {
    depths[node] = depths[parents[node]] + 1;
  }
  const lengths = new Array(weights.length).fill(0);
  leaves.forEach((symbol, index) => {
    lengths[symbol] = depths[index];
  });
  return lengths;
}

// Section 3.2.2: canonical codes from code lengths, bit-reversed because
// Huffman codes are sent most significant bit first.
function canonicalCodes(lengths) {
  const counts = new Array(MAX_CODE_BITS + 1).fill(0);
  for (const length of lengths) {
    counts[length] += 1;
  }
  counts[0] = 0;
  const next = [0];
  for (let bits = 1; bits <= MAX_CODE_BITS; bits += 1) {
    next[bits] = (next[bits - 1] + counts[bits - 1]) << 1;
  }
  return lengths.map((length) => {
    if (length === 0) {
      return 0;
    }
    let code = next[length];
    next[length] += 1;
    let reversed = 0;
    for (let bit = 0; bit < length; bit += 1) {
      reversed = (reversed << 1) | (code & 1);
      code >>= 1;
    }
    return reversed;
  });
}
