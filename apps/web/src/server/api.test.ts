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

  test("starts fake agent runs and exposes events", async () => {
    const projects = await fetch(`${base}/api/projects`).then((response) => response.json()) as Array<{ id: string }>;
    const run = await fetch(`${base}/api/projects/${projects[0].id}/agent-runs`, { method: "POST" }).then((response) => response.json()) as { runId: string };
    expect(run.runId).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const events = await fetch(`${base}/api/agent-runs/${run.runId}/events`).then((response) => response.json()) as Array<{ type: string }>;
    expect(events.map((event) => event.type)).toContain("needs-approval");
  });
});
