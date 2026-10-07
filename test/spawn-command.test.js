import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "./helpers.js";
import { packageBin, spawnCommand } from "../scripts/spawn-command.js";

// Since the CVE-2024-27980 fix, Node on Windows refuses to spawn a .cmd shim
// without a shell (EINVAL), so npm and package bins run as node and a script
// there (#573). Every case names its platform, so all of them run everywhere.

const windowsNode = "C:\\Program Files\\nodejs\\node.exe";
const besideNode = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";

describe("spawnCommand", () => {
  test("spawns npm and other commands as they are off Windows", () => {
    for (const platform of ["linux", "darwin"]) {
      const host = { platform, execPath: "/usr/bin/node", env: {} };
      expect(spawnCommand("npm", ["pack", "--json"], host)).toEqual(["npm", ["pack", "--json"]]);
      expect(spawnCommand("gh", ["auth", "status"], host)).toEqual(["gh", ["auth", "status"]]);
    }
  });

  test("runs npm on Windows as node and the npm-cli.js beside node.exe", () => {
    const host = { platform: "win32", execPath: windowsNode, env: {} };
    expect(spawnCommand("npm", ["view", "story-skills@1.0.0", "version"], host)).toEqual([
      windowsNode,
      [besideNode, "view", "story-skills@1.0.0", "version"]
    ]);
  });

  test("prefers the npm-cli.js that `npm run` names in npm_execpath", () => {
    const named = "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\npm\\bin\\npm-cli.js";
    const host = { platform: "win32", execPath: windowsNode, env: { npm_execpath: named } };
    expect(spawnCommand("npm", ["pack"], host)).toEqual([windowsNode, [named, "pack"]]);
  });

  test("ignores an npm_execpath that names another runner, as `bun run` does", () => {
    for (const npmExecpath of ["C:\\Users\\me\\.bun\\bin\\bun.exe", "C:\\tools\\pnpm.cjs", ""]) {
      const host = { platform: "win32", execPath: windowsNode, env: { npm_execpath: npmExecpath } };
      expect(spawnCommand("npm", ["pack"], host)).toEqual([windowsNode, [besideNode, "pack"]]);
    }
  });

  test("leaves .exe commands such as git, gh, and bun as they are on Windows", () => {
    const host = { platform: "win32", execPath: windowsNode, env: {} };
    for (const command of ["git", "gh", "bun", windowsNode]) {
      expect(spawnCommand(command, ["--version"], host)).toEqual([command, ["--version"]]);
    }
  });

  test("defaults to this process", () => {
    const expected = process.platform === "win32" ? process.execPath : "npm";
    expect(spawnCommand("npm", ["--version"])[0]).toBe(expected);
  });
});

describe("packageBin", () => {
  function install(bin) {
    const installDir = makeTempDir("story-spawn-bin-");
    const packageDir = path.join(installDir, "node_modules", "story-skills");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({ name: "story-skills", bin }));
    return { installDir, packageDir };
  }

  test("runs the node_modules/.bin link off Windows", () => {
    const { installDir } = install({ story: "bin/story.js" });
    expect(packageBin(installDir, "story-skills", "story", ["--version"], { platform: "linux" })).toEqual([
      path.join(installDir, "node_modules", ".bin", "story"),
      ["--version"]
    ]);
  });

  test("runs node and the bin field's script on Windows", () => {
    const { installDir, packageDir } = install({ story: "bin/story.js" });
    expect(packageBin(installDir, "story-skills", "story", ["validate", "book"], { platform: "win32", execPath: windowsNode })).toEqual([
      windowsNode,
      [path.join(packageDir, "bin", "story.js"), "validate", "book"]
    ]);
  });

  test("says so when the package has no bin of that name", () => {
    for (const bin of [undefined, {}, { other: "bin/other.js" }]) {
      const { installDir } = install(bin);
      expect(() => packageBin(installDir, "story-skills", "story", [], { platform: "win32" })).toThrow(
        'The installed story-skills has no "story" bin in its package.json'
      );
    }
  });
});
