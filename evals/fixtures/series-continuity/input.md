Story: "The Key on the Door" — quiet coastal mystery, Greywidow Light. Book one is complete, in `../the-key-on-the-door`. Book two, "The Second Winter", is a sequel set the spring after book one ends; it was just created beside it with `story init "The Second Winter" --follows ../the-key-on-the-door`.

Shared canon the sequel must keep:
- Keeper Tomas Reyes (`tomas-reyes`) held Greywidow Light (`greywidow-light`) 31 years; his wife Ana (`ana-reyes`) died four winters before book one, when a storm kept the supply boat from the rock.
- The lamp is a first-order Fresnel lens, paraffin-fired. Tomas refused the Board's electric conversion twice.
- Petra Lindqvist (`petra-lindqvist`) skippers the supply boat; she calls every second Thursday.
- The brass key was found on the lamp-room door; who left it is still open at the end of book one, and book two does not answer it.
- Ana's sea-chest in the lamp room stays shut at the end of book one.

Book one's `continuity/state.md` frontmatter at its end:

```yaml
type: continuity-state
story: the-key-on-the-door
current-chapter: 12
character-state:
  - character: tomas-reyes
    location: greywidow-light
object-state:
  - artifact: brass-key
    owner: tomas-reyes
    location: greywidow-light
    status: active
    since: chapter-01
  - artifact: anas-sea-chest
    owner: tomas-reyes
    location: greywidow-light
    status: active
knowledge-state:
  - character: tomas-reyes
    knows: Someone left a brass key on the lamp-room door
    fact: key-on-the-door
    learned-in: chapter-01
  - character: tomas-reyes
    knows: The Board wants the lamp converted to electric
    fact: board-wants-conversion
    learned-in: chapter-04
```

Write book two's `## Series Notes` section for its `story.md` and the frontmatter of its opening `continuity/state.md`, so a new draft cannot contradict this canon. Name no new characters, add no new history, resolve nothing.
