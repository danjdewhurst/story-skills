---
name: feedback-triage
description: This skill should be used when the user asks to "process beta reader feedback", "alpha reader feedback", "feedback round", "synthesize reader feedback", "reader notes", "beta feedback", "readiness check", or wants to collect, reconcile, and act on external reader feedback for a story project.
---

# Feedback Triage

## Overview

Process alpha/beta reader feedback as a structured, reconcilable workflow:
collect per-reader feedback files, hold all revision until the round is
complete, synthesize convergent/divergent/single-reader findings into a
decision record with a readiness verdict, and hand a concrete revision plan
to the `revision-continuity` skill.

## Prerequisites

A story project with at least one drafted chapter (or a complete draft) that
readers have read. Verify `story.md` exists in the project root.

## When to Use

- Starting a feedback round (recruiting readers, sending chapters out)
- Recording feedback as it arrives
- Synthesizing a completed round into decisions
- NOT for revising the manuscript (use `revision-continuity` with the
  synthesis's revision plan)
- NOT for the agent's own critique of the draft (use `revision-continuity`
  audits; reader feedback is external input)

## Workflow

### 1. Set up the round

1. Decide the round scope: which chapters readers get (`chapters-read` range)
   and how many readers (2–4 per round is typical; one reader is a data
   point, not a round).
2. Create the round folder: `feedback/round-{N}/`.
3. For each expected reader, create a stub file from
   `references/feedback-template.md` at
   `feedback/round-{N}/{reader-kebab}.md` with frontmatter filled in and the
   body sections empty. The stub list is the round's checklist.

### 2. Collect feedback (the discipline)

1. As each reader's notes arrive, record them in their file using the
   template. Quote or closely paraphrase; do not editorialize yet.
2. Run the **canon check** on each problem note: verified against the bible,
   contradicts canon (usually a setup problem — note the canon file), or
   outside canon scope. Record the result in the file.
3. **Do NOT revise until all feedback for the round is in.** Revising on
   partial feedback optimizes for the first reader and invalidates the
   others' reads. If a reader is late, either wait or formally close the
   round without them (note it in the synthesis) — never silently proceed
   on a partial set.

### 3. Synthesize

Only when every expected reader file is collected:

1. Read all reader files for the round.
2. Sort every finding into exactly one category:
   - **Convergent** — ≥2 readers agree independently. Strongest signal;
     becomes a revision item by default.
   - **Divergent** — readers disagree. Adjudicate: check both sides against
     canon and premise, record which side wins and why.
   - **Single-reader** — one reader only. Weigh by specificity:
     specific + canon-verifiable → investigate or accept; vague +
     taste-based → usually decline.
   - **Declined-with-reason** — explicitly rejected, with a recorded reason
     referencing canon, premise, genre contract, or craft principle.
3. Write `feedback/round-{N}/synthesis.md` using
   `references/synthesis-template.md`, including the frontmatter readiness
   verdict: `ready` | `needs-revision` | `not-ready`.
4. Build the numbered revision plan with concrete file targets.

### 4. Hand off the revision plan

1. Present the synthesis summary and readiness verdict to the user.
2. If the verdict is `needs-revision` or `not-ready`, hand the revision
   plan to the `revision-continuity` skill for execution. The synthesis is
   the input; revision-continuity owns the edits.
3. If the verdict is `ready`, the round is closed — proceed to the next
   round, the next drafting stage, export, or the `submission` skill.

## Conventions

- Feedback lives under `feedback/round-{N}/`; `{N}` is a plain integer
  (`round-1`, `round-2`).
- Reader files use kebab-case reader ids: `feedback/round-1/maria-chen.md`.
- Every feedback file and the synthesis carry YAML frontmatter
  (`reader`, `round`, `chapters-read`, `overall-verdict` / `readers`,
  `readiness`).
- Findings are quoted or closely paraphrased from readers, never invented.
  If a note is ambiguous, mark it ambiguous in the file rather than
  resolving it silently.
- Declined findings always carry a recorded reason. A synthesis with
  unexplained rejections is incomplete.
- Bidirectional discipline: when synthesis creates or resolves
  `continuity/questions/` entries (reader confusion often reveals clarity
  gaps), update those files too.

## CLI Maintenance

Use the Story CLI when it is available. If `story` is not installed, use `bun run story --` from the Story Skills repository checkout or the bundled fallback `node ../story-maintenance/scripts/story.js` with the same arguments, resolving the path relative to this skill folder. If no CLI is available, perform the registry, backlink, and word-count checks manually.

After creating or updating feedback files and synthesis:

```shell
story reindex .
story links .
story validate .
story continuity .
```

## Reference Files

- **`references/feedback-template.md`** - Per-reader feedback file template with frontmatter (`reader`, `round`, `chapters-read`, `overall-verdict`) and canon-check discipline
- **`references/synthesis-template.md`** - Round synthesis template: convergent/divergent/single-reader/declined-with-reason categories, readiness verdict, revision plan
