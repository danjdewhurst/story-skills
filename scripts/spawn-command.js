// On Windows, npm and the bins npm links into node_modules/.bin are .cmd
// shims. Since the CVE-2024-27980 fix (Node 18.20.2 and 20.12.2), Node will
// not spawn a .cmd or .bat file without a shell and fails with EINVAL, and a
// shell would parse every argument again. So on Windows these run node with
// the script the shim would run. Each returns the [command, args] pair to pass
// to execFileSync. `host` stands in for the process and the disk, so tests can
// ask for any platform.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function hostOf(host) {
  return {
    platform: process.platform,
    execPath: process.execPath,
    env: process.env,
    exists: (file) => fs.existsSync(file),
    readFile: (file) => fs.readFileSync(file, "utf8"),
    // npm-prefix.js prints npm's global prefix and nothing else.
    globalPrefix: (node, script) => execFileSync(node, [script], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(),
    ...host
  };
}

// Windows keeps PATH under any letter case, and a folder in it may be quoted.
function pathDirs(env) {
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH");
  return String(key === undefined ? "" : env[key])
    .split(";")
    .map((dir) => dir.trim().replace(/^"(.*)"$/, "$1"))
    .filter((dir) => dir !== "");
}

// The node to run a script with: this process when it is node, as it is for
// `node scripts/...`, or else the first node.exe on PATH, which is the node a
// shim falls back to. Under Bun, execPath is bun.exe.
function windowsNode({ execPath, env, exists }) {
  if (/^node(?:\.exe)?$/i.test(path.win32.basename(execPath))) {
    return execPath;
  }
  const found = pathDirs(env)
    .map((dir) => path.win32.join(dir, "node.exe"))
    .find((file) => exists(file));
  if (!found) {
    throw new Error(`Cannot find node.exe on PATH to run npm with (this process runs ${execPath})`);
  }
  return found;
}

// npm's CLI script. `npm run` names the one it runs in npm_execpath, but
// `bun run` names bun there, so only an absolute path to npm-cli.js counts.
// Otherwise this does what npm.cmd beside node.exe does: it asks that npm's
// npm-prefix.js for the global prefix and prefers the npm-cli.js under it
// (where `npm install -g npm` puts a newer npm) to its own.
function windowsNpmCli(node, { env, exists, globalPrefix }) {
  const named = env.npm_execpath ?? "";
  if (path.win32.isAbsolute(named) && path.win32.basename(named).toLowerCase() === "npm-cli.js" && exists(named)) {
    return named;
  }
  const npmBin = (dir) => path.win32.join(dir, "node_modules", "npm", "bin");
  const own = npmBin(path.win32.dirname(node));
  const prefixScript = path.win32.join(own, "npm-prefix.js");
  let prefix = "";
  if (exists(prefixScript)) {
    try {
      prefix = globalPrefix(node, prefixScript);
    } catch {
      // npm.cmd also falls back to its own npm when the lookup fails.
    }
  }
  const upgraded = prefix === "" ? null : path.win32.join(npmBin(prefix), "npm-cli.js");
  if (upgraded && exists(upgraded)) {
    return upgraded;
  }
  const cli = path.win32.join(own, "npm-cli.js");
  if (!exists(cli)) {
    throw new Error(`Cannot find npm: ${cli} does not exist. Install npm with Node.js, or run this with npm run`);
  }
  return cli;
}

// `command` and `args` as execFileSync can spawn them: on Windows npm becomes
// node and npm's CLI script. Every other command is left as it is; git, gh,
// and bun are .exe files there.
export function spawnCommand(command, args, host = {}) {
  const resolved = hostOf(host);
  if (command !== "npm" || resolved.platform !== "win32") {
    return [command, args];
  }
  const node = windowsNode(resolved);
  return [node, [windowsNpmCli(node, resolved), ...args]];
}

// The bin `name` of `packageName`, installed under `installDir`: the link npm
// makes in node_modules/.bin, or on Windows node and the script the package's
// bin field names. There it first reads npm's <name>.cmd shim, without running
// it, and checks that the shim runs that script with node, as a user's
// `story` does: a script that lost its node shebang gets a shim that does not.
export function packageBin(installDir, packageName, name, args, host = {}) {
  const resolved = hostOf(host);
  const binDir = path.join(installDir, "node_modules", ".bin");
  if (resolved.platform !== "win32") {
    return [path.join(binDir, name), args];
  }
  const packageDir = path.join(installDir, "node_modules", packageName);
  const target = JSON.parse(resolved.readFile(path.join(packageDir, "package.json"))).bin?.[name];
  if (typeof target !== "string") {
    throw new Error(`The installed ${packageName} has no "${name}" bin in its package.json`);
  }
  const script = path.resolve(packageDir, target);
  const inside = path.relative(packageDir, script);
  if (inside === "" || inside.split(/[\\/]/)[0] === ".." || path.isAbsolute(inside)) {
    throw new Error(`The installed ${packageName}'s "${name}" bin, ${target}, is not a file inside the package`);
  }
  checkShim(path.join(binDir, `${name}.cmd`), path.relative(binDir, script), resolved);
  return [windowsNode(resolved), [script, ...args]];
}

// npm's cmd-shim writes `SET "_prog=node"` for a script whose shebang names
// node, then starts "%_prog%" with the script's path from the shim's folder.
function checkShim(shim, fromShim, { exists, readFile }) {
  if (!exists(shim)) {
    throw new Error(`npm did not link ${shim}`);
  }
  const text = readFile(shim);
  const target = `"%dp0%\\${fromShim.split(/[\\/]/).join("\\")}"`;
  if (!/^\s*SET "_prog=node"\s*$/im.test(text) || !text.includes(`"%_prog%"`) || !text.includes(target)) {
    throw new Error(`${shim} does not run ${target} with node`);
  }
}
