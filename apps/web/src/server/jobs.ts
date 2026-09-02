import { AnthropicAgentRunner } from "./agents/anthropic";
import { CodexCliRunner } from "./agents/codex";
import { FakeAgentRunner } from "./agents/fake";
import { OpenCodeCliRunner } from "./agents/opencode";
import type { AgentEvent, AgentProvider, AgentRunRequest, AgentRunResult, AgentRunner } from "./agents/types";

export type RunStatus = "running" | "waiting-for-approval" | "completed" | "failed" | "cancelled";

type StoredRun = AgentRunResult & {
  provider: AgentProvider;
  status: RunStatus;
  approvalStatus?: "pending" | "approved" | "rejected";
};

const runners: Record<AgentProvider, AgentRunner> = {
  fake: new FakeAgentRunner(),
  anthropic: new AnthropicAgentRunner(),
  codex: new CodexCliRunner(),
  opencode: new OpenCodeCliRunner()
};

const runs = new Map<string, StoredRun>();
const events = new Map<string, AgentEvent[]>();
const approvalWaiters = new Map<string, (status: "approved" | "rejected") => void>();

export function startAgentRun(request: AgentRunRequest) {
  const runId = request.id ?? `run-${Date.now()}`;
  const runner = runners[request.provider];
  if (!runner) throw new Error(`Unsupported provider: ${request.provider}`);
  const pending: StoredRun = {
    runId,
    provider: request.provider,
    ok: false,
    events: [],
    summary: "Run started.",
    status: "running"
  };
  runs.set(runId, pending);
  setTimeout(async () => {
    try {
      const result = await runner.run({
        ...request,
        id: runId,
        approvalController: {
          waitForApproval: (id) => new Promise((resolve) => {
            approvalWaiters.set(id, resolve);
          })
        }
      }, (event) => recordEvent(pending, event));
      const latest = runs.get(runId) ?? pending;
      runs.set(runId, {
        ...result,
        provider: request.provider,
        events: events.get(runId) ?? result.events,
        status: result.ok ? "completed" : latest.status === "cancelled" ? "cancelled" : "failed",
        approvalStatus: latest.approvalStatus
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const event = { type: "failed" as const, runId, timestamp: new Date().toISOString(), data: { message } };
      recordEvent(pending, event);
      runs.set(runId, { ...pending, ok: false, events: events.get(runId) ?? [], summary: message, status: "failed" });
    } finally {
      approvalWaiters.delete(runId);
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
  return [...runs.values()].map((run) => ({ runId: run.runId, provider: run.provider, ok: run.ok, status: run.status, summary: run.summary, approvalStatus: run.approvalStatus }));
}

export function resolveApproval(runId: string, status: "approved" | "rejected") {
  const run = runs.get(runId);
  if (!run) throw new Error(`Unknown run: ${runId}`);
  if (run.approvalStatus !== "pending") throw new Error(`Run ${runId} is not waiting for approval`);
  const event = { type: status === "approved" ? "stdout" as const : "cancelled" as const, runId, timestamp: new Date().toISOString(), data: { approvalStatus: status } };
  events.set(runId, [...(events.get(runId) ?? []), event]);
  run.approvalStatus = status;
  run.status = status === "approved" ? "running" : "cancelled";
  run.events = events.get(runId) ?? [];
  runs.set(runId, run);
  approvalWaiters.get(runId)?.(status);
  return run;
}

function recordEvent(run: StoredRun, event: AgentEvent) {
  events.set(event.runId, [...(events.get(event.runId) ?? []), event]);
  const current = runs.get(event.runId) ?? run;
  current.events = events.get(event.runId) ?? [];
  if (event.type === "needs-approval") {
    current.approvalStatus = "pending";
    current.status = "waiting-for-approval";
  } else if (event.type === "cancelled") {
    current.status = "cancelled";
  } else if (event.type === "failed") {
    current.status = "failed";
  } else if (event.type === "completed") {
    current.status = "completed";
  }
  runs.set(event.runId, current);
}
