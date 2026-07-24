import { causalChainFor, type RetraceEvent } from "retrace-core/browser";
import { FileChangeCard } from "../timeline/FileChangeCard.js";
import { ToolCallCard } from "../timeline/ToolCallCard.js";

/**
 * A compact "why did this happen" trace for a selected failure: the tool
 * call/result pair that produced it (if any) and any file changes it made,
 * reusing the same cards the main timeline renders.
 */
export function CausalTrace({ events, seq }: { events: RetraceEvent[]; seq: number }) {
  const chain = causalChainFor(events, seq);

  if (!chain.toolCall && chain.fileChanges.length === 0) {
    return (
      <p className="muted small">No originating tool call recorded for this failure.</p>
    );
  }

  return (
    <div className="causal-trace">
      <h3 className="side-heading">Why did this happen?</h3>
      {chain.toolCall && <ToolCallCard call={chain.toolCall} result={chain.toolResult} />}
      {chain.fileChanges.map((change) => (
        <FileChangeCard key={change.seq} event={change} />
      ))}
    </div>
  );
}
