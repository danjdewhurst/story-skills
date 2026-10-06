import { afterEach } from "bun:test";
import { removeTempDirs } from "./helpers.js";

// Preloaded by bunfig.toml, so this hook runs after every test in every file.
// Removing each test's temp dirs as soon as it finishes means no single hook
// has to delete the whole run's dirs at once, which timed out on a slow CI
// runner (#464). The per-test timeout lives in the package.json test scripts:
// Bun 1.4.2 ignores [test] timeout in bunfig.toml, and setDefaultTimeout here
// would reach only the first test file.
afterEach(removeTempDirs);
