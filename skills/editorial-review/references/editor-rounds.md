# Editor Rounds and Review Copies

A human editor works in their own tools, usually Word with Track Changes.
The markdown project stays the source of truth: every round goes out as a
built file and comes back as edits the author accepts, transferred into
the chapter files.

## Types of edit

| Round | Editor delivers | Where it goes |
|-------|-----------------|---------------|
| Developmental / structural | Editorial letter, margin notes | `feedback-triage` (as a feedback round), then `revision-continuity` |
| Line edit | Tracked changes and comments | Accept in Word, transfer accepted text; see `line-editing` for the agent's own pass |
| Copyedit | Tracked changes, queries, a style sheet | Transfer text; merge their style sheet into `style-sheet.md` |
| Proofread | Marked-up PDF or HTML notes | Fix in markdown, rebuild, check again |

## Sending a round

1. Settle the chapters first: `story validate .`, `story links .`,
   `story wordcount . --write`.
2. With the user's approval, commit and tag the version sent, so the
   return can be compared against it:

   ```shell
   git add -A && git commit -m "Manuscript sent to editor, round 1" && git tag sent-to-editor-1
   ```

   Never push, move, or delete tags without approval. Without git,
   copy the project folder beside it (`../{project}-sent-to-editor-1`).
3. Build what the editor asked for:

   ```shell
   story build . --format docx          # Word, for tracked changes
   story build . --format docx --shunn  # Word in manuscript format
   story build . --format html          # single-file reading copy with paragraph anchors
   ```

4. Tell the user where the file was written (`dist/`) and what to send
   with it: the style sheet, the synopsis, and specific questions.

## Taking edits back

1. The author reviews tracked changes in Word and accepts or rejects
   each. The agent does not decide which edits to accept.
2. If the author shares the returned DOCX, read it with a DOCX-capable
   tool. Transfer accepted text into each chapter's markdown by hand,
   chapter by chapter; never convert the whole DOCX back over the
   project, which would drop frontmatter, scene structure, and metadata.
3. Open comments and queries become a list: wording queries to
   `line-editing`, story and continuity queries to `revision-continuity`,
   big-picture notes to `feedback-triage`.
4. Merge the editor's style decisions into `style-sheet.md`.
5. Report how much changed:

   ```shell
   story compare . --ref sent-to-editor-1
   ```

   The report lists each chapter's word change, added and removed
   chapters, and the share of paragraphs unchanged.
6. Run CLI Maintenance, then, with approval, tag the result
   (`editor-round-1-done`) before the next round.

## Review copies with paragraph anchors

`story build . --format html` writes one self-contained file with a
table of contents and a paragraph anchor on every paragraph: `ch03-p12` is
chapter 3, paragraph 12. Reviewers cite the anchor in an email, comment,
or issue, and the note points at an exact paragraph whatever format the
reader happens to be reading.

Anchors are counted in the built copy. After a revision, paragraph
numbers can shift; tell reviewers which build date their notes refer to,
and resolve notes against the matching tag with `story compare`.

For GitHub-hosted projects, the Story Skills repository's
`templates/github/review-copy.yml` workflow rebuilds the HTML copy on
every push to `main` and publishes it to GitHub Pages (and as a workflow
artifact), so readers always have a current link.
`templates/github/ISSUE_TEMPLATE/manuscript-note.yml` gives readers an
issue form with the anchor, a note type (typo, confusion, continuity,
sensitivity, praise, other), and the note. Collect those issues into a
`feedback/round-{N}/` file per reader and triage them with
`feedback-triage`. Pages sites can be public; confirm visibility with the
user before enabling it.
