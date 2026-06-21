interface HealthPanelProps {
  report: any;
  next: any;
}

export function HealthPanel({ report, next }: HealthPanelProps) {
  if (!report) return null;
  const checks = [
    ["Validate", report.validation],
    ["Links", report.links],
    ["Continuity", report.continuity]
  ];
  const actions = next?.actions ?? report.actions ?? [];
  return (
    <section className="card">
      <h2>Project health</h2>
      <div className="stats">
        <Stat label="Words" value={report.counts.words} />
        <Stat label="Chapters" value={report.counts.chapters} />
        <Stat label="Characters" value={report.counts.characters} />
        <Stat label="Open actions" value={actions.length} />
      </div>
      <div className="checks">
        {checks.map(([label, check]) => <span key={label as string} className={(check as any).ok ? "chip ok" : "chip error"}>{label}: {(check as any).ok ? "clean" : "needs work"}</span>)}
      </div>
      <h3>Next actions</h3>
      <ul className="actions">
        {actions.slice(0, 5).map((action: any, index: number) => <li key={index}>{formatAction(action)}</li>)}
      </ul>
    </section>
  );
}

export function formatAction(action: any) {
  if (typeof action === "string") return action;
  if (!action || typeof action !== "object") return String(action);
  const title = action.title ?? action.message ?? action.name ?? "Action";
  const priority = action.priority ? `${action.priority}: ` : "";
  const detail = action.detail ? ` — ${action.detail}` : "";
  return `${priority}${title}${detail}`;
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="stat"><strong>{value}</strong><span>{label}</span></div>;
}
