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
arcs-advanced:
  - {arc-kebab}
status: {outline|draft|revised|final|complete}
outcome: {yes|no|yes-but|no-and}
sequel: {true|false}
dilemma: "{The choice the POV character must make in the sequel}"
state-changes:
  - target: {character-or-artifact-kebab}
    change: "{What changed and must carry forward}"
---
```

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
