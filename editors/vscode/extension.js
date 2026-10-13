"use strict";

// Starts `story lsp` for markdown files and restarts it when its command
// changes. Everything else is the server's: see docs/editors.md.
const os = require("os");
const vscode = require("vscode");
const { LanguageClient } = require("vscode-languageclient/node");

let client;

function createClient() {
  const settings = vscode.workspace.getConfiguration("story.server");
  // No `transport`: the client then talks over stdio and adds no --stdio
  // argument, so the configured arguments are the whole command line.
  const command = settings.get("command", "story");
  const args = settings.get("args", ["lsp"]);
  // The server learns its folders from the editor, so it runs from the home
  // folder: on Windows a bare command is looked up in the working folder
  // first, and a story.exe in an opened project must not be the one found.
  // npm installs story and npx there as .cmd files, which only a shell
  // runs, so on Windows the command goes through one, with each part that
  // holds a space quoted.
  const windows = process.platform === "win32";
  const quote = (part) => (windows && /\s/.test(part) ? `"${part}"` : part);
  const server = { command: quote(command), args: args.map(quote), options: { cwd: os.homedir(), shell: windows } };
  return new LanguageClient("story", "Story Skills", { run: server, debug: server }, {
    documentSelector: [{ scheme: "file", language: "markdown" }]
  });
}

async function activate(context) {
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (event) => {
    if (event.affectsConfiguration("story.server")) {
      await client?.stop();
      client = createClient();
      await client.start();
    }
  }));
  client = createClient();
  await client.start();
}

function deactivate() {
  return client?.stop();
}

module.exports = { activate, deactivate };
