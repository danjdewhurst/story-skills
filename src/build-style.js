import path from "node:path";
import { err } from "./findings.js";
import { assertSafeProjectPath, isPathInside, lstatIfExists, readTextFile } from "./files.js";
import { projectError } from "./exit-codes.js";

// story.md `build-style`: how the EPUB, HTML review copy, and print interior
// look. A preset sets several choices at once, and each other key overrides
// one of them. Unset, or `preset: classic` with nothing else, every build is
// byte for byte what it was before the field existed. The Shunn manuscript
// and DOCX builds follow fixed conventions and never read it.
//
// The frontmatter has no nested maps, so the block is a list of mappings,
// usually one:
//
//   build-style:
//     - preset: elegant
//       scene-break: "~"

export const BUILD_STYLE_PRESETS = ["classic", "modern", "elegant"];
export const HEADING_STYLES = ["centered", "small-caps", "left"];
export const PARAGRAPH_STYLES = ["indented", "block"];
export const BUILD_STYLE_KEYS = ["preset", "body-font", "heading-font", "heading-style", "scene-break", "drop-caps", "paragraphs", "css"];

// A font list: comma-separated family names, each bare or in matching
// quotes, with nothing that could end the declaration or the style element
// (; { } < >), start a comment (/), escape (\), or call a function (( )).
// schemas/story.schema.json carries the same pattern.
const NAME = `[^,"'\\\\/<>;{}()\\u0000-\\u001f\\u007f]`;
const SOLID = `[^\\s,"'\\\\/<>;{}()\\u0000-\\u001f\\u007f]`;
const FAMILY = `${NAME}*${SOLID}${NAME}*`;
const ITEM = `\\s*(?:"${FAMILY}"|'${FAMILY}'|${FAMILY})\\s*`;
export const FONT_PATTERN = new RegExp(`^${ITEM}(?:,${ITEM})*$`, "u");

// One line of text with something printable in it.
export const SCENE_BREAK_PATTERN = /^[^\u0000-\u001f\u007f]*[^\s\u0000-\u001f\u007f][^\u0000-\u001f\u007f]*$/u;

// Generic families stay bare; any other name is quoted, so a name such as
// Source Serif 4, which is not a CSS identifier, still works.
const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "math", "emoji", "fangsong"]);

const SANS_STACK = `"Avenir Next", "Segoe UI", "Helvetica Neue", Arial, "Noto Sans", sans-serif`;
const OLD_STYLE_STACK = `Palatino, "Palatino Linotype", "Book Antiqua", "Iowan Old Style", Georgia, serif`;

// What each preset sets. A value left out keeps the build's own default.
// Preset fonts are Latin fonts, so a book in another script keeps the font
// stack for its script (see typesetting.js).
const PRESETS = {
  classic: {},
  modern: { headingFont: SANS_STACK, headingStyle: "left", sceneBreak: "• • •", dropCaps: false, paragraphs: "block" },
  elegant: { bodyFont: OLD_STYLE_STACK, headingStyle: "small-caps", sceneBreak: "❦", dropCaps: true, paragraphs: "indented" }
};

const isEntry = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// The keys of every entry merged, for a field already checked by
// validateBuildStyle; an invalid shape reads as unset.
function styleFields(data) {
  const value = data["build-style"];
  return Array.isArray(value) ? Object.assign({}, ...value.filter(isEntry)) : {};
}

// A checked font list as CSS: names trimmed and quoted, generics bare.
export function fontList(value) {
  return String(value).split(",").map((item) => {
    const name = item.trim().replace(/^(["'])(.*)\1$/u, "$2").trim();
    return GENERIC_FAMILIES.has(name.toLowerCase()) ? name.toLowerCase() : `"${name}"`;
  }).join(", ");
}

// The resolved style: each setting the story.md value, else the preset's,
// else null for the build's own default. Fonts the writer named are kept
// apart from a preset's (see styleFonts). `css` is the stylesheet path as
// written, or null. Assumes validateBuildStyle found no errors.
export function buildStyle(data) {
  const fields = styleFields(data);
  const preset = PRESETS[fields.preset] ?? PRESETS.classic;
  const pick = (key, presetKey) => (fields[key] !== undefined ? fields[key] : preset[presetKey] ?? null);
  const style = {
    preset: typeof fields.preset === "string" ? fields.preset : "classic",
    bodyFont: fields["body-font"] === undefined ? null : fontList(fields["body-font"]),
    presetBodyFont: preset.bodyFont ?? null,
    headingFont: fields["heading-font"] === undefined ? null : fontList(fields["heading-font"]),
    presetHeadingFont: preset.headingFont ?? null,
    headingStyle: pick("heading-style", "headingStyle"),
    sceneBreak: fields["scene-break"] === undefined ? preset.sceneBreak ?? null : String(fields["scene-break"]).trim(),
    dropCaps: pick("drop-caps", "dropCaps"),
    paragraphs: pick("paragraphs", "paragraphs"),
    css: typeof fields.css === "string" ? fields.css.trim() : null
  };
  // Whether anything changes the look, apart from an extra stylesheet.
  style.styled = ["bodyFont", "presetBodyFont", "headingFont", "presetHeadingFont", "headingStyle", "sceneBreak", "dropCaps", "paragraphs"].some((key) => style[key] !== null);
  return style;
}

// The style every build has without a build-style field.
export const CLASSIC_STYLE = Object.freeze(buildStyle({}));

// The fonts for a book set with `type` (typesetting.js): `body`, `heading`
// (null to inherit the body's), and `heads` for running heads and folios.
// A font the writer named comes first; in a book whose script is not Latin
// the script's stack follows it, so a glyph the named font lacks still has
// a font. A preset's fonts apply only to a Latin-script book.
export function styleFonts(style, type) {
  const latin = type.fonts.latin;
  const own = (list) => (list === null ? null : latin ? list : `${list}, ${type.fonts.body}`);
  const body = own(style.bodyFont) ?? (latin ? style.presetBodyFont : null) ?? type.fonts.body;
  const heading = own(style.headingFont) ?? (latin ? style.presetHeadingFont : null);
  return { body, heading, heads: heading ?? (body === type.fonts.body ? type.fonts.heads : body) };
}

// The extra stylesheet's path, checked: a .css file inside the project,
// read without following a symlink. Returns { filePath, text } with line
// endings made LF and any byte order mark dropped, so the build is the same
// on every system. Throws a project error naming the problem.
export function styleSheetFile(root, value) {
  const css = String(value).trim();
  // Before any file-system call, which would throw on a NUL with a message
  // that names neither story.md nor the setting.
  if (/[\u0000-\u001f\u007f]/u.test(css)) {
    throw projectError(`story.md build-style css ${JSON.stringify(css)} must not contain control characters`);
  }
  if (!/\.css$/i.test(css) || /[\\/]\.css$/i.test(css) || css.toLowerCase() === ".css") {
    throw projectError(`story.md build-style css ${css} must be a .css file`);
  }
  const filePath = path.resolve(root, css);
  if (!isPathInside(root, filePath)) {
    throw projectError(`story.md build-style css ${css} must be inside the project`);
  }
  if (!lstatIfExists(filePath)) {
    throw projectError(`story.md build-style css ${css} does not exist`);
  }
  let text;
  try {
    assertSafeProjectPath(filePath, root);
    text = readTextFile(filePath);
  } catch (error) {
    throw projectError(`story.md build-style css ${css}: ${String(error.message).replace(`${filePath}: `, "")}`);
  }
  // The review copy and print interior carry it in a <style> element,
  // which this would close.
  if (/<\/style/i.test(text)) {
    throw projectError(`story.md build-style css ${css} must not contain </style`);
  }
  text = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  return { filePath, text: text === "" || text.endsWith("\n") ? text : `${text}\n` };
}

// Every problem with story.md build-style, as errors. With `root`, the css
// file is checked on disk too.
export function validateBuildStyle(data, errors, root = null) {
  const value = data["build-style"];
  if (value === undefined) {
    return;
  }
  const fail = (message) => errors.push(err("invalid-build-style", `story.md build-style ${message}`, "story.md"));
  if (!Array.isArray(value) || !value.every(isEntry)) {
    fail("must be a list of key: value entries, such as - preset: modern (see docs/manuscripts.md#build-styles)");
    return;
  }
  const seen = new Set();
  for (const entry of value) {
    for (const [key, setting] of Object.entries(entry)) {
      if (!BUILD_STYLE_KEYS.includes(key)) {
        fail(`key ${key} is not a style setting; use ${BUILD_STYLE_KEYS.join(", ")}`);
        continue;
      }
      if (seen.has(key)) {
        fail(`sets ${key} more than once`);
        continue;
      }
      seen.add(key);
      const problem = settingProblem(key, setting);
      if (problem !== "") {
        fail(problem);
      } else if (key === "css" && root !== null) {
        try {
          styleSheetFile(root, setting);
        } catch (error) {
          errors.push(err("invalid-build-style", error.message, "story.md"));
        }
      }
    }
  }
}

function settingProblem(key, value) {
  const choice = (choices) => (typeof value === "string" && choices.includes(value) ? "" : `${key} must be one of ${choices.join(", ")}`);
  switch (key) {
    case "preset":
      return choice(BUILD_STYLE_PRESETS);
    case "heading-style":
      return choice(HEADING_STYLES);
    case "paragraphs":
      return choice(PARAGRAPH_STYLES);
    case "body-font":
    case "heading-font":
      return typeof value === "string" && FONT_PATTERN.test(value) ? "" : `${key} must be a comma-separated list of font names, such as Iowan Old Style, Georgia, serif`;
    case "scene-break":
      return typeof value === "string" && SCENE_BREAK_PATTERN.test(value) ? "" : `${key} must be one line of text, such as "* * *" or "~"`;
    case "drop-caps":
      return typeof value === "boolean" ? "" : `${key} must be true or false`;
    default:
      return typeof value === "string" && value.trim() !== "" ? "" : `${key} must be the path to a .css file in the project`;
  }
}
