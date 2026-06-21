import { buildAgentPrompt } from "./prompts";
import type { AgentEvent, AgentRunner, AgentRunRequest, AgentRunResult } from "./types";

export class FakeAgentRunner implements AgentRunner {
  readonly provider = "fake" as const;
  private cancelled = new Set<string>();

  async run(request: AgentRunRequest, emit: (event: AgentEvent) => void): Promise<AgentRunResult> {
    const runId = request.id ?? `fake-${Date.now()}`;
    const events: AgentEvent[] = [];
    const push = (type: AgentEvent["type"], data: unknown) => {
      const event = { type, runId, timestamp: new Date().toISOString(), data };
      events.push(event);
      emit(event);
    };

    push("queued", { provider: this.provider, workflow: request.workflow });
    if (this.cancelled.has(runId)) return { runId, ok: false, events, summary: "Run cancelled before start" };
    push("started", { projectRoot: request.projectRoot });
    push("prompt", { text: buildAgentPrompt(request) });
    push("stdout", "Fake runner loaded the workflow skill and selected context files.");
    push("needs-approval", { kind: "outline", message: "Approve the proposed outline before prose drafting." });
    push("maintenance-result", { command: "validate", ok: true, stdout: "Project is valid\n" });
    push("completed", { changedFiles: [], dryRun: true });
    return { runId, ok: true, events, summary: "Fake agent run completed without changing files." };
  }

  async cancel(runId: string): Promise<void> {
    this.cancelled.add(runId);
  }
}
