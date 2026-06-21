import type { Server } from "bun";
import { gitDiff, gitStatus } from "./git";
import { readMarkdownDocument, saveMarkdownDocument } from "./markdown-store";
import { listStoryProjects, resolveStoryProject } from "./projects";
import { getAgentRun, listAgentEvents, listAgentRuns, resolveApproval, startAgentRun } from "./jobs";
import { runStoryOperation, storyHealth, type StoryCommandName } from "./story-cli";

const commands = new Set(["validate", "links", "continuity", "report", "next", "doctor", "reindex", "wordcount"]);

export function createApiServer(options: { port?: number } = {}) {
  return Bun.serve({
    port: options.port ?? Number(process.env.STORY_STUDIO_API_PORT ?? 4174),
    async fetch(request) {
      try {
        const url = new URL(request.url);
        if (request.method === "OPTIONS") return cors(new Response(null));
        if (url.pathname === "/api/projects" && request.method === "GET") return json(listStoryProjects());

        const projectMatch = /^\/api\/projects\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
        if (projectMatch) {
          const [, id, rest = ""] = projectMatch;
          const root = resolveStoryProject(decodeURIComponent(id));
          if (rest === "health" && request.method === "GET") return json(storyHealth(root));
          if (rest === "git" && request.method === "GET") return json({ status: gitStatus(root), diff: gitDiff(root) });
          if (rest === "story" && request.method === "GET") return json(readMarkdownDocument(root, "story.md"));
          if (rest === "story" && request.method === "PUT") {
            const body = await request.json() as { frontmatter: Record<string, unknown>; body: string };
            return json(saveMarkdownDocument(root, "story.md", body.frontmatter, body.body));
          }
          if (rest === "chapter-studio" && request.method === "GET") return json(chapterStudioContext(root));
          const commandMatch = /^commands\/([^/]+)$/.exec(rest);
          if (commandMatch && request.method === "POST") {
            const command = commandMatch[1] as StoryCommandName;
            if (!commands.has(command)) return json({ error: `Unknown command ${command}` }, 404);
            return json(runStoryOperation(root, command));
          }
          if (rest === "agent-runs" && request.method === "POST") {
            const body = await request.json().catch(() => ({})) as Partial<Parameters<typeof startAgentRun>[0]>;
            const run = await startAgentRun({
              provider: body.provider ?? "fake",
              model: body.model,
              projectRoot: root,
              workflow: body.workflow ?? "chapter-writing",
              userGoal: body.userGoal ?? "Outline the next chapter and stop for approval before drafting prose.",
              allowedPaths: body.allowedPaths ?? ["chapters/", "scenes/", "continuity/", "plot/", "characters/", "worldbuilding/"],
              contextFiles: body.contextFiles ?? ["story.md", "chapters/_index.md", "plot/_index.md", "plot/timeline.md", "continuity/state.md"],
              dryRun: body.dryRun ?? true
            });
            return json(run);
          }
        }

        const runMatch = /^\/api\/agent-runs\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
        if (runMatch) {
          const [, runId, rest = ""] = runMatch;
          if (!rest && request.method === "GET") return json(getAgentRun(runId));
          if (rest === "events" && request.method === "GET") return json(listAgentEvents(runId));
          if (rest === "approval" && request.method === "POST") {
            const body = await request.json() as { status?: "approved" | "rejected" };
            return json(resolveApproval(runId, body.status ?? "approved"));
          }
        }
        if (url.pathname === "/api/agent-runs" && request.method === "GET") return json(listAgentRuns());

        return json({ error: "Not found" }, 404);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json({ error: message }, 500);
      }
    }
  });
}

function chapterStudioContext(root: string) {
  const files = ["story.md", "chapters/_index.md", "plot/_index.md", "plot/timeline.md", "scenes/_index.md", "continuity/state.md", "continuity/questions/_index.md", "continuity/promises/_index.md"];
  return { files: files.map((file) => readMarkdownDocument(root, file)), health: storyHealth(root) };
}

function json(data: unknown, status = 200) {
  return cors(Response.json(data, { status }));
}

function cors(response: Response) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "content-type");
  return response;
}

export type StoryStudioApiServer = Server<unknown>;
