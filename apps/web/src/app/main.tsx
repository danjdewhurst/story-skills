import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentRunConsole } from "../components/AgentRunConsole";
import { CommandOutput } from "../components/CommandOutput";
import { HealthPanel } from "../components/HealthPanel";
import type { AgentEvent } from "../server/agents/types";
import type { StoryCommandName, StoryOperationResult } from "../server/story-cli";
import "./styles.css";

const demoReport = {
  title: "The Last Ember",
  counts: { words: 603, chapters: 1, characters: 3 },
  validation: { ok: true },
  links: { ok: true },
  continuity: { ok: true },
  actions: [
    { message: "Draft the next chapter from the current plot state." },
    { message: "Add scene records for any new chapter beats." },
    { message: "Run wordcount, reindex, links, validate, and continuity after edits." }
  ]
};

const commandOutputs: Record<StoryCommandName, StoryOperationResult> = {
  validate: { command: "validate", ok: true, stdout: "Project is valid\n", errors: [], warnings: [], data: { ok: true } },
  links: { command: "links", ok: true, stdout: "Links are valid\n", errors: [], warnings: [], data: { ok: true } },
  continuity: { command: "continuity", ok: true, stdout: "Continuity is consistent\n", errors: [], warnings: [], data: { ok: true } },
  report: { command: "report", ok: true, stdout: "# The Last Ember\n\nInventory and health summary loaded from Story Skills.\n", errors: [], warnings: [], data: demoReport },
  next: { command: "next", ok: true, stdout: "# Next Writing Actions: The Last Ember\n\n- Draft the next chapter.\n", errors: [], warnings: [], data: demoReport },
  doctor: { command: "doctor", ok: true, stdout: "# Story Doctor: The Last Ember\n\nChecks are clean.\n", errors: [], warnings: [], data: demoReport },
  reindex: { command: "reindex", ok: true, stdout: "Registries already up to date\n", errors: [], warnings: [], data: { changed: [] } },
  wordcount: { command: "wordcount", ok: true, stdout: "chapters/chapter-01.md: 603\nTotal: 603\n", errors: [], warnings: [], data: { total: 603 } }
};

const commands: StoryCommandName[] = ["validate", "links", "continuity", "doctor", "reindex", "wordcount"];

function App() {
  const [commandOutput, setCommandOutput] = useState<StoryOperationResult>(commandOutputs.report);
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);

  function runFakeAgent() {
    const runId = `demo-${Date.now()}`;
    const now = new Date().toISOString();
    setAgentEvents([
      { type: "queued", runId, timestamp: now, data: { provider: "fake", workflow: "chapter-writing" } },
      { type: "started", runId, timestamp: now, data: { projectRoot: "examples/the-last-ember" } },
      { type: "prompt", runId, timestamp: now, data: { text: "Load chapter-writing/SKILL.md, selected story context, and outline the next chapter before requesting approval." } },
      { type: "needs-approval", runId, timestamp: now, data: { kind: "outline", message: "Approve the proposed outline before prose drafting." } },
      { type: "maintenance-result", runId, timestamp: now, data: { command: "validate", ok: true, stdout: "Project is valid\n" } },
      { type: "completed", runId, timestamp: now, data: { changedFiles: [], dryRun: true } }
    ]);
  }

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Story Skills Studio</p>
          <h1>The Last Ember</h1>
          <p className="muted">A controllable cockpit for markdown-first story projects and agent-assisted writing workflows.</p>
        </div>
        <label className="projectPicker">
          Project
          <select value="the-last-ember" disabled>
            <option value="the-last-ember">The Last Ember</option>
          </select>
        </label>
      </header>

      <section className="grid">
        <HealthPanel report={demoReport as any} next={demoReport as any} />
        <section className="card commandCard">
          <h2>Deterministic maintenance</h2>
          <div className="buttonRow">
            {commands.map((command) => (
              <button key={command} onClick={() => setCommandOutput(commandOutputs[command])}>{command}</button>
            ))}
          </div>
          <CommandOutput result={commandOutput} />
        </section>
      </section>

      <section className="card">
        <div className="sectionHeader">
          <div>
            <h2>Agent workflow console</h2>
            <p className="muted">MVP UI shows the approval/diff workflow shape. Server modules already load real skills, wrap Story CLI operations, discover projects safely, and run a fake provider in tests.</p>
          </div>
          <button onClick={runFakeAgent}>Run fake chapter workflow</button>
        </div>
        <AgentRunConsole events={agentEvents} />
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
