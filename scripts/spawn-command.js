// On Windows, npm and the bins npm links into node_modules/.bin are .cmd
// shims. Since the CVE-2024-27980 fix (Node 18.20.2 and 20.12.2), Node will
// not spawn a .cmd or .bat file without a shell and fails with EINVAL, and a
// shell would parse every argument again. So on Windows these run node with
// the script the shim would run. Each returns the [command, args] pair to pass
// to execFileSync. `host` stands in for the process, so tests can ask for any
// platform.
import fs from "node:fs";
import path from "node:path";

function hostOf(host) {
  return { platform: process.platform, execPath: process.execPath, env: process.env, ...host };
}

// npm's CLI script, where npm.cmd finds it: beside node.exe. `npm run` names
// the script it runs in npm_execpath, but `bun run` names bun there, so the
// variable counts only when it names npm-cli.js.
function npmCli({ execPath, env }) {
  const named = env.npm_execpath ?? "";
  if (path.win32.basename(named).toLowerCase() === "npm-cli.js") {
    return named;
  }
  return path.win32.join(path.win32.dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js");
}

// `command` and `args` as execFileSync can spawn them: on Windows npm becomes
// node and npm's CLI script. Every other command is left as it is; git, gh,
// and bun are .exe files there.
export function spawnCommand(command, args, host = {}) {
  const resolved = hostOf(host);
  if (command !== "npm" || resolved.platform !== "win32") {
    return [command, args];
  }
  return [resolved.execPath, [npmCli(resolved), ...args]];
}

// The bin `name` of `packageName`, installed under `installDir`: the link npm
// makes in node_modules/.bin, or on Windows node and the script the package's
// bin field names, which is what the <name>.cmd shim runs.
export function packageBin(installDir, packageName, name, args, host = {}) {
  const { platform, execPath } = hostOf(host);
  if (platform !== "win32") {
    return [path.join(installDir, "node_modules", ".bin", name), args];
  }
  const packageDir = path.join(installDir, "node_modules", packageName);
  const script = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8")).bin?.[name];
  if (typeof script !== "string") {
    throw new Error(`The installed ${packageName} has no "${name}" bin in its package.json`);
  }
  return [execPath, [path.join(packageDir, script), ...args]];
}
