import { buildNavIndex, summarize, type RetraceEvent } from "retrace-core/browser";
import { useMemo, useState } from "react";
import { CausalTrace } from "./CausalTrace.js";
import { useReplay } from "./ReplayContext.js";

/**
 * Lists every recorded failure (error events + failed tool results) with a
 * one-click jump, plus a causal trace for whichever failure was last jumped
 * to. Leans entirely on Module 1's buildNavIndex/causalChainFor — no new
 * failure-detection logic here.
 */
export function FailurePanel({ events }: { events: RetraceEvent[] }) {
  const { setCurrentSeq } = useReplay();
  const navIndex = useMemo(() => buildNavIndex(events), [events]);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);

  const failures = useMemo(
    () => navIndex.errors.map((seq) => events.find((event) => event.seq === seq)).filter(
      (event): event is RetraceEvent => event !== undefined,
    ),
    [navIndex, events],
  );

  if (failures.length === 0) {
    return <p className="muted small">No failures recorded in this session.</p>;
  }

  function jump(seq: number) {
    setCurrentSeq(seq);
    setSelectedSeq(seq);
  }

  return (
    <div className="failure-panel">
      <button type="button" className="failure-jump-first" onClick={() => jump(failures[0].seq)}>
        Jump to first failure ({failures.length} total)
      </button>
      <ul className="failure-list">
        {failures.map((event) => (
          <li key={event.seq}>
            <button
              type="button"
              className={`failure-item${event.seq === selectedSeq ? " active" : ""}`}
              onClick={() => jump(event.seq)}
              aria-pressed={event.seq === selectedSeq}
            >
              <span className="badge badge-error">seq {event.seq}</span>
              <span className="failure-summary">{summarize(event)}</span>
            </button>
          </li>
        ))}
      </ul>
      {selectedSeq !== null && <CausalTrace events={events} seq={selectedSeq} />}
    </div>
  );
}
