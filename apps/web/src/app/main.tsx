import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentRunConsole } from "../components/AgentRunConsole";
import { CommandOutput } from "../components/CommandOutput";
import { HealthPanel } from "../components/HealthPanel";
import type { AgentEvent } from "../server/agents/types";
import type { StoryCommandName, StoryOperationResult } from "../server/story-cli";
import "./styles.css";

const apiBase = import.meta.env.VITE_STORY_STUDIO_API ?? "http://127.0.0.1:4174";
const commands: StoryCommandName[] = ["validate", "links", "continuity", "doctor", "reindex", "wordcount"];

type Project = { id: string; title: string; root: string; status: string; genre: string };
type StoryDocument = { frontmatter: Record<string, unknown>; body: string };

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [health, setHealth] = useState<any>(null);
  const [commandOutput, setCommandOutput] = useState<StoryOperationResult | null>(null);
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [story, setStory] = useState<StoryDocument | null>(null);
  const [chapterContext, setChapterContext] = useState<any>(null);
  const [git, setGit] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedProject = useMemo(() => projects.find((project) => project.id === selectedId) ?? projects[0], [projects, selectedId]);

  useEffect(() => {
    loadProjects().catch((err) => setError(String(err)));
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    refreshProject(selectedProject.id).catch((err) => setError(String(err)));
  }, [selectedProject?.id]);

  useEffect(() => {
    if (!runId) return;
    const timer = setInterval(async () => {
      const events = await api<AgentEvent[]>(`/api/agent-runs/${runId}/events`);
      setAgentEvents(events);
    }, 350);
    return () => clearInterval(timer);
  }, [runId]);

  async function loadProjects() {
    const loaded = await api<Project[]>("/api/projects");
    setProjects(loaded);
    setSelectedId((current) => current || loaded[0]?.id || "");
  }

  async function refreshProject(id: string) {
    const [nextHealth, nextStory, nextChapterContext, nextGit] = await Promise.all([
      api<any>(`/api/projects/${encodeURIComponent(id)}/health`),
      api<StoryDocument>(`/api/projects/${encodeURIComponent(id)}/story`),
      api<any>(`/api/projects/${encodeURIComponent(id)}/chapter-studio`),
      api<any>(`/api/projects/${encodeURIComponent(id)}/git`)
    ]);
    setHealth(nextHealth);
    setStory(nextStory);
    setChapterContext(nextChapterContext);
    setGit(nextGit);
    setCommandOutput(nextHealth.report);
  }

  async function runCommand(command: StoryCommandName) {
    if (!selectedProject) return;
    const result = await api<StoryOperationResult>(`/api/projects/${encodeURIComponent(selectedProject.id)}/commands/${command}`, { method: "POST" });
    setCommandOutput(result);
    await refreshProject(selectedProject.id);
  }

  async function saveStory() {
    if (!selectedProject || !story) return;
    const saved = await api<any>(`/api/projects/${encodeURIComponent(selectedProject.id)}/story`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(story)
    });
    setStory(saved.document);
    setCommandOutput(saved.validation);
    await refreshProject(selectedProject.id);
  }

  async function runFakeAgent() {
    if (!selectedProject) return;
    const run = await api<any>(`/api/projects/${encodeURIComponent(selectedProject.id)}/agent-runs`, { method: "POST" });
    setRunId(run.runId);
    setAgentEvents(run.events ?? []);
  }

  async function approveRun(status: "approved" | "rejected") {
    if (!runId) return;
    const run = await api<any>(`/api/agent-runs/${runId}/approval`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status })
    });
    setAgentEvents(run.events ?? []);
  }

  if (projects.length === 0) {
    return <main className="shell"><h1>Story Skills Studio</h1><p className="muted">{error ?? "Loading story projects from the local API…"}</p></main>;
  }

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Story Skills Studio</p>
          <h1>{selectedProject.title}</h1>
          <p className="muted">Live local cockpit for markdown-first story projects and controlled agent workflows.</p>
        </div>
        <label className="projectPicker">
          Project
          <select value={selectedProject.id} onChange={(event) => setSelectedId(event.target.value)}>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
          </select>
        </label>
      </header>

      {error ? <section className="card errorBanner">{error}</section> : null}

      <nav className="tabs">
        <a href="#dashboard">Dashboard</a>
        <a href="#story">Story bible</a>
        <a href="#chapter">Chapter Studio</a>
        <a href="#agent">Agent run</a>
        <a href="#diff">Diff</a>
      </nav>

      <section id="dashboard" className="grid">
        <HealthPanel report={health?.report.data} next={health?.next.data} />
        <section className="card commandCard">
          <h2>Deterministic maintenance</h2>
          <div className="buttonRow">
            {commands.map((command) => <button key={command} onClick={() => runCommand(command)}>{command}</button>)}
          </div>
          {commandOutput ? <CommandOutput result={commandOutput} /> : null}
        </section>
      </section>

      <section id="story" className="card editorCard">
        <div className="sectionHeader"><h2>Story bible</h2><button onClick={saveStory}>Save and validate</button></div>
        {story ? <StoryEditor story={story} onChange={setStory} /> : <p className="muted">Loading story.md…</p>}
      </section>

      <section id="chapter" className="card">
        <div className="sectionHeader"><h2>Chapter Studio</h2><button onClick={runFakeAgent}>Outline next chapter</button></div>
        <p className="muted">Context files loaded for the outline → approval → draft → maintenance loop.</p>
        <div className="contextGrid">
          {(chapterContext?.files ?? []).map((file: any) => <div className="contextFile" key={file.path}><strong>{file.path}</strong><span>{Object.keys(file.frontmatter).length} frontmatter fields</span></div>)}
        </div>
      </section>

      <section id="agent" className="card">
        <div className="sectionHeader">
          <div><h2>Agent workflow console</h2><p className="muted">Fake provider is asynchronous and pollable; Codex/OpenCode/Anthropic runners are behind the same interface.</p></div>
          <div className="buttonRow"><button onClick={runFakeAgent}>Run fake chapter workflow</button><button onClick={() => approveRun("approved")}>Approve</button><button onClick={() => approveRun("rejected")}>Reject</button></div>
        </div>
        <AgentRunConsole events={agentEvents} />
      </section>

      <section id="diff" className="card">
        <h2>Git acceptance boundary</h2>
        <p className="muted">Changed files and diff are shown before accepting agent work.</p>
        <pre>{git?.status?.stdout || "Working tree clean"}</pre>
        <pre>{git?.diff?.stdout || "No diff"}</pre>
      </section>
    </main>
  );
}

function StoryEditor({ story, onChange }: { story: StoryDocument; onChange: (story: StoryDocument) => void }) {
  const updateField = (field: string, value: string) => onChange({ ...story, frontmatter: { ...story.frontmatter, [field]: value } });
  return (
    <div className="editorGrid">
      <label>Title<input value={String(story.frontmatter.title ?? "")} onChange={(event) => updateField("title", event.target.value)} /></label>
      <label>Genre<input value={String(story.frontmatter.genre ?? "")} onChange={(event) => updateField("genre", event.target.value)} /></label>
      <label>Sub-genre<input value={String(story.frontmatter["sub-genre"] ?? "")} onChange={(event) => updateField("sub-genre", event.target.value)} /></label>
      <label>Status<input value={String(story.frontmatter.status ?? "")} onChange={(event) => updateField("status", event.target.value)} /></label>
      <label>POV<input value={String(story.frontmatter.pov ?? "")} onChange={(event) => updateField("pov", event.target.value)} /></label>
      <label>Tense<input value={String(story.frontmatter.tense ?? "")} onChange={(event) => updateField("tense", event.target.value)} /></label>
      <label className="wide">Markdown body<textarea value={story.body} onChange={(event) => onChange({ ...story, body: event.target.value })} /></label>
    </div>
  );
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? response.statusText);
  return data as T;
}

createRoot(document.getElementById("root")!).render(<App />);
