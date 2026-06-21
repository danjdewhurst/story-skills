import type { AgentEvent } from "../server/agents/types";

export function AgentRunConsole({ events }: { events: AgentEvent[] }) {
  if (events.length === 0) return <p className="muted">No agent run yet.</p>;
  return (
    <ol className="timeline">
      {events.map((event, index) => (
        <li key={`${event.runId}-${index}`}>
          <span className="eventType">{event.type}</span>
          <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
          <pre>{typeof event.data === "string" ? event.data : JSON.stringify(event.data, null, 2)}</pre>
        </li>
      ))}
    </ol>
  );
}
