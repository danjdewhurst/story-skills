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
  return (
    <section className="card">
      <h2>Project health</h2>
      <div className="stats">
        <Stat label="Words" value={report.counts.words} />
        <Stat label="Chapters" value={report.counts.chapters} />
        <Stat label="Characters" value={report.counts.characters} />
        <Stat label="Open actions" value={next?.actions?.length ?? report.actions?.length ?? 0} />
      </div>
      <div className="checks">
        {checks.map(([label, check]) => <span key={label as string} className={(check as any).ok ? "chip ok" : "chip error"}>{label}: {(check as any).ok ? "clean" : "needs work"}</span>)}
      </div>
      <h3>Next actions</h3>
      <ul className="actions">
        {(next?.actions ?? report.actions ?? []).slice(0, 5).map((action: any, index: number) => <li key={index}>{action.message ?? String(action)}</li>)}
      </ul>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="stat"><strong>{value}</strong><span>{label}</span></div>;
}
