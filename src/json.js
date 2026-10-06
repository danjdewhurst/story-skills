import { EXIT_CODES } from "./exit-codes.js";
import { err } from "./findings.js";
import { portablePath } from "./files.js";
import { isTruthy } from "./options.js";

// The version of the --json result envelope. Adding a field keeps it;
// renaming, removing, or retyping one bumps it. schemas/result.schema.json
// describes this version. story/v2 made diagnostics[].code the finding's
// rule code, where story/v1 (0.16.0) had the check name, and added
// diagnostics[].check; diagnostics[].chapter and a dismissed diagnostic's
// exemptionIndex were added within it.
export const API_VERSION = "story/v2";

export function wantsJson(parsed) {
  return isTruthy(parsed.options.json);
}

// Prints one --json result object on stdout and returns the exit code that
// matches its `ok`: 0 when it is true, else `exitCode` (a code from
// exit-codes.js saying why the command failed), which defaults to findings.
// Every command with --json output calls this, and nothing else is printed,
// so stdout parses as a single JSON document.
export function writeJsonResult(io, { command, ok, exitCode = EXIT_CODES.findings, data = null, diagnostics = [], writes = [] }) {
  const envelope = { apiVersion: API_VERSION, command, ok: Boolean(ok), data, diagnostics, writes };
  // A field a result leaves undefined prints as null, so every result of a
  // command has the same keys.
  io.stdout.write(`${JSON.stringify(envelope, (key, value) => (value === undefined ? null : value), 2)}\n`);
  return envelope.ok ? EXIT_CODES.ok : exitCode;
}

// A check result's errors, warnings, and dismissed findings as diagnostics.
// `check` names the check that raised them: validate, links, continuity, or
// the command.
export function diagnosticsFrom(result, check) {
  return [
    ...(result.errors ?? []).map((finding) => diagnostic("error", finding, check)),
    ...(result.warnings ?? []).map((finding) => diagnostic("warning", finding, check)),
    ...(result.dismissed ?? []).map((entry) => ({ ...diagnostic("dismissed", entry.finding, check), exemption: entry.reason, exemptionIndex: entry.index ?? null }))
  ];
}

export function diagnostic(severity, finding, check) {
  return { severity, file: portablePath(finding.file), chapter: finding.chapter ?? null, message: finding.message, code: finding.code, check };
}

// A command that failed before it produced a result (a usage error, a
// project it cannot read) as a diagnostic, coded by why it failed.
export function failureDiagnostic(message, exitCode, check) {
  return diagnostic("error", failure(message, exitCode), check);
}

function failure(message, exitCode) {
  switch (exitCode) {
    case EXIT_CODES.usage:
      return err("usage-error", message);
    case EXIT_CODES.project:
      return err("unusable-project", message);
    case EXIT_CODES.refused:
      return err("write-refused", message);
    default:
      return err("command-failed", message);
  }
}

// A check result without the fields the envelope already carries.
export function resultData(result) {
  const { ok, errors, warnings, dismissed, ...data } = result;
  return data;
}
