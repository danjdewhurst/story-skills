#!/usr/bin/env node
import { handleOutputError, runCli } from "../src/cli.js";

// A closed pipe (`story prose | head`) or a full disk surfaces as an 'error'
// event on the stream (Node) or an uncaught throw (Bun). Either way, exit
// quietly on a closed pipe and with a one-line message otherwise.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error) => handleOutputError(error, process));
}
process.on("uncaughtException", (error) => handleOutputError(error, process));

process.exitCode = runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: process.stdout,
  stderr: process.stderr
});
