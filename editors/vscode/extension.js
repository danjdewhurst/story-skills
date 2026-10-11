"use strict";

// Starts `story lsp` for markdown files and restarts it when its command
// changes. Everything else is the server's: see docs/editors.md.
const vscode = require("vscode");
const { LanguageClient } = require("vscode-languageclient/node");

let client;

function createClient() {
  const settings = vscode.workspace.getConfiguration("story.server");
  // No `transport`: the client then talks over stdio and adds no --stdio
  // argument, so the configured arguments are the whole command line.
  const server = { command: settings.get("command", "story"), args: settings.get("args", ["lsp"]) };
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
