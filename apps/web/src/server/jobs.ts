import { FakeAgentRunner } from "./agents/fake";
import type { AgentEvent, AgentRunRequest, AgentRunResult } from "./agents/types";

const runner = new FakeAgentRunner();
const runs = new Map<string, AgentRunResult & { status: "running" | "completed" | "failed"; approvalStatus?: "pending" | "approved" | "rejected" }>();
const events = new Map<string, AgentEvent[]>();

export function startAgentRun(request: AgentRunRequest) {
  const runId = request.id ?? `run-${Date.now()}`;
  const pending: AgentRunResult & { status: "running" | "completed" | "failed"; approvalStatus?: "pending" | "approved" | "rejected" } = {
    runId,
    ok: false,
    events: [],
    summary: "Run started.",
    status: "running"
  };
  runs.set(runId, pending);
  setTimeout(async () => {
    try {
      const result = await runner.run({ ...request, id: runId }, (event) => {
        events.set(runId, [...(events.get(runId) ?? []), event]);
        pending.events = events.get(runId) ?? [];
        if (event.type === "needs-approval") pending.approvalStatus = "pending";
      });
      runs.set(runId, { ...result, events: events.get(runId) ?? result.events, status: result.ok ? "completed" : "failed", approvalStatus: pending.approvalStatus });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const event = { type: "failed" as const, runId, timestamp: new Date().toISOString(), data: { message } };
      events.set(runId, [...(events.get(runId) ?? []), event]);
      runs.set(runId, { runId, ok: false, events: events.get(runId) ?? [], summary: message, status: "failed", approvalStatus: pending.approvalStatus });
    }
  }, 0);
  return pending;
}

export function listAgentEvents(runId: string) {
  return events.get(runId) ?? [];
}

export function getAgentRun(runId: string) {
  return runs.get(runId) ?? null;
}

export function listAgentRuns() {
  return [...runs.values()].map((run) => ({ runId: run.runId, ok: run.ok, status: run.status, summary: run.summary, approvalStatus: run.approvalStatus }));
}

export function resolveApproval(runId: string, status: "approved" | "rejected") {
  const run = runs.get(runId);
  if (!run) throw new Error(`Unknown run: ${runId}`);
  const event = { type: status === "approved" ? "stdout" as const : "cancelled" as const, runId, timestamp: new Date().toISOString(), data: { approvalStatus: status } };
  events.set(runId, [...(events.get(runId) ?? []), event]);
  run.approvalStatus = status;
  run.events = events.get(runId) ?? [];
  runs.set(runId, run);
  return run;
}
