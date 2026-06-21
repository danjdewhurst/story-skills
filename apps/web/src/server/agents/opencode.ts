import { spawn } from "node:child_process";
import { buildAgentPrompt } from "./prompts";
import type { AgentEvent, AgentRunner, AgentRunRequest, AgentRunResult } from "./types";

export class OpenCodeCliRunner implements AgentRunner {
  readonly provider = "opencode" as const;
  private children = new Map<string, ReturnType<typeof spawn>>();

  async run(request: AgentRunRequest, emit: (event: AgentEvent) => void): Promise<AgentRunResult> {
    const runId = request.id ?? `opencode-${Date.now()}`;
    const events: AgentEvent[] = [];
    const push = (type: AgentEvent["type"], data: unknown) => { const event = { type, runId, timestamp: new Date().toISOString(), data }; events.push(event); emit(event); };
    push("started", { provider: this.provider, dryRun: request.dryRun ?? true });
    if (request.dryRun !== false) {
      push("prompt", { text: buildAgentPrompt(request) });
      push("completed", { message: "OpenCode dry-run completed. Set dryRun=false after approval to spawn opencode run." });
      return { runId, ok: true, events, summary: "OpenCode dry-run completed." };
    }
    const args = ["run", buildAgentPrompt(request)];
    if (request.model) args.push("--model", request.model);
    const child = spawn("opencode", args, { cwd: request.projectRoot });
    this.children.set(runId, child);
    child.stdout.on("data", (chunk) => push("stdout", chunk.toString()));
    child.stderr.on("data", (chunk) => push("stderr", chunk.toString()));
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    this.children.delete(runId);
    push(code === 0 ? "completed" : "failed", { exitCode: code });
    return { runId, ok: code === 0, events, summary: `OpenCode exited with ${code}` };
  }

  async cancel(runId: string): Promise<void> { this.children.get(runId)?.kill(); }
}
