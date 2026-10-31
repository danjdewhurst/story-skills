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
  const mediaType = COVER_MEDIA_TYPES[path.extname(cover).toLowerCase()];
  if (mediaType === undefined) {
    throw projectError(`story.md cover ${cover} must be a ${Object.keys(COVER_MEDIA_TYPES).join(", ")} image`);
  }
  const filePath = path.resolve(project.root, cover);
  if (!isPathInside(project.root, filePath)) {
    throw projectError(`story.md cover ${cover} must be inside the project`);
  }
  const stats = lstatIfExists(filePath);
  if (!stats) {
    throw projectError(`story.md cover ${cover} does not exist`);
  }
  // The symlink check comes before the file check so a linked cover gets
  // the usual refusal rather than reading as missing.
  assertSafeProjectPath(filePath, project.root);
  if (!stats.isFile()) {
    throw projectError(`story.md cover ${cover} is not a file`);
  }
  assertFileSizeWithinLimit(filePath, MAX_COVER_BYTES);
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
    throw projectError(`story.md cover ${cover}: ${reason ? `Cannot read: ${reason}` : String(error.message).replace(`${filePath}: `, "")}`);
  }
  if (held !== mediaType) {
    throw projectError(held === null
      ? `story.md cover ${cover} does not hold a ${IMAGE_FORMAT_NAMES[mediaType]} image: its first bytes are not the ${IMAGE_FORMAT_NAMES[mediaType]} signature`
      : `story.md cover ${cover} holds a ${IMAGE_FORMAT_NAMES[held]} image, not a ${IMAGE_FORMAT_NAMES[mediaType]} one: rename it to end in ${Object.keys(COVER_MEDIA_TYPES).filter((extension) => COVER_MEDIA_TYPES[extension] === held).join(" or ")}`);
  }
  return { filePath, mediaType, extension: mediaType === "image/jpeg" ? "jpg" : path.extname(cover).slice(1).toLowerCase(), maxBytes: MAX_COVER_BYTES };
}

const IMAGE_FORMAT_NAMES = { "image/gif": "GIF", "image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WebP" };

// How many bytes of an image coverFormat reads. A --dry-run copy keeps
// this many of the cover (see preview.js).
export const IMAGE_SIGNATURE_BYTES = 12;

// The media type of a cover image read from its first bytes, the signature
// each format starts with, or null when it has none of them.
function coverFormat(filePath) {
  const head = readFilePrefix(filePath, IMAGE_SIGNATURE_BYTES);
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
