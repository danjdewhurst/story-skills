import type { AgentEvent, AgentRunner, AgentRunRequest, AgentRunResult } from "./types";

export class AnthropicAgentRunner implements AgentRunner {
  readonly provider = "anthropic" as const;
  async run(request: AgentRunRequest, emit: (event: AgentEvent) => void): Promise<AgentRunResult> {
    const runId = request.id ?? `anthropic-${Date.now()}`;
    const event = { type: "failed" as const, runId, timestamp: new Date().toISOString(), data: { message: "Anthropic SDK runner is wired as a provider option, but real API execution is intentionally gated until ANTHROPIC_API_KEY and app-owned tools are configured." } };
    emit(event);
    return { runId, ok: false, events: [event], summary: "Anthropic runner not configured." };
  }
  async cancel(): Promise<void> {}
}
