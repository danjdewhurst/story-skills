import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fakeWindowsNpm, makeTempDir } from "./helpers.js";
import { releaseDeps } from "../scripts/release.js";
import { packageBin, spawnCommand } from "../scripts/spawn-command.js";

// Since the CVE-2024-27980 fix, Node on Windows refuses to spawn a .cmd shim
// without a shell (EINVAL), so npm and package bins run as node and a script
// there (#573). Every case names its platform, so all of them run everywhere.

const nodeDir = "C:\\Program Files\\nodejs";
const windowsNode = `${nodeDir}\\node.exe`;
const npmBin = `${nodeDir}\\node_modules\\npm\\bin`;
const besideNode = `${npmBin}\\npm-cli.js`;
const prefixScript = `${npmBin}\\npm-prefix.js`;
const globalPrefix = "C:\\Users\\me\\AppData\\Roaming\\npm";
const upgraded = `${globalPrefix}\\node_modules\\npm\\bin\\npm-cli.js`;

// A Windows host whose disk holds `files`. `prefix` answers npm-prefix.js and
// records each lookup in `lookups`.
function windows({ execPath = windowsNode, env = {}, files = [besideNode, prefixScript], prefix = () => globalPrefix } = {}) {
  const lookups = [];
  return {
    lookups,
    host: {
      platform: "win32",
      execPath,
      env,
      exists: (file) => files.includes(file),
      globalPrefix: (node, script) => {
        lookups.push([node, script]);
        return prefix();
      }
    }
  };
}

describe("spawnCommand", () => {
  test("spawns npm and other commands as they are off Windows", () => {
    for (const platform of ["linux", "darwin"]) {
      const host = { platform, execPath: "/usr/bin/node", env: {} };
      expect(spawnCommand("npm", ["pack", "--json"], host)).toEqual(["npm", ["pack", "--json"]]);
      expect(spawnCommand("gh", ["auth", "status"], host)).toEqual(["gh", ["auth", "status"]]);
    }
    expect(spawnCommand("git", ["status"])).toEqual(["git", ["status"]]);
  });

  test("leaves .exe commands such as git, gh, and bun as they are on Windows", () => {
    for (const command of ["git", "gh", "bun", windowsNode]) {
      expect(spawnCommand(command, ["--version"], windows().host)).toEqual([command, ["--version"]]);
    }
  });

  test("runs npm on Windows as node and the npm-cli.js beside node.exe", () => {
    const { host, lookups } = windows();
    expect(spawnCommand("npm", ["view", "story-skills@1.0.0", "version"], host)).toEqual([
      windowsNode,
      [besideNode, "view", "story-skills@1.0.0", "version"]
    ]);
    // npm.cmd asks its own npm-prefix.js for the global prefix first.
    expect(lookups).toEqual([[windowsNode, prefixScript]]);
  });

  test("prefers a newer npm under the global prefix, as npm.cmd does", () => {
    const { host } = windows({ files: [besideNode, prefixScript, upgraded] });
    expect(spawnCommand("npm", ["pack"], host)).toEqual([windowsNode, [upgraded, "pack"]]);
  });

  test("falls back to the npm beside node.exe when the prefix lookup cannot run or fails", () => {
    const noPrefixScript = windows({ files: [besideNode, upgraded] });
    expect(spawnCommand("npm", ["pack"], noPrefixScript.host)).toEqual([windowsNode, [besideNode, "pack"]]);
    expect(noPrefixScript.lookups).toEqual([]);
    const failing = windows({ files: [besideNode, prefixScript, upgraded], prefix: () => { throw new Error("config error"); } });
    expect(spawnCommand("npm", ["pack"], failing.host)).toEqual([windowsNode, [besideNode, "pack"]]);
    const empty = windows({ files: [besideNode, prefixScript], prefix: () => "" });
    expect(spawnCommand("npm", ["pack"], empty.host)).toEqual([windowsNode, [besideNode, "pack"]]);
  });

  test("uses the npm-cli.js that `npm run` names in npm_execpath", () => {
    const named = "D:\\tools\\npm\\node_modules\\npm\\bin\\npm-cli.js";
    const { host, lookups } = windows({ env: { npm_execpath: named }, files: [named, besideNode, prefixScript] });
    expect(spawnCommand("npm", ["pack"], host)).toEqual([windowsNode, [named, "pack"]]);
    expect(lookups).toEqual([]);
  });

  test("ignores an npm_execpath that is relative, missing, or another runner, as `bun run` sets", () => {
    for (const npmExecpath of ["npm-cli.js", "node_modules\\npm\\bin\\npm-cli.js", "D:\\gone\\npm-cli.js", "C:\\Users\\me\\.bun\\bin\\bun.exe", "C:\\tools\\pnpm.cjs", ""]) {
      const { host } = windows({ env: { npm_execpath: npmExecpath }, files: [besideNode, "npm-cli.js", "node_modules\\npm\\bin\\npm-cli.js"] });
      expect(spawnCommand("npm", ["pack"], host)).toEqual([windowsNode, [besideNode, "pack"]]);
    }
  });

  test("finds node.exe on PATH when this process is not node, as under Bun", () => {
    const pathNode = "D:\\node 22\\node.exe";
    const pathNpm = "D:\\node 22\\node_modules\\npm\\bin\\npm-cli.js";
    const { host, lookups } = windows({
      execPath: "C:\\Users\\me\\.bun\\bin\\bun.exe",
      env: { Path: `C:\\Windows\\system32;;"D:\\node 22";${nodeDir}` },
      files: [pathNode, pathNpm, "D:\\node 22\\node_modules\\npm\\bin\\npm-prefix.js", windowsNode, besideNode],
      prefix: () => "D:\\node 22"
    });
    expect(spawnCommand("npm", ["pack"], host)).toEqual([pathNode, [pathNpm, "pack"]]);
    expect(lookups).toEqual([[pathNode, "D:\\node 22\\node_modules\\npm\\bin\\npm-prefix.js"]]);
  });

  test("says so when it cannot find node or npm", () => {
    const bun = windows({ execPath: "C:\\bun\\bun.exe", env: { PATH: "C:\\Windows" } });
    expect(() => spawnCommand("npm", ["pack"], bun.host)).toThrow("Cannot find node.exe on PATH to run npm with (this process runs C:\\bun\\bun.exe)");
    const noNpm = windows({ files: [] });
    expect(() => spawnCommand("npm", ["pack"], noNpm.host)).toThrow(`Cannot find npm: ${besideNode} does not exist. Install npm with Node.js, or run this with npm run`);
  });

  test("the release script's default runner spawns npm this way on the host it is given", () => {
    const npm = fakeWindowsNpm("9.9.9\n");
    const deps = releaseDeps({ root: makeTempDir("story-release-root-"), host: npm.host });
    expect(deps.run("npm", ["view", "story-skills@1.0.0", "version"])).toBe("9.9.9\n");
    expect(npm.calls()).toEqual([["view", "story-skills@1.0.0", "version"]]);
  });
});

describe("packageBin", () => {
  const shimFor = (fromShim) =>
    [
      "@ECHO off", "GOTO start", ":find_dp0", "SET dp0=%~dp0", "EXIT /b", ":start", "SETLOCAL", "CALL :find_dp0", "",
      'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ") ELSE (", '  SET "_prog=node"', "  SET PATHEXT=%PATHEXT:;.JS;=;%", ")", "",
      `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${fromShim}" %*`
    ].join("\r\n");

  // An install of story-skills with `bin` in its package.json and, unless
  // `shim` is null, npm's story.cmd shim (cmd-shim's output for a node script).
  function install(bin, { shim = shimFor("..\\story-skills\\bin\\story.js") } = {}) {
    const installDir = makeTempDir("story-spawn-bin-");
    const packageDir = path.join(installDir, "node_modules", "story-skills");
    fs.mkdirSync(path.join(installDir, "node_modules", ".bin"), { recursive: true });
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({ name: "story-skills", bin }));
    if (shim !== null) fs.writeFileSync(path.join(installDir, "node_modules", ".bin", "story.cmd"), shim);
    return { installDir, packageDir, shim: path.join(installDir, "node_modules", ".bin", "story.cmd") };
  }

  test("runs the node_modules/.bin link off Windows", () => {
    const { installDir } = install({ story: "bin/story.js" });
    expect(packageBin(installDir, "story-skills", "story", ["--version"], { platform: "linux" })).toEqual([
      path.join(installDir, "node_modules", ".bin", "story"),
      ["--version"]
    ]);
  });

  test("runs node and the bin field's script on Windows once the shim checks out", () => {
    const { installDir, packageDir } = install({ story: "./bin/story.js" });
    expect(packageBin(installDir, "story-skills", "story", ["validate", "book"], { platform: "win32", execPath: windowsNode })).toEqual([
      windowsNode,
      [path.join(packageDir, "bin", "story.js"), "validate", "book"]
    ]);
  });

  test("runs the node.exe on PATH when this process is not node", () => {
    const { installDir, packageDir } = install({ story: "bin/story.js" });
    const host = {
      platform: "win32",
      execPath: "C:\\bun\\bun.exe",
      env: { PATH: "D:\\node" },
      exists: (file) => file === "D:\\node\\node.exe" || fs.existsSync(file)
    };
    expect(packageBin(installDir, "story-skills", "story", [], host)).toEqual(["D:\\node\\node.exe", [path.join(packageDir, "bin", "story.js")]]);
  });

  test("says so when the package has no bin of that name", () => {
    for (const bin of [undefined, {}, { other: "bin/other.js" }]) {
      const { installDir } = install(bin);
      expect(() => packageBin(installDir, "story-skills", "story", [], { platform: "win32", execPath: windowsNode })).toThrow(
        'The installed story-skills has no "story" bin in its package.json'
      );
    }
  });

  test("refuses a bin that points outside the package", () => {
    for (const target of ["../evil.js", "bin/../../evil.js", path.resolve("/evil.js"), "", "."]) {
      const { installDir } = install({ story: target });
      expect(() => packageBin(installDir, "story-skills", "story", [], { platform: "win32", execPath: windowsNode })).toThrow(
        `The installed story-skills's "story" bin, ${target}, is not a file inside the package`
      );
    }
  });

  test("refuses a missing story.cmd, or one that does not run the script with node", () => {
    const host = { platform: "win32", execPath: windowsNode };
    const missing = install({ story: "bin/story.js" }, { shim: null });
    expect(() => packageBin(missing.installDir, "story-skills", "story", [], host)).toThrow(`npm did not link ${missing.shim}`);
    const broken = [
      // cmd-shim's output for a script without a node shebang: it runs the file as it is.
      ["@ECHO off", "GOTO start", ":find_dp0", "SET dp0=%~dp0", "EXIT /b", ":start", "SETLOCAL", "CALL :find_dp0", '"%dp0%\\..\\story-skills\\bin\\story.js"   %*'].join("\r\n"),
      shimFor("..\\story-skills\\bin\\other.js"),
      shimFor("..\\story-skills\\bin\\story.js").replace('SET "_prog=node"', 'SET "_prog=bun"')
    ];
    for (const shim of broken) {
      const { installDir, shim: shimPath } = install({ story: "bin/story.js" }, { shim });
      expect(() => packageBin(installDir, "story-skills", "story", [], host)).toThrow(
        `${shimPath} does not run "%dp0%\\..\\story-skills\\bin\\story.js" with node`
      );
    }
  });
});
