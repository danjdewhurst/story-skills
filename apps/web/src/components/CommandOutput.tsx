import type { StoryOperationResult } from "../server/story-cli";

export function CommandOutput({ result }: { result: StoryOperationResult }) {
  return (
    <div className="commandOutput">
      <div className={result.ok ? "status ok" : "status error"}>{result.command}: {result.ok ? "passed" : "failed"}</div>
      <pre>{result.stdout}</pre>
    </div>
  );
}
