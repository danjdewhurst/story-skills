import { FakeAgentRunner } from "./agents/fake";
import type { AgentEvent, AgentRunRequest, AgentRunResult } from "./agents/types";

const runner = new FakeAgentRunner();
const runs = new Map<string, AgentRunResult>();
const events = new Map<string, AgentEvent[]>();

export async function startAgentRun(request: AgentRunRequest) {
  const runId = request.id ?? `run-${Date.now()}`;
  const result = await runner.run({ ...request, id: runId }, (event) => {
    events.set(runId, [...(events.get(runId) ?? []), event]);
  });
  runs.set(runId, result);
  return result;
}

export function listAgentEvents(runId: string) {
  return events.get(runId) ?? [];
}

export function getAgentRun(runId: string) {
  return runs.get(runId) ?? null;
}
