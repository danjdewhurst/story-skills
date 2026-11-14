// The story.md cover image: where it may live, its size limit, and the media
// type its extension and first bytes must agree on.
import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import {
  assertSafeProjectPath,
  FILE_ERROR_REASONS,
  isPathInside,
  lstatIfExists,
  readFileBytes,
  readFilePrefix
} from "./files.js";
import { projectError } from "./exit-codes.js";
import { PATH_CONTROL_CHARACTERS, controlCharacterError } from "./scan-ids.js";
import { MAX_SCAN_FILE_BYTES } from "./scan-files.js";

// EPUB 3 core media types for a cover image, keyed by file extension.
const COVER_MEDIA_TYPES = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
};

// Retail cover images run larger than any text file; 50 MiB matches the
// largest cover upload the main retailers take.
const MAX_COVER_BYTES = 50 * 1024 * 1024;

// For binary files such as the cover; text files go through readTextFile.
function assertFileSizeWithinLimit(filePath, limit = MAX_SCAN_FILE_BYTES) {
  const size = fs.statSync(filePath).size;
  if (size > limit) {
    throw projectError('Refusing to read oversized file ' + filePath + ': ' + size + ' bytes exceeds the ' + limit + ' byte limit');
  }
}

// Whether story.md names a cover the EPUB build would accept.
export function coverIsReady(project) {
  if (project.story.data.cover === undefined) {
    return false;
  }
  try {
    coverImage(project);
    return true;
  } catch {
    return false;
  }
}

// Resolves story.md `cover` to an image inside the project. Throws with a
// story.md-prefixed message so validate and build report the same problem.
// `maxBytes` is the cap the EPUB build reads the image with, so a cover
// swapped for a larger file or a symlink after this check is still refused.
export function coverImage(project) {
  const cover = String(project.story.data.cover).trim();
  // Checked before any file-system call, which would throw on a NUL with a
  // message that names neither story.md nor the cover.
  if (PATH_CONTROL_CHARACTERS.test(cover)) {
    throw controlCharacterError("cover", cover);
  }
  return checkedImage(project, cover, path.resolve(project.root, cover), `story.md cover ${cover}`);
}

// An image in the prose of `file` (a chapter or matter page, relative to
// the project root), as `![alt](destination)` names it, checked as the
// cover is: { filePath, mediaType, extension, maxBytes }. The destination
// is read as a markdown viewer reads it, relative to the file, or to the
// project root when it starts with `/`, with %-escapes decoded and any
// query or fragment left off. Throws a
// message that names the file and the image as written. A remote image
// (http or https) is not fetched: remoteImage tells it apart first.
export function proseImage(project, file, destination) {
  const written = String(destination);
  const shown = `${file} image ${JSON.stringify(written).slice(1, -1)}`;
  // A query or fragment (`map.png?raw=true`) is no part of the file name.
  let target = written.replace(/[?#][\s\S]*$/, "");
  try {
    target = decodeURIComponent(target);
  } catch {
    // A lone % is a file name character, as a viewer reads it.
  }
  if (PATH_CONTROL_CHARACTERS.test(target)) {
    throw projectError(`${shown} must not contain control characters`);
  }
  if (target.trim() === "") {
    throw projectError(`${shown} names no file`);
  }
  // A scheme (`data:`, `file:`) or a drive letter names no project file.
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    throw projectError(`${shown} must be a file inside the project, not a URL`);
  }
  const filePath = target.startsWith("/") || target.startsWith("\\")
    ? path.resolve(project.root, `.${target}`)
    : path.resolve(project.root, path.dirname(file), target);
  return checkedImage(project, target, filePath, shown);
}

// Whether an image destination is a web address, which builds do not
// fetch: http, https, or one with no scheme (`//cdn.example.com/x.png`).
export function remoteImage(destination) {
  return /^(?:https?:)?\/\//i.test(String(destination).trim());
}

// The checks the cover and prose images share. `written` is the path as
// the project names it, `filePath` where it resolves to, and `shown` the
// start of each message.
function checkedImage(project, written, filePath, shown) {
  const mediaType = COVER_MEDIA_TYPES[path.extname(written).toLowerCase()];
  if (mediaType === undefined) {
    throw projectError(`${shown} must be a ${Object.keys(COVER_MEDIA_TYPES).join(", ")} image`);
  }
  if (!isPathInside(project.root, filePath)) {
    throw projectError(`${shown} must be inside the project`);
  }
  // The cover keeps these refusals as they are. A prose image's message
  // names its file, and the path as the prose writes it, never the
  // absolute one, which differs in a --dry-run copy; a file system error
  // is its reason in plain words.
  const named = (check) => {
    try {
      return check();
    } catch (error) {
      if (shown.startsWith("story.md cover ")) {
        throw error;
      }
      const reason = FILE_ERROR_REASONS[error.code];
      const message = reason ? `Cannot read: ${reason}` : String(error.message).split(filePath).join(written).split(project.root).join(".").replace(`${written}: `, "");
      throw projectError(`${shown}: ${message}`);
    }
  };
  const stats = named(() => lstatIfExists(filePath));
  if (!stats) {
    throw projectError(`${shown} does not exist`);
  }
  // The symlink check comes before the file check so a linked image gets
  // the usual refusal rather than reading as missing.
  named(() => assertSafeProjectPath(filePath, project.root));
  if (!stats.isFile()) {
    throw projectError(`${shown} is not a file`);
  }
  named(() => assertFileSizeWithinLimit(filePath, MAX_COVER_BYTES));
  // The EPUB declares the media type from the extension, so the bytes must
  // match it, or a file saved over the cover (an HTML build, say) would ship
  // as the cover image.
  let held;
  try {
    held = coverFormat(filePath);
  } catch (error) {
    // Node names the absolute path; the reason alone, in plain words, is
    // the same in a --dry-run copy.
    const reason = FILE_ERROR_REASONS[error.code];
    throw projectError(`${shown}: ${reason ? `Cannot read: ${reason}` : String(error.message).replace(`${filePath}: `, "")}`);
  }
  if (held !== mediaType) {
    throw projectError(held === null
      ? `${shown} does not hold a ${IMAGE_FORMAT_NAMES[mediaType]} image: its first bytes are not the ${IMAGE_FORMAT_NAMES[mediaType]} signature`
      : `${shown} holds a ${IMAGE_FORMAT_NAMES[held]} image, not a ${IMAGE_FORMAT_NAMES[mediaType]} one: rename it to end in ${Object.keys(COVER_MEDIA_TYPES).filter((extension) => COVER_MEDIA_TYPES[extension] === held).join(" or ")}`);
  }
  return { filePath, mediaType, extension: mediaType === "image/jpeg" ? "jpg" : path.extname(written).slice(1).toLowerCase(), maxBytes: MAX_COVER_BYTES, size: stats.size, root: project.root, shown };
}

// The bytes of an image proseImage checked, read again as a build embeds
// them: still inside the project through no symlinked folder, and still
// the image its extension names, so a file swapped after the check is
// refused rather than shipped.
export function proseImageBytes(image) {
  let bytes;
  try {
    assertSafeProjectPath(image.filePath, image.root);
    bytes = readFileBytes(image.filePath, image.maxBytes);
  } catch (error) {
    // The message names the image as the prose writes it, as the check's do.
    const reason = FILE_ERROR_REASONS[error.code];
    throw projectError(`${image.shown} changed while the build read it: ${reason ? `Cannot read: ${reason}` : String(error.message).split(image.filePath).join("the image").split(image.root).join(".")}`);
  }
  if (formatOfBytes(bytes) !== image.mediaType) {
    throw projectError(`${image.shown} changed while the build read it: build again`);
  }
  return bytes;
}

const IMAGE_FORMAT_NAMES = { "image/gif": "GIF", "image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WebP" };

// How many bytes of an image coverFormat reads. A --dry-run copy keeps
// this many of the cover (see preview.js).
export const IMAGE_SIGNATURE_BYTES = 12;

// The media type of a cover image read from its first bytes, the signature
// each format starts with, or null when it has none of them.
function coverFormat(filePath) {
  return formatOfBytes(readFilePrefix(filePath, IMAGE_SIGNATURE_BYTES));
}

// The media type an image's first bytes give, or null.
function formatOfBytes(bytes) {
  const head = Buffer.from(bytes).subarray(0, IMAGE_SIGNATURE_BYTES);
  const ascii = (start, end) => head.subarray(start, end).toString("latin1");
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return "image/jpeg";
  }
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") {
    return "image/gif";
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

// The pixel size of an image from its bytes, as { width, height }, or null
// when its header does not give one: the PNG IHDR chunk, the GIF logical
// screen, a JPEG start-of-frame segment, or a WebP VP8, VP8L, or VP8X
// chunk. The DOCX build sizes each image from it.
export function imageSize(bytes, mediaType) {
  const data = Buffer.from(bytes);
  const size = (width, height) => (width > 0 && height > 0 ? { width, height } : null);
  if (mediaType === "image/png") {
    return data.length >= 24 && data.toString("latin1", 12, 16) === "IHDR" ? size(data.readUInt32BE(16), data.readUInt32BE(20)) : null;
  }
  if (mediaType === "image/gif") {
    return data.length >= 10 ? size(data.readUInt16LE(6), data.readUInt16LE(8)) : null;
  }
  if (mediaType === "image/webp") {
    return webpSize(data, size);
  }
  if (mediaType === "image/jpeg") {
    return jpegSize(data, size);
  }
  return null;
}

function webpSize(data, size) {
  if (data.length < 30) {
    return null;
  }
  const chunk = data.toString("latin1", 12, 16);
  if (chunk === "VP8 ") {
    return size(data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff);
  }
  if (chunk === "VP8L") {
    const bits = data.readUInt32LE(21);
    return size((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (chunk === "VP8X") {
    return size(data.readUIntLE(24, 3) + 1, data.readUIntLE(27, 3) + 1);
  }
  return null;
}

// The start-of-frame markers: every SOFn but DHT (C4), JPG (C8), and DAC (CC).
const JPEG_FRAMES = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

// Each segment is a marker (FF and a code) and, but for the standalone
// markers, a two-byte length that counts itself; the frame segment gives
// the height, then the width.
function jpegSize(data, size) {
  let index = 2;
  while (index + 4 <= data.length) {
    if (data[index] !== 0xff) {
      return null;
    }
    const marker = data[index + 1];
    if (marker === 0xff) {
      index += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      index += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) {
      return null;
    }
    const length = data.readUInt16BE(index + 2);
    if (JPEG_FRAMES.has(marker)) {
      return index + 9 <= data.length ? size(data.readUInt16BE(index + 7), data.readUInt16BE(index + 5)) : null;
    }
    index += 2 + length;
  }
  return null;
}
