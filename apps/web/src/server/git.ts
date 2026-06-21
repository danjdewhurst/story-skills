import { spawnSync } from "node:child_process";

export function gitDiff(projectRoot: string) {
  const result = spawnSync("git", ["diff", "--", projectRoot], { cwd: projectRoot, encoding: "utf8" });
  return { ok: result.status === 0, stdout: result.stdout, stderr: result.stderr, exitCode: result.status ?? 1 };
}

export function gitStatus(projectRoot: string) {
  const result = spawnSync("git", ["status", "--short"], { cwd: projectRoot, encoding: "utf8" });
  return { ok: result.status === 0, stdout: result.stdout, stderr: result.stderr, exitCode: result.status ?? 1 };
}

export function discardProjectChanges(projectRoot: string) {
  const result = spawnSync("git", ["checkout", "--", "."], { cwd: projectRoot, encoding: "utf8" });
  return { ok: result.status === 0, stdout: result.stdout, stderr: result.stderr, exitCode: result.status ?? 1 };
}
