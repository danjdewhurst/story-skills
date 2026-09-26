// scripts/check-fallback.js and scripts/release.js both shell out to `bun`.
// Without this, a missing binary surfaces as a stream-chunk TypeError (spawnSync
// leaves stdout/stderr null) or a bare `spawnSync bun ENOENT`, neither of which
// tells a contributor to install Bun.
export const MISSING_BUN_MESSAGE = "bun not found on PATH. Install Bun (https://bun.sh) and retry.";

// Returns the install hint when `error` is a failed spawn of a missing binary,
// and null for every other failure so real errors keep their own message.
export function missingBunMessage(error) {
  return error && error.code === "ENOENT" ? MISSING_BUN_MESSAGE : null;
}
