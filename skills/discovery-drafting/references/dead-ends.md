# Cutting Dead Ends

Discovery drafting produces dead ends: subplots that stall, characters who
arrive and do nothing, mysteries that turn out uninteresting. Cutting them
is the job — but in a bible-tracked project, cutting has bookkeeping.

## Recognizing a dead end

A thread is a dead end when it meets two of these:

- It has not advanced for **two consecutive chapters** despite appearing.
- Removing it changes nothing downstream (no promises depend on it, no
  character's arc needs it).
- The writer's interest in it is gone — and the reconcile loop's post-hoc
  notes say so explicitly. "Might be useful later" without a concrete plan
  is hoarding, not craft.

Distinguish a dead end from a **slow burn**: a slow burn has a planned
payoff recorded in `continuity/promises/` with a target chapter. If the
payoff exists in the ledger, the thread is alive — leave it.

## Cutting procedure

1. **Decide with the user.** Cutting is a story decision. Present: what the
   thread is, where it appears (chapters/scenes), what depends on it, and
   the recommendation (cut, fold, or keep).
2. **Choose the cut type:**
   - **Cut clean:** the thread never mattered. Remove its scenes' claims
     (or leave the scenes if they do other work) and mark its promise,
     question, or clue `status: abandoned` with a reason. Deleting the
     ledger file drops the record `story continuity` uses to skip ordering.
   - **Fold:** the thread's best element survives inside another thread
     (the interesting character joins an existing subplot; the clue becomes
     part of the main mystery). Record the fold in both threads' notes.
   - **Prune:** keep the thread but strip it to a single scene or mention —
     it becomes texture, not a thread.
3. **Bookkeeping (this is the part people skip):**
   - Mark removed promises/questions in `continuity/promises/` and
     `continuity/questions/` as `status: abandoned` with a reason — never
     just delete them. An abandoned record explains to future agents why the
     setup has no payoff; a deleted record looks like a forgotten setup.
   - Update affected scene records' `state-changes` if the cut removes a
     change other chapters assumed.
   - If a character is cut, set their file's `status: cut` and leave the
     file in place. `story reindex` rebuilds `characters/_index.md` from
     every character file, including `status: cut`, so the cut stays in
     that registry. Drop the character from casts, relationships, and arc
     `characters` lists.
   - Update `plot/timeline.md` for any removed events.
4. **Run maintenance:** `story reindex .`, `story links .`,
   `story validate .`, `story continuity .` — the checker should confirm
   nothing still references the cut thread.

## The darling log

Keep a `## Cut Threads` section in the project's notes (or in
`continuity/state.md` if the project prefers) listing every cut: what it
was, why it was cut, where its pieces went. Cut material is compost — a
folded character or a pruned subplot often returns in a later book. The log
is how the later book finds it.
