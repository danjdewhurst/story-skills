# Character Template

Use this template when creating a new character file at `characters/{character-name-kebab}.md`.

```yaml
---
name: "{Full Name}"
role: {protagonist|antagonist|supporting|minor}
age: {age}
status: {alive|deceased|unknown}
died-in: {chapter-NN}
aliases:
  - "{Alias 1}"
relationships:
  - character: {other-character-kebab}
    type: {relationship-type}
locations:
  - {location-kebab}
tags:
  - {tag-1}
  - {tag-2}
arc: {character-arc-theme}
---
```

`died-in` is optional. Set it (with `status: deceased`) when a character dies on the page so `story continuity` can flag appearances in later chapters; leave it out for characters who died before the story begins. Posthumous appearances in flashbacks, memories, or recordings belong in chapter/scene `mentions`, not `characters`.

## Appearance

Physical description: build, height, distinguishing features, typical clothing, how they carry themselves.

## Personality & Traits

Core personality traits, temperament, habits, quirks. What makes them memorable in a scene.

## Backstory

Key events that shaped who they are. Only include what's relevant to the story.

## Motivations & Goals

What drives them. What they want (external goal) and what they need (internal goal). How these conflict.

## Location References

Important places tied to this character. Keep this list in sync with `notable-characters` in location files.

## Voice & Speech Patterns

How they talk: vocabulary level, sentence length, verbal tics, dialect, tone. Include 2-3 example lines of dialogue that capture their voice.

Example:
> "I didn't come here to make friends. I came here because someone has to clean up this mess."

## Character Arc

- **Starting state:** Where they begin emotionally/psychologically
- **Key turning points:** What changes them
- **Ending state:** Where they end up (or projected end)

## Timeline

Key life events in chronological order:

| When | Event | Relevance |
|------|-------|-----------|
| | | |
