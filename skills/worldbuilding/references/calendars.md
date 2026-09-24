# Calendars, Seasons, and Moons

A secondary world with its own calendar needs one written record, or dates
drift: a festival lands in two different months, a full moon rises twice in
a week, the harvest comes before the thaw.

## Record the calendar as a system file

```shell
story add system "Reckoning of Vell" --type social
```

Fill `worldbuilding/systems/reckoning-of-vell.md` with:

```markdown
## Overview

Twelve months of 30 days plus five festival days at midwinter (365 days).
Years are counted from the Founding (AF).

## Rules & Limitations

| # | Month | Days | Season | Notes |
|---|-------|------|--------|-------|
| 1 | Thaw | 30 | spring | Year begins at the first thaw |
| 2 | Sowing | 30 | spring | |
| ... | | | | |
| 12 | Frost | 30 | winter | |
| - | Hollow Days | 5 | winter | Festival; not part of any month |

- Week: 6 days (Firstday ... Restday). Markets on Firstday.
- Day: dawn bell, noon bell, dusk bell; hours not counted by commoners.
- Moons: Ser (29-day cycle), Oda (41-day cycle). Both full on 1 Thaw 412 AF.
- Leap rule: none.

## Conversion

Scene `date` field = ISO bookkeeping date. 1 Thaw 412 AF = 2001-03-01.
```

Keep holidays, market days, tides, and anything the plot hangs on in the
same file.

## Dating scenes

The CLI's `date` fields accept only `YYYY-MM-DD`, and `story continuity`,
`story timeline`, and the route check compute elapsed time from them. For
an invented calendar, map in-world days onto ISO dates with a fixed offset:

1. Pick an anchor: the first in-world day of the story equals an ISO date
   (`1 Thaw 412 AF = 2001-03-01`). Record it under `## Conversion`.
2. Count days, not months. If in-world months differ from Gregorian ones,
   convert through the day number: story day 45 is the anchor plus 44 days.
3. Put the ISO date in the scene or chapter `date` field and the in-world
   date in the prose or the scene body. Use `time` for the time of day.
4. Keep a small conversion table under `## Conversion` for dates the story
   uses often (festivals, deadlines, full moons).

The ISO date is a bookkeeping device; readers never see it. What matters is
that elapsed days are right, so the travel check and timeline ordering work.

## Seasons and daylight

Record for each season: day length, weather, what grows, what travel is
possible (passes closed, rivers frozen or in flood), and what work people
are doing. Route `hours` assume normal conditions; note seasonal exceptions
in the location body.

## Moons and cycles

For each moon or cycle, record its period in days and one date when it was
full (or at any fixed phase). The phase on day N is
`(N - known full day) mod period`. Check any scene that mentions moonlight,
tides, or a moon-bound ritual against this. Two moons align every
least common multiple of their periods (29 and 41 days: every 1,189 days),
which makes a good rare event.

## Checking

- `story timeline .` lists dated scenes in story-time order and flags scenes
  read after events that happen later.
- `story diagram timeline` prints a Mermaid timeline of dated scenes and
  chapters.
- `story continuity .` checks clock order, `travel-hours`, and routes. It
  reads scene `date`, `time`, `location`, `characters`, and `pov`; chapter
  dates do not feed the route check. A named time is a span (`morning` is
  05:00-11:59), an untimed scene spans its whole day, and only journeys
  impossible on every reading are errors. `travel-hours` on a scene is the
  minimum time since the previous dated scene in chapter order, not a
  journey within the scene.

After adding or changing the calendar system, run `story reindex .`,
`story links .`, and `story validate .`.
