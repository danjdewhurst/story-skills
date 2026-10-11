# Editor integration

This page is for writers who draft in a code editor and want the checks there as they type, instead of running `story check` in a terminal. `story lsp` is a language server: your editor starts it, and it underlines continuity, link, and frontmatter problems in the file you are editing, finds and renames characters and places, and completes ids in frontmatter. It works in any editor with a Language Server Protocol client. This page sets it up in VS Code, Neovim, Helix, and Emacs.

**On this page**

- [What you get](#what-you-get)
- [Before you start](#before-you-start)
- [VS Code](#vs-code)
- [Neovim](#neovim)
- [Helix](#helix)
- [Emacs](#emacs)
- [Other editors](#other-editors)
- [Troubleshooting](#troubleshooting)

## What you get

| In the editor | What happens |
|---|---|
| Problems as you type | Every [`story check`](cli-reference.md#check) finding, underlined where it points: `edran-vale` in a later chapter's `characters` list after he died, `planted: chapter-03` on a promise paid off in chapter 2. The project is checked again 300 ms after you stop typing, unsaved text included. |
| Go to definition | On an id such as `sera-voss` in `pov:` or `characters:`, or in a markdown link, opens `characters/sera-voss.md`. |
| Find references | Lists every chapter, scene, and file whose frontmatter names the entity, and every link to its file. |
| Hover | Shows the entity's name, kind, and status. In a chapter, a character also shows what they know by then and how their progressions have changed them, so you do not reveal something they have not learned. |
| Completion | In a field that takes ids, such as `characters:`, `pov:`, `locations:`, `planted:`, or `owner:`, offers the ids of the right kind. |
| Rename | Renames a character, place, or other entity everywhere, as [`story rename`](cli-reference.md#rename) does. Type a new id (`ilse-varrow`) to change only the id, or a new name (`Ilse Varrow`) to change the name and the id with it. |
| Quick fixes | Rebuild stale registries and update stale word counts from the warning itself. |

The server reads the project and never writes to it. Rename and the quick fixes come back as edits that your editor applies, so you can review them and undo them like any other change. The [CLI reference](cli-reference.md#lsp) has the details.

## Before you start

The editor runs the `story` command, so it must be on your `PATH`. Install it as [Getting started](getting-started.md#install-the-story-cli) describes, then check:

```shell
story --version
```

If you would rather not install it globally, every setup below can run another command instead, such as `npx --yes story-skills lsp`, or the bundled fallback that ships with the skills, `node <skills-dir>/story-maintenance/scripts/story.js lsp`.

Open the story project folder in the editor, or a folder that holds several projects, such as a series. Each file is checked with the nearest `story.md` at or above it.

## VS Code

The [Story Skills extension](https://github.com/danjdewhurst/story-skills/tree/main/editors/vscode) starts `story lsp` for markdown files. It is not on the Marketplace yet, so build it from a clone of this repository:

```shell
cd editors/vscode
npm install
npx @vscode/vsce package
code --install-extension story-skills-*.vsix
```

Reload VS Code and open a story project. Findings appear in the Problems panel. To run something other than `story`, set `story.server.command` and `story.server.args` in your settings:

```json
{
  "story.server.command": "npx",
  "story.server.args": ["--yes", "story-skills", "lsp"]
}
```

## Neovim

Neovim 0.11 and newer configure language servers without a plugin. Add this to your `init.lua`:

```lua
vim.lsp.config("story", {
  cmd = { "story", "lsp" },
  filetypes = { "markdown" },
  root_markers = { "story.md" },
})
vim.lsp.enable("story")
```

Diagnostics show inline. `gd` goes to a definition, `grr` lists references, `grn` renames, `gra` shows quick fixes, and `K` hovers.

## Helix

Add the server to `~/.config/helix/languages.toml` and list it for markdown. Keep any servers you already use for markdown in the list:

```toml
[language-server.story]
command = "story"
args = ["lsp"]

[[language]]
name = "markdown"
roots = ["story.md"]
language-servers = ["marksman", "story"]
```

Run `hx --health markdown` to check that Helix finds it.

## Emacs

Eglot, built into Emacs 29 and newer, needs one line in your init file:

```elisp
(with-eval-after-load 'eglot
  (add-to-list 'eglot-server-programs '((markdown-mode gfm-mode) . ("story" "lsp"))))
```

Open a chapter and run `M-x eglot`. Flymake shows the findings, `M-.` goes to a definition, `M-?` lists references, and `M-x eglot-rename` renames.

## Other editors

Any editor with a language server client can run the server: point it at the command `story lsp` for markdown files, talking over stdio. It reads the folders the editor opens and needs no settings.

## Troubleshooting

- **Nothing is underlined.** Check that the file is inside a folder with a `story.md` at or above it, and that `story --version` works in the shell the editor starts from. A GUI editor on macOS may not see the `PATH` your terminal sets; give the full path to `story`.
- **A finding points at the first line.** Its message names nothing in the file to point at, such as a registry that lacks an entry. The message says what to change.
- **Rename says it cannot move files.** The editor cannot create or delete files in an edit. Run [`story rename`](cli-reference.md#rename) in a terminal instead.
- **The server stopped.** The editor's language server log (in VS Code, the Story Skills output channel) shows why. Errors the server hits are logged there too.
