import { afterAll, describe, expect, test } from "bun:test";
import path from "node:path";
import { createApiServer } from "./api";

process.env.STORY_STUDIO_WORKSPACE = path.resolve(import.meta.dir, "../../../..", "examples");
const server = createApiServer({ port: 0 });
const base = `http://127.0.0.1:${server.port}`;

afterAll(() => server.stop(true));

describe("studio api", () => {
  test("lists projects and returns health", async () => {
    const projects = await fetch(`${base}/api/projects`).then((response) => response.json()) as Array<{ id: string }>;
    expect(projects.length).toBeGreaterThan(0);
    const health = await fetch(`${base}/api/projects/${projects[0].id}/health`).then((response) => response.json()) as any;
    expect(health.report.command).toBe("report");
  });

  test("rejects disallowed origins", async () => {
    const response = await fetch(`${base}/api/projects`, { headers: { origin: "https://evil.example" } });
    expect(response.status).toBe(403);
  });

  test("validates mutation request bodies", async () => {
    const projects = await fetch(`${base}/api/projects`).then((response) => response.json()) as Array<{ id: string }>;
    const response = await fetch(`${base}/api/projects/${projects[0].id}/story`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ frontmatter: [], body: 123 })
    });
    expect(response.status).toBe(400);
  });

  test("starts fake agent runs, waits for approval, and resumes", async () => {
    const projects = await fetch(`${base}/api/projects`).then((response) => response.json()) as Array<{ id: string }>;
    const run = await fetch(`${base}/api/projects/${projects[0].id}/agent-runs`, { method: "POST" }).then((response) => response.json()) as { runId: string; provider: string };
    expect(run.runId).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    let events = await fetch(`${base}/api/agent-runs/${run.runId}/events`).then((response) => response.json()) as Array<{ type: string }>;
    expect(events.map((event) => event.type)).toContain("needs-approval");
    expect(events.map((event) => event.type)).not.toContain("completed");

    await fetch(`${base}/api/agent-runs/${run.runId}/approval`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "approved" })
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    events = await fetch(`${base}/api/agent-runs/${run.runId}/events`).then((response) => response.json()) as Array<{ type: string }>;
    expect(events.map((event) => event.type)).toContain("completed");
  });

  test("dispatches provider dry-runs", async () => {
    const projects = await fetch(`${base}/api/projects`).then((response) => response.json()) as Array<{ id: string }>;
    const run = await fetch(`${base}/api/projects/${projects[0].id}/agent-runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "codex", dryRun: true })
    }).then((response) => response.json()) as { runId: string; provider: string };
    expect(run.provider).toBe("codex");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const events = await fetch(`${base}/api/agent-runs/${run.runId}/events`).then((response) => response.json()) as Array<{ type: string; data: any }>;
    expect(events.some((event) => event.type === "completed")).toBe(true);
  });
});
