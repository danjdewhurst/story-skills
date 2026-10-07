# Renders assets/demo.gif with VHS (https://github.com/charmbracelet/vhs).
# Run from the repo root with vhs and Node 18+ on the PATH:
#   vhs assets/demo.tape
# Or in Docker, with the image assets/vhs.Dockerfile builds. The run
# mounts the repo read-only and only assets/ writable:
#   docker build -t story-skills-vhs - < assets/vhs.Dockerfile
#   docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
#     -v "$PWD":/vhs:ro -v "$PWD/assets":/vhs/assets -w /vhs \
#     story-skills-vhs assets/demo.tape
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
