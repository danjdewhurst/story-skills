import { afterAll } from "bun:test";
import { removeTempDirs } from "./helpers.js";

// Preloaded by bunfig.toml, so this hook runs once after every test file.
afterAll(removeTempDirs);
