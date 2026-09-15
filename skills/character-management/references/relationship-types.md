# Relationship Types Reference

Use these types in character frontmatter `relationships[].type` field.

## Family

| Type | Description |
|------|-------------|
| parent | Parent of the other character |
| child | Child of the other character |
| sibling | Brother or sister |
| spouse | Married partner |
| partner | Unmarried romantic partner |
| grandparent | Grandparent of the other character |
| grandchild | Grandchild of the other character |
| uncle | Uncle of the other character |
| aunt | Aunt of the other character |
| nephew | Nephew of the other character |
| niece | Niece of the other character |
| cousin | Cousin |
| in-law | Related by marriage (specify in notes) |

## Social

| Type | Description |
|------|-------------|
| friend | Close friend |
| ally | Allied but not necessarily close |
| rival | Competitive relationship |
| enemy | Hostile opposition |
| adversary | Named personal opposition with direct stakes |
| mentor | Teacher/guide figure |
| student | Learner/protege |
| employer | Boss or authority figure |
| former-supervisor | Former boss or authority figure |
| subordinate | Works under the other character |
| colleague | Works alongside |

## Story Role

| Type | Description |
|------|-------------|
| protagonist | Main character in opposition or partnership |
| antagonist | Primary opposition to this character |
| love-interest | Romantic interest |
| foil | Character who contrasts/highlights traits |
| confidant | Character they confide in |

## Usage

The type set is open and extensible: the CLI does not enum-check `relationships[].type`, so any kebab-case value passes `story validate`. Prefer a type from this reference when one fits; when none does, coin a descriptive kebab-case type (e.g. `former-supervisor`) and use it consistently on both sides.

Relationships are bidirectional. When adding a relationship to one character, add the inverse to the other:

- If A has `type: parent` to B, then B has `type: child` to A
- If A has `type: mentor` to B, then B has `type: student` to A
- If A has `type: rival` to B, then B has `type: rival` to A (symmetric)

Inverse pairs:
- parent <-> child
- grandparent <-> grandchild
- uncle/aunt <-> nephew/niece
- mentor <-> student
- employer <-> subordinate

Symmetric types (same both ways):
- sibling, spouse, partner, friend, ally, rival, enemy, adversary, cousin, colleague, foil, confidant, love-interest, former-supervisor
