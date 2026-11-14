// Reads the zip of XML parts that a Word document (.docx), an OpenDocument
// text (.odt), and an EPUB are. The central directory is read under an
// entry limit, and each part is read under a size limit and checked against
// its CRC; node:zlib inflates it, since decompression gives the same bytes
// on every runtime, unlike the compression deflate.js replaces. The XML is
// read with a small scanner that never expands an entity a document
// declares: a document type declaration with declarations of its own is
// refused.
import zlib from "node:zlib";
import { crc32 } from "./packaging.js";

// A part bigger than this inflated is refused: a novel's text is a few
// megabytes, and the limit bounds the memory one conversion takes.
export const MAX_PART_BYTES = 32 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 10000;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_MARK = 0xffffffff;

// What a file is, for the messages that refuse it: `extension` and `kind`
// name it, `again` says how to make a readable copy, and `unlock` how to
// take its password off.
export const WORD = Object.freeze({
  extension: ".docx",
  kind: "a Word document",
  again: "save it again from Word",
  unlock: "remove the password in Word and save it again"
});

// The error for a file that is not a readable document. Its message is
// the reason, for the caller to show after the file name.
export class ArchiveError extends Error {
  constructor(message) {
    super(message);
    this.name = "ArchiveError";
  }
}

// Text from the file, such as a zip entry name, made safe to print in a
// message: a line break or tab is written as \n, \r, or \t, and any other
// control character or line separator becomes "?", so the name cannot
// start a line of its own.
const ESCAPED_CONTROLS = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };

export function printable(text) {
  return String(text).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, (character) => ESCAPED_CONTROLS[character] ?? "?");
}

// Text from the file as printable shows it, cut to its first 200
// characters, so a message never repeats megabytes of it.
const SHOWN_LENGTH = 200;

export function shown(text) {
  const value = String(text);
  return printable(value.length > SHOWN_LENGTH ? `${value.slice(0, SHOWN_LENGTH)}…` : value);
}

// Reads one archive's parts under a limit on their total inflated size,
// for a format that reads more parts than a .docx does. xmlText checks
// that a part inflates to exactly its declared size, so the declared sizes
// are what the reads cost, and `reserve` can refuse parts before any of
// them is inflated.
export function partReader(bytes, format, limit) {
  let left = limit;
  const over = () => new ArchiveError(`its parts come to more than the ${limit} byte limit unpacked`);
  return {
    reserve(entries) {
      if (entries.reduce((total, entry) => total + entry.size, 0) > left) {
        throw over();
      }
    },
    read(entry, options) {
      if (entry.size > left) {
        throw over();
      }
      left -= entry.size;
      return xmlText(bytes, entry, format, options);
    }
  };
}

// The zip's central directory, as a map from entry name to the entry's
// method, sizes, CRC, and local header offset.
export function zipEntries(bytes, format = WORD) {
  const end = findEndOfCentralDirectory(bytes, format);
  const count = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12);
  const offset = bytes.readUInt32LE(end + 16);
  if (count === 0xffff || size === ZIP64_MARK || offset === ZIP64_MARK) {
    throw new ArchiveError(`it is a ZIP64 archive, which story does not read; ${format.again}`);
  }
  if (count > MAX_ZIP_ENTRIES) {
    throw new ArchiveError(`it has ${count} zip entries, over the ${MAX_ZIP_ENTRIES} entry limit`);
  }
  if (offset + size > end) {
    throw new ArchiveError("its zip directory is damaged");
  }
  const entries = new Map();
  let position = offset;
  for (let index = 0; index < count; index += 1) {
    if (position + 46 > end || bytes.readUInt32LE(position) !== CENTRAL_SIGNATURE) {
      throw new ArchiveError("its zip directory is damaged");
    }
    const flags = bytes.readUInt16LE(position + 8);
    const nameLength = bytes.readUInt16LE(position + 28);
    const extraLength = bytes.readUInt16LE(position + 30);
    const commentLength = bytes.readUInt16LE(position + 32);
    const name = bytes.toString("utf8", position + 46, position + 46 + nameLength);
    // Two entries with one name could show one text in the program that
    // made the file and import another.
    if (entries.has(name)) {
      throw new ArchiveError(`it has two zip entries named ${printable(name)}`);
    }
    entries.set(name, {
      name,
      encrypted: (flags & 1) === 1,
      method: bytes.readUInt16LE(position + 10),
      crc: bytes.readUInt32LE(position + 16),
      compressedSize: bytes.readUInt32LE(position + 20),
      size: bytes.readUInt32LE(position + 24),
      localOffset: bytes.readUInt32LE(position + 42)
    });
    position += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

// The end of central directory record is the last 22 bytes, unless the
// zip has a comment of up to 65,535 bytes after it.
function findEndOfCentralDirectory(bytes, format) {
  const lowest = Math.max(0, bytes.length - 22 - 0xffff);
  for (let position = bytes.length - 22; position >= lowest; position -= 1) {
    if (bytes.readUInt32LE(position) === EOCD_SIGNATURE) {
      return position;
    }
  }
  throw new ArchiveError(`it is not a readable zip file, so it is not a ${format.extension}; ${format.again}, or export it to markdown`);
}

// One entry's bytes, inflated and checked against its size and CRC, read
// as UTF-8 XML. `doctype` lets the part open with a document type
// declaration that declares nothing, such as the `<!DOCTYPE html>` of an
// EPUB's XHTML, which is dropped; any other is refused.
export function xmlText(bytes, entry, format = WORD, { doctype = false } = {}) {
  if (entry.encrypted) {
    throw new ArchiveError(`it is password-protected; ${format.unlock}`);
  }
  if (entry.size === ZIP64_MARK || entry.compressedSize === ZIP64_MARK) {
    throw new ArchiveError(`it is a ZIP64 archive, which story does not read; ${format.again}`);
  }
  if (entry.size > MAX_PART_BYTES) {
    throw new ArchiveError(`${printable(entry.name)} is ${entry.size} bytes, over the ${MAX_PART_BYTES} byte limit`);
  }
  const local = entry.localOffset;
  if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== LOCAL_SIGNATURE) {
    throw new ArchiveError(`its zip entry ${printable(entry.name)} is damaged`);
  }
  const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (data.length !== entry.compressedSize) {
    throw new ArchiveError(`its zip entry ${printable(entry.name)} is cut short`);
  }
  let content;
  if (entry.method === 0) {
    content = data;
  } else if (entry.method === 8) {
    try {
      content = zlib.inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES });
    } catch {
      throw new ArchiveError(`its zip entry ${printable(entry.name)} cannot be inflated, or inflates past the ${MAX_PART_BYTES} byte limit`);
    }
  } else {
    throw new ArchiveError(`its zip entry ${printable(entry.name)} uses compression method ${entry.method}, which story does not read`);
  }
  if (content.length !== entry.size || crc32(content) !== entry.crc) {
    throw new ArchiveError(`its zip entry ${printable(entry.name)} is damaged`);
  }
  let text;
  try {
    text = UTF8.decode(content);
  } catch {
    throw new ArchiveError(`${printable(entry.name)} is not valid UTF-8 text`);
  }
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  if (doctype) {
    // A declaration in the prolog with no internal subset declares no
    // entity, so it is dropped. Any other is left for the scanner, which
    // refuses it as damage, unless it is inside a comment or CDATA.
    const declaration = prologDoctype(text);
    if (declaration !== null && declaration.subset) {
      throw new ArchiveError(`${printable(entry.name)} has a document type declaration with declarations of its own, which story does not read`);
    }
    if (declaration !== null) {
      text = text.slice(0, declaration.start) + text.slice(declaration.end);
    }
  } else if (/<!DOCTYPE/i.test(text)) {
    throw new ArchiveError(`${printable(entry.name)} has a document type declaration, which ${format.kind} never has`);
  }
  return text;
}

// The document type declaration in the prolog, after any white space, XML
// declaration, processing instructions, and comments, as { start, end,
// subset }, where subset is true when it has an internal subset (a `[`
// outside its quoted ids); or null when the prolog has none, or one that
// never ends. One pass over the prolog, with no pattern to backtrack.
function prologDoctype(text) {
  let position = 0;
  for (;;) {
    while (position < text.length && " \t\r\n".includes(text[position])) {
      position += 1;
    }
    const skip = [["<?", "?>"], ["<!--", "-->"]].find(([start]) => text.startsWith(start, position));
    if (skip !== undefined) {
      const close = text.indexOf(skip[1], position + skip[0].length);
      if (close === -1) {
        return null;
      }
      position = close + skip[1].length;
      continue;
    }
    if (text.slice(position, position + 9).toUpperCase() !== "<!DOCTYPE") {
      return null;
    }
    let quote = null;
    for (let index = position + 9; index < text.length; index += 1) {
      const character = text[index];
      if (quote !== null) {
        quote = character === quote ? null : quote;
      } else if (character === "\"" || character === "'") {
        quote = character;
      } else if (character === "[") {
        return { start: position, end: index, subset: true };
      } else if (character === ">") {
        return { start: position, end: index + 1, subset: false };
      }
    }
    return null;
  }
}

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// XML tokens: start, end, and empty tags with their attributes, and the
// text between them. Comments, processing instructions, and CDATA are
// skipped. The tag pattern is sticky and its attribute values cannot
// overlap, so a scan stays linear. A comment, processing instruction, or
// CDATA section that never ends, an end tag that does not match the open
// element, or an element left open is damage, so a cut-short part is never
// read as a shorter document. `entities` names the entities the text may
// use: XML's five, unless the caller passes more (HTML_ENTITIES).
const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const ATTRIBUTE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function* xmlTokens(text, entities = XML_ENTITIES) {
  const open = [];
  for (const token of rawTokens(text, entities)) {
    if (token.type === "start") {
      open.push(token.name);
    } else if (token.type === "end" && open.pop() !== token.name) {
      throw new ArchiveError("its XML is damaged");
    }
    yield token;
  }
  if (open.length > 0) {
    throw new ArchiveError("its XML is damaged");
  }
}

function* rawTokens(text, entities) {
  let position = 0;
  while (position < text.length) {
    const open = text.indexOf("<", position);
    if (open === -1) {
      yield { type: "text", text: decodeEntities(text.slice(position), entities) };
      return;
    }
    if (open > position) {
      yield { type: "text", text: decodeEntities(text.slice(position, open), entities) };
    }
    const skip = [["<!--", "-->"], ["<?", "?>"], ["<![CDATA[", "]]>"]].find(([start]) => text.startsWith(start, open));
    if (skip !== undefined) {
      const close = text.indexOf(skip[1], open + skip[0].length);
      if (close === -1) {
        throw new ArchiveError("its XML is damaged");
      }
      if (skip[0] === "<![CDATA[") {
        yield { type: "text", text: text.slice(open + 9, close) };
      }
      position = close + skip[1].length;
      continue;
    }
    TAG.lastIndex = open;
    const match = TAG.exec(text);
    if (match === null) {
      throw new ArchiveError("its XML is damaged");
    }
    const attributes = {};
    for (const attribute of match[3].matchAll(ATTRIBUTE)) {
      attributes[attribute[1]] = decodeEntities(attribute[2] ?? attribute[3], entities);
    }
    yield { type: match[1] ? "end" : match[4] ? "empty" : "start", name: match[2], attributes };
    position = TAG.lastIndex;
  }
}

const XML_ENTITIES = new Map([["lt", "<"], ["gt", ">"], ["amp", "&"], ["quot", "\""], ["apos", "'"]]);

// The HTML entities an XHTML document of an EPUB 2 may use through the
// XHTML DTD: XML's five and the 252 of HTML 4 (Latin-1, punctuation and
// spaces, Greek, arrows, and symbols). Another is kept as written.
const LATIN_1 = "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml";
// HTML 4's Greek letters, arrows, and mathematical and other symbols, as
// name:code point.
const HTML_SYMBOLS = [
  "Alpha:913 Beta:914 Gamma:915 Delta:916 Epsilon:917 Zeta:918 Eta:919 Theta:920 Iota:921 Kappa:922 Lambda:923 Mu:924 Nu:925 Xi:926 Omicron:927 Pi:928 Rho:929 Sigma:931 Tau:932 Upsilon:933 Phi:934 Chi:935 Psi:936 Omega:937",
  "alpha:945 beta:946 gamma:947 delta:948 epsilon:949 zeta:950 eta:951 theta:952 iota:953 kappa:954 lambda:955 mu:956 nu:957 xi:958 omicron:959 pi:960 rho:961 sigmaf:962 sigma:963 tau:964 upsilon:965 phi:966 chi:967 psi:968 omega:969 thetasym:977 upsih:978 piv:982",
  "oline:8254 frasl:8260 weierp:8472 image:8465 real:8476 alefsym:8501",
  "larr:8592 uarr:8593 rarr:8594 darr:8595 harr:8596 crarr:8629 lArr:8656 uArr:8657 rArr:8658 dArr:8659 hArr:8660",
  "forall:8704 part:8706 exist:8707 empty:8709 nabla:8711 isin:8712 notin:8713 ni:8715 prod:8719 sum:8721 minus:8722 lowast:8727 radic:8730 prop:8733 infin:8734 ang:8736 and:8743 or:8744 cap:8745 cup:8746 int:8747 there4:8756 sim:8764 cong:8773 asymp:8776 ne:8800 equiv:8801 le:8804 ge:8805 sub:8834 sup:8835 nsub:8836 sube:8838 supe:8839 oplus:8853 otimes:8855 perp:8869 sdot:8901",
  "lceil:8968 rceil:8969 lfloor:8970 rfloor:8971 lang:9001 rang:9002 loz:9674 spades:9824 clubs:9827 hearts:9829 diams:9830"
].join(" ");

export const HTML_ENTITIES = new Map([
  ...XML_ENTITIES,
  ...LATIN_1.split(" ").map((name, index) => [name, String.fromCharCode(160 + index)]),
  ...Object.entries({
    OElig: "Œ", oelig: "œ", Scaron: "Š", scaron: "š", Yuml: "Ÿ", fnof: "ƒ", circ: "ˆ", tilde: "˜",
    ensp: "\u2002", emsp: "\u2003", thinsp: "\u2009", zwnj: "\u200c", zwj: "\u200d", lrm: "\u200e", rlm: "\u200f",
    ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„",
    dagger: "†", Dagger: "‡", bull: "•", hellip: "…", permil: "‰", prime: "′", Prime: "″",
    lsaquo: "‹", rsaquo: "›", euro: "€", trade: "™"
  }),
  ...HTML_SYMBOLS.split(" ").map((pair) => {
    const [name, code] = pair.split(":");
    return [name, String.fromCodePoint(Number(code))];
  })
]);

function decodeEntities(text, entities) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (whole, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return entities.get(name) ?? whole;
  });
}
