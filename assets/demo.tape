# Renders assets/demo.gif with VHS (https://github.com/charmbracelet/vhs).
# Run from the repo root with Node 18+ on the PATH:
#   vhs assets/demo.tape
# The official Docker image lacks Node; add it with a one-line Dockerfile:
#   FROM ghcr.io/charmbracelet/vhs
#   RUN apt-get update && apt-get install -y nodejs
Output assets/demo.gif

Set Shell "bash"
Set FontSize 16
Set Width 1500
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
