# Renders assets/demo.gif with VHS (https://github.com/charmbracelet/vhs).
# Run from the repo root with Node 18+ on the PATH:
#   vhs assets/demo.tape
# The official Docker image lacks Node; mount a node binary into it (the
# binary itself, not a version manager's shim):
#   docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
#     -v /path/to/node:/usr/local/bin/node:ro -v "$PWD":/vhs -w /vhs \
#     ghcr.io/charmbracelet/vhs assets/demo.tape
# assets/screenshot-continuity.tape renders the still of the last frame.
Output assets/demo.gif

Set Shell "bash"
Set FontSize 16
Set Width 1680
Set Height 430
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms

Hide
Type `alias story="node $PWD/bin/story.js" && cd examples && clear`
Enter
Show

Type "grep died-in the-unraveled-thread/characters/edran-vale.md"
Sleep 400ms
Enter
Sleep 1.5s

Type "grep -A2 '^characters:' the-unraveled-thread/chapters/chapter-04.md"
Sleep 400ms
Enter
Sleep 2s

Type "story continuity the-unraveled-thread"
Sleep 400ms
Enter
Sleep 6s
