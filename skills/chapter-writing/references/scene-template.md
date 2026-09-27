# Scene Template

Use this template when creating a machine-readable scene file at `scenes/chapter-{NN}-scene-{NN}.md`.

```yaml
---
title: "{Scene Title}"
chapter: chapter-{NN}
scene: {N}
pov: {character-kebab}
location: {location-kebab}
characters:
  - {character-kebab}
mentions:
  - {referenced-character-kebab}
arcs-advanced:
  - {arc-kebab}
status: {outline|draft|revised|final|complete}
date: {YYYY-MM-DD}
time: "{HH:MM}"
travel-hours: {N}
outcome: {yes|no|yes-but|no-and}
sequel: {true|false}
dilemma: "{The choice the POV character must make in the sequel}"
state-changes:
  - target: {character-or-artifact-kebab}
    change: "{What changed and must carry forward}"
---
```

`date` and `time` place the scene on the story clock. Set them as soon as the scene's moment is settled: `story timeline` lists undated scenes separately, and `story continuity` runs its clock and travel checks (scenes out of order, a character reaching a location faster than the location `routes` allow) only on dated scenes, so leaving them blank switches those checks off without a warning. `date` is `YYYY-MM-DD`; `time` is a quoted `"HH:MM"` or one of `dawn`, `morning`, `midday`, `afternoon`, `evening`, `night`. `travel-hours` is optional: a plain number (not quoted) of hours the POV character needed to travel since the previous scene. Leave it out when no journey happens; `story continuity` errors when the timestamps allow less. `mentions` lists characters who are only referenced or remembered in the scene.

`outcome` is optional: whether the POV character gets what they want in the scene. `yes-but` and `no-and` are the complicating outcomes; `story pacing` warns after three or more consecutive `yes` outcomes. Leave it out for sequel scenes, which react rather than pursue a goal. `sequel` and `dilemma` are optional. Set `sequel: true` when the scene is the reaction half of the scene/sequel unit; leave them out for ordinary action scenes.

## Purpose

What this scene changes for plot, character, theme, or reader knowledge.

## Sequel

For `sequel: true` scenes — the reaction → dilemma → decision half that follows a scene ending in a setback:

- **Reaction:** How the POV character processes the setback emotionally
- **Dilemma:** The impossible choice they face between the options available
- **Decision:** What they decide to do next — the goal that launches the following scene

## Continuity Notes

Track character state, object state, knowledge, timing, and location facts that later chapters must preserve.
