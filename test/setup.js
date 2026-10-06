import { afterEach, setDefaultTimeout } from "bun:test";
import { removeTempDirs } from "./helpers.js";

// Preloaded by bunfig.toml, so these apply to every test file, locally and in
// every CI job.

// Bun's 5s default is too tight for a slow CI runner, where file-system calls
// can be several times slower (#433, #464). Bun 1.4.2 ignores a [test] timeout
// in bunfig.toml, so set it here; it also beats a --timeout flag.
setDefaultTimeout(60_000);

// Remove each test's temp dirs as soon as it finishes, so no single hook has
// to delete the whole run's dirs at once (#464).
afterEach(removeTempDirs);
