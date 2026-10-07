# Renders assets/screenshot-continuity.png, the Codex plugin screenshot: the
# last frame of assets/demo.tape as a still. Run it the way demo.tape's
# header shows, with this tape's path:
#   vhs assets/screenshot-continuity.tape
# It types while hidden and records no GIF, only the screenshot.

Set Shell "bash"
Set FontSize 16
Set Width 1680
Set Height 430
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 1ms

Hide
Type `alias story="node $PWD/bin/story.js" && cd examples && clear`
Enter
Type "grep died-in the-unraveled-thread/characters/edran-vale.md"
Enter
Type "grep -A2 '^characters:' the-unraveled-thread/chapters/chapter-04.md"
Enter
Type "story continuity the-unraveled-thread"
Enter
Sleep 3s
Show
Sleep 500ms
Screenshot assets/screenshot-continuity.png
Sleep 500ms
