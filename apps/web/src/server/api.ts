import type { Server } from "bun";
import type { AgentProvider } from "./agents/types";
import { gitDiff, gitStatus } from "./git";
import { readMarkdownDocument, saveMarkdownDocument } from "./markdown-store";
import { listStoryProjects, resolveStoryProject } from "./projects";
import { getAgentRun, listAgentEvents, listAgentRuns, resolveApproval, startAgentRun } from "./jobs";
import { runStoryOperation, storyHealth, type StoryCommandName } from "./story-cli";
import { WORKFLOW_SKILLS, type WorkflowSkillName } from "./skills";

const commands = new Set(["validate", "links", "continuity", "report", "next", "doctor", "reindex", "wordcount", "wordcount-write"]);
const providers = new Set(["fake", "anthropic", "codex", "opencode"]);
const allowedOrigins = new Set((process.env.STORY_STUDIO_ORIGIN ?? "http://127.0.0.1:5173,http://localhost:5173").split(",").map((origin) => origin.trim()).filter(Boolean));

export function createApiServer(options: { port?: number; hostname?: string } = {}) {
  return Bun.serve({
    hostname: options.hostname ?? process.env.STORY_STUDIO_API_HOST ?? "127.0.0.1",
    port: options.port ?? Number(process.env.STORY_STUDIO_API_PORT ?? 4174),
    async fetch(request) {
      try {
        const url = new URL(request.url);
        if (request.method === "OPTIONS") return cors(request, new Response(null));
        if (!originAllowed(request)) return json(request, { error: "Origin not allowed" }, 403);
        if (isMutation(request) && !tokenAllowed(request)) return json(request, { error: "Invalid or missing Studio token" }, 403);

        if (url.pathname === "/api/projects" && request.method === "GET") return json(request, listStoryProjects());

        const projectMatch = /^\/api\/projects\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
        if (projectMatch) {
          const [, id, rest = ""] = projectMatch;
          const root = resolveStoryProject(decodeURIComponent(id));
          if (rest === "health" && request.method === "GET") return json(request, storyHealth(root));
          if (rest === "git" && request.method === "GET") return json(request, { status: gitStatus(root), diff: gitDiff(root) });
          if (rest === "story" && request.method === "GET") return json(request, readMarkdownDocument(root, "story.md"));
          if (rest === "story" && request.method === "PUT") {
            const body = validateStorySave(await parseJson(request));
            return json(request, saveMarkdownDocument(root, "story.md", body.frontmatter, body.body));
          }
          if (rest === "chapter-studio" && request.method === "GET") return json(request, chapterStudioContext(root));
          const commandMatch = /^commands\/([^/]+)$/.exec(rest);
          if (commandMatch && request.method === "POST") {
            const command = commandMatch[1] as StoryCommandName;
            if (!commands.has(command)) return json(request, { error: `Unknown command ${command}` }, 404);
            return json(request, runStoryOperation(root, command));
          }
          if (rest === "agent-runs" && request.method === "POST") {
            const body = validateAgentRun(await parseJson(request, {}));
            const run = startAgentRun({
              provider: body.provider ?? "fake",
              model: body.model,
              projectRoot: root,
              workflow: body.workflow ?? "chapter-writing",
              userGoal: body.userGoal ?? "Outline the next chapter and stop for approval before drafting prose.",
              allowedPaths: body.allowedPaths ?? ["chapters/", "scenes/", "continuity/", "plot/", "characters/", "worldbuilding/"],
              contextFiles: body.contextFiles ?? ["story.md", "chapters/_index.md", "plot/_index.md", "plot/timeline.md", "continuity/state.md"],
              dryRun: body.dryRun ?? true
            });
            return json(request, run);
          }
        }

        const runMatch = /^\/api\/agent-runs\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
        if (runMatch) {
          const [, runId, rest = ""] = runMatch;
          if (!rest && request.method === "GET") return json(request, getAgentRun(runId));
          if (rest === "events" && request.method === "GET") return json(request, listAgentEvents(runId));
          if (rest === "approval" && request.method === "POST") {
            const body = validateApproval(await parseJson(request));
            return json(request, resolveApproval(runId, body.status));
          }
        }
        if (url.pathname === "/api/agent-runs" && request.method === "GET") return json(request, listAgentRuns());

        return json(request, { error: "Not found" }, 404);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json(request, { error: message }, message.startsWith("Bad request") ? 400 : 500);
      }
    }
  });
}

function chapterStudioContext(root: string) {
  const files = ["story.md", "chapters/_index.md", "plot/_index.md", "plot/timeline.md", "scenes/_index.md", "continuity/state.md", "continuity/questions/_index.md", "continuity/promises/_index.md"];
  return { files: files.map((file) => readMarkdownDocument(root, file)), health: storyHealth(root) };
}

async function parseJson(request: Request, fallback?: unknown) {
  try {
    return await request.json();
  } catch {
    if (fallback !== undefined) return fallback;
    throw new Error("Bad request: expected JSON body");
  }
}

function validateStorySave(value: unknown): { frontmatter: Record<string, unknown>; body: string } {
  if (!isRecord(value)) throw new Error("Bad request: expected object body");
  if (!isRecord(value.frontmatter)) throw new Error("Bad request: frontmatter must be an object");
  if (typeof value.body !== "string") throw new Error("Bad request: body must be a string");
  return { frontmatter: value.frontmatter, body: value.body };
}

function validateAgentRun(value: unknown) {
  if (!isRecord(value)) throw new Error("Bad request: expected object body");
  const provider = value.provider === undefined ? undefined : String(value.provider) as AgentProvider;
  if (provider && !providers.has(provider)) throw new Error(`Bad request: unsupported provider ${provider}`);
  const workflow = value.workflow === undefined ? undefined : String(value.workflow) as WorkflowSkillName;
  if (workflow && !WORKFLOW_SKILLS.includes(workflow)) throw new Error(`Bad request: unsupported workflow ${workflow}`);
  return {
    provider,
    workflow,
    model: value.model === undefined ? undefined : expectString(value.model, "model"),
    userGoal: value.userGoal === undefined ? undefined : expectString(value.userGoal, "userGoal"),
    allowedPaths: value.allowedPaths === undefined ? undefined : expectStringArray(value.allowedPaths, "allowedPaths"),
    contextFiles: value.contextFiles === undefined ? undefined : expectStringArray(value.contextFiles, "contextFiles"),
    dryRun: value.dryRun === undefined ? undefined : Boolean(value.dryRun)
  };
}

function validateApproval(value: unknown): { status: "approved" | "rejected" } {
  if (!isRecord(value)) throw new Error("Bad request: expected object body");
  if (value.status !== "approved" && value.status !== "rejected") throw new Error("Bad request: status must be approved or rejected");
  return { status: value.status };
}

function expectString(value: unknown, field: string) {
  if (typeof value !== "string") throw new Error(`Bad request: ${field} must be a string`);
  return value;
}

function expectStringArray(value: unknown, field: string) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(`Bad request: ${field} must be an array of strings`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMutation(request: Request) {
  return !["GET", "HEAD", "OPTIONS"].includes(request.method);
}

function tokenAllowed(request: Request) {
  const expected = process.env.STORY_STUDIO_TOKEN;
  return !expected || request.headers.get("x-story-studio-token") === expected;
}

function originAllowed(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || allowedOrigins.has(origin);
}

function json(request: Request, data: unknown, status = 200) {
  return cors(request, Response.json(data, { status }));
}

function cors(request: Request, response: Response) {
  const origin = request.headers.get("origin");
  if (origin && allowedOrigins.has(origin)) response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Vary", "Origin");
  response.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "content-type,x-story-studio-token");
  return response;
}

export type StoryStudioApiServer = Server<unknown>;
