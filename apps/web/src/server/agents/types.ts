import type { WorkflowSkillName } from "../skills";

export type AgentProvider = "fake" | "anthropic" | "codex" | "opencode";

export type AgentEventType =
  | "queued"
  | "started"
  | "prompt"
  | "stdout"
  | "stderr"
  | "file-diff"
  | "maintenance-result"
  | "needs-approval"
  | "completed"
  | "failed"
  | "cancelled";

export interface ApprovalController {
  waitForApproval(runId: string): Promise<"approved" | "rejected">;
}

export interface AgentRunRequest {
  id?: string;
  provider: AgentProvider;
  model?: string;
  projectRoot: string;
  workflow: WorkflowSkillName;
  userGoal: string;
  allowedPaths: string[];
  contextFiles: string[];
  dryRun?: boolean;
  approvalController?: ApprovalController;
}

export interface AgentEvent {
  type: AgentEventType;
  runId: string;
  timestamp: string;
  data: unknown;
}

export interface AgentRunResult {
  runId: string;
  ok: boolean;
  events: AgentEvent[];
  summary: string;
}

export interface AgentRunner {
  readonly provider: AgentProvider;
  run(request: AgentRunRequest, emit: (event: AgentEvent) => void): Promise<AgentRunResult>;
  cancel(runId: string): Promise<void>;
}
