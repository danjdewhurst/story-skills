# Location Template

Use this template when creating a new location file at `worldbuilding/locations/{location-name-kebab}.md`.

```yaml
---
name: "{Location Name}"
type: "{location-type, e.g. city, district, wilderness, submerged-ruin}"
region: "{Parent Region}"
population: {number or estimate}
controlled-by: {character-kebab or faction}
notable-characters:
  - {character-kebab}
tags:
  - {tag-1}
  - {tag-2}
status: "{location-status, e.g. thriving, declining, strained, exposed, unknown}"
---
```

`type` and `status` are free-form descriptive strings, not a closed set. Use the validator truth: any kebab-case or plain value passes `story validate`. Match existing example usage where it fits (e.g. `city`, `district`, `wilderness`, `submerged-ruin` for type; `thriving`, `declining`, `strained`, `exposed`, `unknown` for status).

## Description

What the location looks, sounds, smells, and feels like. First impressions for someone arriving. Key sensory details that make it distinct.

## History

How the location came to be and key events that happened here. Only include history relevant to the story.

## Culture & Customs

The people who live here, their way of life, traditions, social norms. What makes this place culturally distinct.

## Notable Features

Specific landmarks, buildings, natural features, or points of interest within the location. Things characters would interact with.

## Current State

What the location is like at the time of the story. Political situation, recent events, tensions, opportunities.
