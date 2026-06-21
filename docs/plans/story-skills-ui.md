# Story Skills UI Implementation Plan

> For Hermes: Use subagent-driven-development skill to implement this plan task-by-task.

Goal: Build a web UI around Story Skills that lets a writer initialise, plan, draft, revise, validate, and export a markdown-first story project while controlling the underlying agent workflow.

Architecture: Keep Story Skills as the source of truth: markdown files, YAML frontmatter, registries, and the existing `story` CLI remain canonical. Add a separate web app/orchestrator layer that reads and writes those projects, calls deterministic CLI operations directly, and delegates creative work to Codex, Anthropic, or OpenCode-backed agent runners with the Story Skills skill loaded into each run. The UI should make the agent loop inspectable and interruptible rather than hiding it behind one big “generate book” button.

Tech Stack: Bun/Node 18+, TypeScript, React/Next.js or TanStack Start, SQLite for session/job metadata, filesystem-backed story workspaces, existing `src/story.js` CLI library, optional `@anthropic-ai/sdk`, `openai`/Codex CLI, `opencode-ai` CLI/server, and a provider-neutral runner interface.

---

## Verified Current State

Repository: `danjdewhurst/story-skills`, cloned at `/home/dan/work/story-skills`.

Current package:
- Bun package, ESM, Node >=18.
- CLI entrypoint: `bin/story.js`.
- Core library: `src/story.js`, `src/cli.js`, `src/frontmatter.js`, `src/continuity.js`, `src/import.js`.
- Skills: `story-init`, `character-management`, `worldbuilding`, `plot-structure`, `chapter-writing`, `revision-continuity`, `story-maintenance`.
- Plugin metadata: `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`, `.agents/plugins/marketplace.json`.

Verification already run:

```shell
export PATH="$HOME/.bun/bin:$PATH"
bun install
bun run test
bun run story -- --help
```

Result: 48 tests passed, 0 failed. CLI help exposes `init`, `import`, `validate`, `reindex`, `wordcount`, `links`, `continuity`, `report`, `next`, `doctor`, `migrate`, `add`, `rename`, `remove`, `export`, and `build`.

Agent tooling seen on this machine:
- `codex-cli 0.139.0` available at `/home/dan/.npm-global/bin/codex`; `codex exec` supports non-interactive execution, `--cd`, `--sandbox`, `--model`, `--profile`, and review commands.
- `opencode 1.4.3` available at `/home/dan/.bun/bin/opencode`; supports `run`, `serve`, `web`, `acp`, `agent`, `session`, `export`, and model/provider management.
- npm package `@anthropic-ai/sdk` latest seen as `0.105.0`.
- npm package `opencode-ai` latest seen as `1.17.9`; there is no `opencode` npm package.
- npm package `@opencode-ai/sdk` exists at `1.17.9`, but the npm readme is empty, so inspect installed types before committing to its API.
- npm package `@openai/codex` latest seen as `0.141.0`; installed local CLI is slightly behind.

## Product Shape

The UI should feel like a creative cockpit:

1. Project dashboard
   - Shows story health: validation, link status, continuity status, word count, open questions, promises, stale registries, next recommended actions.
   - Has clear buttons for deterministic commands: Validate, Reindex, Word Count, Links, Continuity, Doctor, Export, Build.

2. Story bible editor
   - Structured form for `story.md` frontmatter: title, genre, sub-genre, setting era, themes, POV, tense, status.
   - Markdown editor for synopsis, tone/style, notes.
   - Save runs `story validate` and shows exact warnings/errors.

3. Entity workspaces
   - Characters, locations, systems, factions, artifacts, plot arcs, questions, promises, glossary terms.
   - List view backed by `_index.md` registries.
   - Detail editor for each markdown file.
   - Agent buttons: “expand this character”, “add relationships”, “develop this location”, “turn this into a plot arc”.

4. Chapter studio
   - Left: story context and previous chapter summary.
   - Centre: outline and prose editor.
   - Right: continuity panel, scene records, character state, object state, knowledge state, promises/questions.
   - Workflow states: Context gathered → Outline proposed → User approved → Draft running → Post-write maintenance → Review/fix.

5. Agent run console
   - Every agent run is visible as a timeline: prompt, selected skill, provider, model, files read/written, tool/command output, diff, validation results.
   - User can approve outline, stop generation, retry with different model, accept/reject diffs, or ask for a targeted revision.

6. Export/build screen
   - `story export` to manuscript markdown.
   - `story build --format markdown|epub|docx`.
   - Shows output path and lets the user download artifacts.

## Key Architectural Rule

Do not make the agent own the project model.

The app owns orchestration and deterministic checks. The existing markdown project and `story` CLI own persistence and validation. Agents are replaceable workers that receive a scoped prompt, loaded skill text, project context, and a write boundary.

## Proposed Repository Strategy

Start with a sibling app rather than immediately folding UI code into the skill package:

```text
story-skills/
  src/                    existing CLI/library
  skills/                 existing agent skills
  apps/
    web/                  new Story Skills UI
  packages/
    story-core/           optional later extraction of CLI-safe library APIs
    agent-runners/        provider-neutral agent runner package
```

Short-term: add `apps/web` inside this repo so it can import local `src/story.js` functions and use the bundled skills directly.

Medium-term: split a public `@story-skills/core` package if the UI becomes real product surface.

## Backend Design

Create an orchestrator server inside `apps/web/src/server`.

Core modules:

```text
apps/web/src/server/
  projects.ts             workspace discovery, create/import/open story projects
  story-cli.ts            wrappers around src/story.js functions and CLI-compatible output
  markdown-store.ts       safe read/write helpers, frontmatter parsing, diff creation
  skills.ts               load SKILL.md and reference files from skills/
  agents/
    types.ts              AgentRunner interface and event types
    codex.ts              Codex CLI runner
    anthropic.ts          Anthropic SDK runner
    opencode.ts           OpenCode CLI/server/SDK runner
    prompts.ts            prompt builders per workflow
  jobs.ts                 durable agent run queue and cancellation
  events.ts               Server-Sent Events or WebSocket streaming
  audit-log.ts            append-only run metadata
```

Agent runner interface:

```ts
export type AgentProvider = "codex" | "anthropic" | "opencode";

export type StoryWorkflow =
  | "story-init"
  | "character-management"
  | "worldbuilding"
  | "plot-structure"
  | "chapter-writing"
  | "revision-continuity"
  | "story-maintenance";

export interface AgentRunRequest {
  provider: AgentProvider;
  model?: string;
  projectRoot: string;
  workflow: StoryWorkflow;
  userGoal: string;
  allowedPaths: string[];
  contextFiles: string[];
  dryRun?: boolean;
}

export interface AgentEvent {
  type:
    | "queued"
    | "started"
    | "prompt"
    | "stdout"
    | "stderr"
    | "file-diff"
    | "maintenance-result"
    | "needs-approval"
    | "completed"
    | "failed"
    | "cancelled";
  runId: string;
  timestamp: string;
  data: unknown;
}

export interface AgentRunner {
  readonly provider: AgentProvider;
  run(request: AgentRunRequest, emit: (event: AgentEvent) => void): Promise<AgentRunResult>;
  cancel(runId: string): Promise<void>;
}
```

The important bit: all providers return the same event stream and result shape, so the UI does not care whether the worker is Codex, Anthropic, or OpenCode.

## Skill Loading Strategy

For every creative run:

1. Load the matching `skills/<workflow>/SKILL.md`.
2. Load relevant references for that skill, for example `chapter-writing/references/chapter-template.md`, `scene-template.md`, and `writing-guidelines.md`.
3. Load `story-maintenance/SKILL.md` for post-run commands.
4. Build a prompt with:
   - explicit project root
   - user goal
   - skill instructions
   - allowed files/paths
   - required maintenance commands
   - required output format
   - approval points

Example high-level prompt shape:

```text
You are editing a Story Skills markdown project at {projectRoot}.
Use the loaded Story Skills workflow: chapter-writing.

User goal:
{goal}

Skill instructions:
{chapterWritingSkill}

Required context files:
{summaries and exact paths}

Constraints:
- Keep the project markdown-first.
- Do not create generator scripts that emit story content.
- Write only under allowed paths.
- Before full prose, produce an outline and stop for approval.
- After writing, run: story wordcount . --write; story reindex .; story links .; story validate .; story next .

Return structured progress events and a final summary.
```

## Provider Notes

### Codex runner

Use the CLI first because it is installed and supports non-interactive runs:

```shell
codex exec --cd {projectRoot} --sandbox workspace-write --model {model} "{prompt}"
```

For a web UI, spawn the process, stream stdout/stderr, collect exit status, then inspect git/file diffs independently. Avoid trusting the self-report.

Open question: whether current Codex exposes a stable TypeScript SDK for long-running controlled runs. Until that is confirmed, CLI process orchestration is safer.

### Anthropic runner

Use `@anthropic-ai/sdk` for a first-class application integration.

The SDK gives direct control over:
- model selection
- streaming messages
- structured tool-call handling
- cancellation/timeouts
- your own filesystem tools

Recommended pattern:
- Do not give Anthropic arbitrary shell access initially.
- Provide app-owned tools: `readFile`, `writeFile`, `listStoryFiles`, `runStoryCommand`, `proposePatch`, `requestApproval`.
- The orchestrator applies writes and runs maintenance commands, then streams results back to the model and UI.

This is likely the cleanest route for a polished UI because permissions and intermediate approval states are yours, not the terminal agent's.

### OpenCode runner

OpenCode has both CLI and server surfaces:

```shell
opencode run "{prompt}" --model {provider/model}
opencode serve --hostname 127.0.0.1 --port {port}
opencode web
opencode acp
```

Use `opencode run` for the MVP runner, or `opencode serve` if you want session attachment and richer UI integration. `@opencode-ai/sdk` exists, but inspect its installed types and examples before relying on it.

## MVP Scope

Build the UI in four thin slices.

### Slice 1: Deterministic Story Dashboard

Objective: A web UI can open a Story Skills project and run the existing checks.

Files:
- Create: `apps/web/package.json`
- Create: `apps/web/src/server/story-cli.ts`
- Create: `apps/web/src/server/projects.ts`
- Create: `apps/web/src/app/projects/[id]/page.tsx`
- Create: `apps/web/src/components/HealthPanel.tsx`

Features:
- Select project root from configured workspace directory.
- Show project report from `projectReport(root)`.
- Buttons for validate, links, continuity, wordcount, reindex, doctor, next.
- Display exact CLI-style output and file-addressed errors.

Verification:

```shell
export PATH="$HOME/.bun/bin:$PATH"
bun install
bun run --cwd apps/web test
bun run --cwd apps/web build
```

Also manually open an example project and run validation against `examples/the-last-ember` and continuity against `examples/the-unraveled-thread`.

### Slice 2: Markdown and Frontmatter Editors

Objective: Users can edit story bible and entity files safely.

Files:
- Create: `apps/web/src/server/markdown-store.ts`
- Create: `apps/web/src/components/FrontmatterForm.tsx`
- Create: `apps/web/src/components/MarkdownEditor.tsx`
- Create: `apps/web/src/app/projects/[id]/story/page.tsx`
- Create: `apps/web/src/app/projects/[id]/characters/page.tsx`

Features:
- Parse YAML-ish frontmatter using existing `src/frontmatter.js` helpers where possible.
- Edit `story.md` fields via forms.
- Edit markdown body with preview.
- Save creates a diff and runs `validate`.
- Refuse writes outside project root and through symlinks.

Verification:
- Unit tests for safe path handling and frontmatter round-trip.
- Manual edit of example copy, then `story validate` remains clean.

### Slice 3: Agent Runner Console

Objective: The UI can start, stream, cancel, and inspect a provider-neutral agent run.

Files:
- Create: `apps/web/src/server/agents/types.ts`
- Create: `apps/web/src/server/agents/codex.ts`
- Create: `apps/web/src/server/agents/anthropic.ts`
- Create: `apps/web/src/server/agents/opencode.ts`
- Create: `apps/web/src/server/agents/prompts.ts`
- Create: `apps/web/src/server/jobs.ts`
- Create: `apps/web/src/components/AgentRunConsole.tsx`

Features:
- Select workflow skill and provider.
- Load matching `SKILL.md` into prompt.
- Start run with scoped allowed paths.
- Stream progress events.
- Capture before/after file diff.
- Run maintenance commands after completion.
- Show accept/reject controls for diffs.

MVP provider order:
1. Anthropic SDK runner with app-owned filesystem tools.
2. Codex CLI runner.
3. OpenCode CLI runner.

Reason: Anthropic SDK gives the most controllable UI semantics; CLI runners are useful but need process supervision and post-run diff checks.

Verification:
- Mock runner tests for event stream and cancellation.
- Smoke test Codex runner on a throwaway copy of an example project with a harmless maintenance-only prompt.
- Anthropic runner tests should use a fake SDK client unless API credentials are present.

### Slice 4: Chapter Studio Workflow

Objective: A chapter can move through controlled outline → approval → draft → maintenance → review states.

Files:
- Create: `apps/web/src/app/projects/[id]/chapters/page.tsx`
- Create: `apps/web/src/app/projects/[id]/chapters/[chapter]/page.tsx`
- Create: `apps/web/src/components/ChapterWorkflow.tsx`
- Create: `apps/web/src/server/workflows/chapter-writing.ts`

Workflow:
1. Gather context using `chapter-writing` skill list: `story.md`, `chapters/_index.md`, `plot/_index.md`, `plot/timeline.md`, `scenes/_index.md`, `continuity/state.md`, questions/promises registries, previous chapter, active arcs.
2. Ask runner for beat outline only.
3. UI shows outline and exact context used.
4. User approves or edits outline.
5. Runner writes chapter and scene files.
6. Orchestrator runs `wordcount --write`, `reindex`, `links`, `validate`, `continuity`, `next`.
7. UI shows diff plus maintenance results.
8. User accepts, rejects, or asks for targeted revision.

Verification:
- Use a temporary copy of `examples/the-last-ember`.
- Draft a very short chapter with a test/fake runner first.
- Confirm files changed only under `chapters/`, `scenes/`, `continuity/`, `plot/`, and registries.
- Confirm validation and links pass or show actionable findings.

## UI Design Direction

A good visual direction would be closer to a writing desk plus build dashboard, not a chat app:

- Left navigation: Project, Story Bible, Characters, World, Plot, Chapters, Continuity, Exports, Runs.
- Top health strip: Validate, Links, Continuity, Word Count, Open Questions, Open Promises.
- Main pane: editor/workflow content.
- Right rail: agent run state, diffs, next actions, selected context.
- Use inline status chips: clean, warning, error, stale, needs approval, running.
- Avoid burying deterministic errors in chat transcript text; show file path, severity, and repair action.

The main affordance should be “controlled workflow”, not “blank prompt box”. For example:
- Create character
- Develop location
- Plan next arc beat
- Outline next chapter
- Draft approved outline
- Continuity check latest chapter
- Fix stale registries
- Export manuscript

## Data Model

Use SQLite for app metadata only:

```sql
projects(id, name, root_path, created_at, last_opened_at)
agent_runs(id, project_id, provider, model, workflow, status, started_at, ended_at, prompt_hash)
agent_events(id, run_id, type, timestamp, json_data)
approvals(id, run_id, kind, status, requested_at, resolved_at, json_data)
file_snapshots(id, run_id, path, before_hash, after_hash, diff)
```

Do not duplicate story entities into SQLite in the MVP. Derive entity lists from markdown and registries. If search/performance later requires indexing, treat it as a cache that can be rebuilt.

## Security and Safety

- Workspace root allow-list. No arbitrary filesystem browsing by default.
- Resolve real paths and reject symlink escapes, matching the repo's current safety posture.
- Every agent run gets allowed paths.
- Anthropic SDK tools should mediate all writes.
- CLI runners run against a temporary git worktree or project copy by default until accepted.
- Always show diffs before applying agent changes to the canonical project.
- Store provider API keys outside project files.
- Audit log provider, model, prompt hash, selected skill, permissions, and changed files.

This also lines up with Dan's agent provenance/audit-trail interests.

## Implementation Tasks

### Task 1: Create the web app shell

Objective: Add a minimal TypeScript web app under `apps/web` without changing Story Skills CLI behaviour.

Files:
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/layout.tsx`

Steps:
1. Create the app package with Bun scripts: `dev`, `build`, `test`, `lint`.
2. Add a simple landing page: “Story Skills Studio”.
3. Run app build.
4. Commit: `feat: add story studio web app shell`.

### Task 2: Extract CLI library wrappers

Objective: Provide server functions for deterministic story operations.

Files:
- Create: `apps/web/src/server/story-cli.ts`
- Test: `apps/web/src/server/story-cli.test.ts`

Steps:
1. Import `validateProject`, `validateLinks`, `checkProjectContinuity`, `projectReport`, `projectActions`, `reindexProject`, and `computeWordCounts` from `../../../src/story.js`.
2. Wrap each in a typed result with `ok`, `stdout`, `errors`, `warnings`, and raw data.
3. Test against `examples/the-last-ember` and `examples/the-unraveled-thread`.
4. Commit: `feat: expose story maintenance operations to web app`.

### Task 3: Add project workspace discovery

Objective: The app can list and open story projects safely.

Files:
- Create: `apps/web/src/server/projects.ts`
- Test: `apps/web/src/server/projects.test.ts`

Steps:
1. Configure allowed roots with `STORY_STUDIO_WORKSPACE` defaulting to repo `examples/` in development.
2. Detect projects by presence of `story.md`.
3. Reject symlink escapes using realpath.
4. Commit: `feat: add safe story project discovery`.

### Task 4: Build the dashboard

Objective: Show project health and deterministic command outputs.

Files:
- Create: `apps/web/src/app/projects/[id]/page.tsx`
- Create: `apps/web/src/components/HealthPanel.tsx`
- Create: `apps/web/src/components/CommandOutput.tsx`

Steps:
1. Render project report and next actions.
2. Add buttons for validate, links, continuity, doctor, reindex, wordcount.
3. Stream or poll command output.
4. Test with clean and deliberately broken examples.
5. Commit: `feat: add story project health dashboard`.

### Task 5: Implement skill loader

Objective: Load Story Skills workflow instructions and references for agent prompts.

Files:
- Create: `apps/web/src/server/skills.ts`
- Test: `apps/web/src/server/skills.test.ts`

Steps:
1. Load `skills/<name>/SKILL.md`.
2. Parse minimal frontmatter: `name`, `description`.
3. Discover `references/` files.
4. Provide `loadWorkflowSkill(name, { includeReferences })`.
5. Test for all seven current skills.
6. Commit: `feat: load story skills for agent workflows`.

### Task 6: Define the agent runner contract

Objective: Create provider-neutral types before implementing providers.

Files:
- Create: `apps/web/src/server/agents/types.ts`
- Create: `apps/web/src/server/agents/prompts.ts`
- Test: `apps/web/src/server/agents/prompts.test.ts`

Steps:
1. Add `AgentRunRequest`, `AgentEvent`, `AgentRunResult`, `AgentRunner`.
2. Add prompt builder that includes skill content, user goal, allowed paths, context files, approval policy, and required maintenance checks.
3. Snapshot-test prompt shape for `chapter-writing` and `story-maintenance`.
4. Commit: `feat: define controllable agent workflow contract`.

### Task 7: Add a fake runner and run console

Objective: Build the UI flow without paying model/API cost or relying on installed CLIs.

Files:
- Create: `apps/web/src/server/agents/fake.ts`
- Create: `apps/web/src/server/jobs.ts`
- Create: `apps/web/src/components/AgentRunConsole.tsx`

Steps:
1. Fake runner emits queued, started, prompt, stdout, needs-approval, completed.
2. Jobs module stores in memory for MVP.
3. Console displays event timeline and approval controls.
4. Commit: `feat: add inspectable agent run console`.

### Task 8: Add Anthropic SDK runner

Objective: Support controlled agent work via app-owned tools.

Files:
- Create: `apps/web/src/server/agents/anthropic.ts`
- Test: `apps/web/src/server/agents/anthropic.test.ts`

Steps:
1. Install `@anthropic-ai/sdk`.
2. Implement streaming message call.
3. Expose controlled tools: read file, propose patch, run story command, request approval.
4. Test with a fake Anthropic client.
5. Commit: `feat: add anthropic story agent runner`.

### Task 9: Add Codex CLI runner

Objective: Support Codex as a worker behind the same UI.

Files:
- Create: `apps/web/src/server/agents/codex.ts`
- Test: `apps/web/src/server/agents/codex.test.ts`

Steps:
1. Detect `codex` binary.
2. Spawn `codex exec --cd <projectRoot> --sandbox workspace-write <prompt>`.
3. Stream stdout/stderr as events.
4. Capture before/after diff independently.
5. Add timeout and cancellation.
6. Commit: `feat: add codex cli story agent runner`.

### Task 10: Add OpenCode runner

Objective: Support OpenCode as an alternative worker.

Files:
- Create: `apps/web/src/server/agents/opencode.ts`
- Test: `apps/web/src/server/agents/opencode.test.ts`

Steps:
1. Detect `opencode` binary.
2. Spawn `opencode run <prompt> --model <provider/model>` from project root.
3. Stream stdout/stderr as events.
4. Optionally spike `opencode serve` and `@opencode-ai/sdk` after inspecting installed types.
5. Commit: `feat: add opencode story agent runner`.

### Task 11: Build Chapter Studio workflow

Objective: Implement the controlled outline → approval → draft → maintenance loop.

Files:
- Create: `apps/web/src/server/workflows/chapter-writing.ts`
- Create: `apps/web/src/components/ChapterWorkflow.tsx`
- Create: `apps/web/src/app/projects/[id]/chapters/page.tsx`

Steps:
1. Gather context files listed by `chapter-writing/SKILL.md`.
2. Start outline-only run.
3. Require user approval before prose run.
4. Run post-write maintenance commands.
5. Show diff and maintenance results.
6. Commit: `feat: add controlled chapter writing workflow`.

### Task 12: Add provenance and audit log

Objective: Make every run traceable.

Files:
- Create: `apps/web/src/server/audit-log.ts`
- Create: `apps/web/src/components/AuditTrail.tsx`

Steps:
1. Record provider, model, workflow skill, prompt hash, project path, allowed paths, started/ended timestamps, status, and changed files.
2. Render audit trail in project UI.
3. Include exportable JSON for a run.
4. Commit: `feat: add story agent audit trail`.

## Open Questions

1. Is this intended as a local developer tool, a self-hosted app, or a hosted SaaS?
2. Should the UI live inside `story-skills` long-term, or become `story-skills-studio`?
3. Do we want Git as the acceptance boundary? Recommended: yes. Each accepted agent run can become a commit or at least a named diff checkpoint.
4. Should Anthropic be the primary polished path and Codex/OpenCode treated as power-user runners, or should Codex be the default because the repo is already packaged as a Codex plugin?
5. Do we want collaborative multi-user writing, or single-user local-first first?

## Recommended Next Move

Build Slice 1 and Slice 5 first: deterministic dashboard plus skill loader. That proves the UI can understand Story Skills without involving model complexity. Then add a fake runner so the UX can be designed properly. Only after that wire Anthropic/Codex/OpenCode for real.

This avoids the common trap: building a chat wrapper before the underlying workflow and approval states are right.
