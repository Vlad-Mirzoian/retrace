import { alignRuns, type RetraceEvent } from "retrace-core/browser";
import { useMemo } from "react";
import { renderEventCard } from "../timeline/Timeline.js";

function RowSide({ event }: { event?: RetraceEvent }) {
  if (!event) return <div className="compare-cell compare-cell-empty" />;
  return <div className="compare-cell">{renderEventCard(event)}</div>;
}

/**
 * Renders two runs' event streams side by side, aligned by `alignRuns`
 * (Module 1's core alignment primitive). Each row is either a matched pair
 * (both columns filled, "match" or "changed"), or a row present in only one
 * run ("only-a"/"only-b", the other column left blank).
 */
export function CompareTimeline({
  eventsA,
  eventsB,
}: {
  eventsA: RetraceEvent[];
  eventsB: RetraceEvent[];
}) {
  const rows = useMemo(() => alignRuns(eventsA, eventsB), [eventsA, eventsB]);

  if (rows.length === 0) {
    return <p className="muted">Nothing to compare — both runs are empty.</p>;
  }

  return (
    <div className="compare-timeline">
      {rows.map((row, index) => (
        // Aligned rows have no stable identity of their own (a or b's seq
        // differs per run, and either side may be absent) — index is the identity.
        <div key={index} className={`compare-row compare-row-${row.status}`}>
          <RowSide event={row.a} />
          <RowSide event={row.b} />
        </div>
      ))}
    </div>
  );
}
