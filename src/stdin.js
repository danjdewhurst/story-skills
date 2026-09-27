import { Buffer } from "node:buffer";
import fs from "node:fs";
import tty from "node:tty";

// `-` in place of a file or project path means "read standard input", as it
// does for cat and git. A file really named `-` is reached as `./-`.
export const STDIN_ARG = "-";

// The same cap import puts on one manuscript file.
export const MAX_STDIN_BYTES = 5 * 1024 * 1024;

const CHUNK_BYTES = 64 * 1024;
const RETRY_MS = 10;

// Reads all of standard input synchronously, so the CLI stays synchronous
// under Node 18 and Bun alike. A loop of readSync calls, rather than
// fs.readFileSync(0), so a non-blocking pipe (EAGAIN) is waited on instead
// of failing, and the size cap stops a runaway pipe early. A terminal is
// refused: the command would otherwise sit waiting for keyboard input.
// `fd`, `isatty`, and `readSync` are for tests.
export function readStdin(command, { fd = 0, isatty = tty.isatty, readSync = fs.readSync, maxBytes = MAX_STDIN_BYTES } = {}) {
  if (isatty(fd)) {
    throw new Error(`story ${command} - reads from stdin, but stdin is a terminal: pipe the text in, such as story ${command} - < draft.md`);
  }
  const chunks = [];
  const buffer = Buffer.alloc(CHUNK_BYTES);
  let total = 0;
  for (;;) {
    let read;
    try {
      read = readSync(fd, buffer, 0, buffer.length, null);
    } catch (error) {
      if (error.code === "EAGAIN") {
        pause(RETRY_MS);
        continue;
      }
      // Windows reports the end of a pipe as an EOF error.
      if (error.code === "EOF") {
        break;
      }
      if (error.code === "EBADF") {
        throw new Error(`story ${command} - reads from stdin, but stdin is closed: pipe the text in, such as story ${command} - < draft.md`);
      }
      throw new Error(`Cannot read stdin: ${error.message}`);
    }
    if (read === 0) {
      break;
    }
    total += read;
    if (total > maxBytes) {
      throw new Error(`Refusing to read more than ${maxBytes} bytes from stdin`);
    }
    chunks.push(Buffer.from(buffer.subarray(0, read)));
  }
  return Buffer.concat(chunks);
}

// UTF-8 text from stdin, refused as import refuses a file: not a zip, a
// binary, or text in another encoding. Empty input is an error, since a
// report on nothing would read as a clean bill of health.
export function stdinText(command, bytes) {
  const text = decodeUtf8(bytes, "Cannot read stdin", "Pipe UTF-8 plain text or markdown instead");
  if (text.trim() === "") {
    throw new Error(`story ${command} - read nothing from stdin: pipe the text in, such as story ${command} - < draft.md`);
  }
  return text;
}

// Text without its byte-order mark, or an error that starts with `subject`
// and ends with `advice`, so no character is silently replaced.
export function decodeUtf8(bytes, subject, advice) {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    throw new Error(`${subject}: it is a zip archive (such as a .docx or .odt file). Save or export it as markdown or plain text first`);
  }
  if (bytes.includes(0)) {
    throw new Error(`${subject}: it is a binary or UTF-16 file, not UTF-8 text. ${advice}`);
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${subject}: it is not valid UTF-8 text. ${advice}`);
  }
  return text.replace(/^\uFEFF/, "");
}

function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
