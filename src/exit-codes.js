// Exit codes shared by every command, so scripts can tell a manuscript with
// problems from a mistyped command line, a folder that is not a readable
// story project, and a write the CLI refused. Findings keep 1, so the common
// `story validate || exit 1` still fails a CI job on errors.
export const EXIT_CODES = Object.freeze({
  // The command succeeded. For checks, there were no errors.
  ok: 0,
  // A check reported at least one error, or a failure that fits no other code.
  findings: 1,
  // The command line was wrong: an unknown command or option, a missing or
  // invalid value, an unexpected argument, or an id that does not exist.
  usage: 2,
  // The project could not be used: no story.md, a file that cannot be read
  // or parsed where the command needs it, or content it cannot build from.
  project: 3,
  // The CLI refused or failed to write: the target exists, is project
  // source, is outside the project or through a symlink, is locked by
  // another story command, changed on disk, or the file system said no.
  refused: 4
});

function withCode(message, exitCode) {
  return Object.assign(new Error(message), { exitCode });
}

export function usageError(message) {
  return withCode(message, EXIT_CODES.usage);
}

export function projectError(message) {
  return withCode(message, EXIT_CODES.project);
}

export function refusedError(message) {
  return withCode(message, EXIT_CODES.refused);
}

// Marks an error raised while doing something of a known kind (writing a
// file, say) with that kind's exit code, replacing any code it had.
export function withExitCode(error, exitCode) {
  if (error !== null && typeof error === "object") {
    error.exitCode = exitCode;
  }
  return error;
}

// The same, but keeps a code the error already carries: a usage error raised
// while checking a write target stays a usage error.
export function withDefaultExitCode(error, exitCode) {
  if (error !== null && typeof error === "object" && !Number.isInteger(error.exitCode)) {
    error.exitCode = exitCode;
  }
  return error;
}

// Syscalls and error codes that mean a write failed rather than a read.
const WRITE_SYSCALLS = new Set(["write", "rename", "mkdir", "unlink", "rmdir", "copyfile", "rm", "access", "chmod", "fsync"]);
const WRITE_ERROR_CODES = new Set(["EROFS", "ENOSPC", "EDQUOT", "EFBIG"]);

// The exit code for an error that stopped a command. Errors the CLI raises
// carry their code; a raw file-system error counts as a refused write when
// it came from a write and as an unreadable project otherwise.
export function exitCodeFor(error) {
  if (Number.isInteger(error?.exitCode)) {
    return error.exitCode;
  }
  if (typeof error?.code === "string" && /^E[A-Z]+$/.test(error.code)) {
    return WRITE_SYSCALLS.has(error.syscall) || WRITE_ERROR_CODES.has(error.code) ? EXIT_CODES.refused : EXIT_CODES.project;
  }
  return EXIT_CODES.findings;
}
