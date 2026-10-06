Story: "The Key on the Door" — quiet coastal mystery. story.md has `status: complete`. The author added characters/petra-lindqvist.md by hand this morning and revised chapters 1 and 2 yesterday.

The author: "I left that TODO in chapter 1 on purpose; I'll check the tide tables myself. I haven't decided whether the brass key pays off in this book or in book two."

Output of `story check .` (exit code 1):

```
Checks failed: 1 errors, 6 warnings, 0 dismissed
error: story.md is complete but continuity/promises/the-brass-key.md is still planted
warning: characters/_index.md does not list characters/petra-lindqvist.md; run story reindex [stale-registry]
warning: chapters/chapter-01.md declares 2140 words but contains 2318 [stale-word-count]
warning: chapters/chapter-01.md has 1 [TODO marker in its prose, which every build prints: resolve it or move it into an HTML comment [todo-markers]
warning: chapters/chapter-01.md has no machine-readable scene records [no-scene-records]
warning: chapters/chapter-02.md declares 1876 words but contains 1902 [stale-word-count]
warning: continuity/state.md current-chapter 1 is behind the latest chapter 2; update continuity state after drafting [current-chapter-behind]
```
