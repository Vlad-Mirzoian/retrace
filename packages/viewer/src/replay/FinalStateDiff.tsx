import { fileStateAt, type RetraceEvent } from "retrace-core/browser";
import { useMemo } from "react";
import { getObjectText } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { DiffView } from "../timeline/DiffView.js";

function lastSeq(events: RetraceEvent[]): number {
  return events.length > 0 ? events[events.length - 1].seq : 0;
}

interface DiffPath {
  path: string;
  refA?: string;
  refB?: string;
}

function FileDiffRow({ path, refA, refB }: DiffPath) {
  const state = useAsync(
    () =>
      Promise.all([
        refA ? getObjectText(refA) : Promise.resolve(""),
        refB ? getObjectText(refB) : Promise.resolve(""),
      ]),
    [refA, refB],
  );

  return (
    <div className="final-diff-file">
      <p className="file-path">{path}</p>
      {state.status === "loading" && <p className="muted small">Loading…</p>}
      {state.status === "error" && (
        <p className="error small">Failed to load snapshot: {state.error.message}</p>
      )}
      {state.status === "ready" && <DiffView oldText={state.data[0]} newText={state.data[1]} />}
    </div>
  );
}

/**
 * Diffs the final working-tree state of two runs: every path either run's
 * content ref differs on at the end of the run, comparing run A's content
 * against run B's. Often the most useful comparison — "what did each run
 * actually leave behind" — independent of how each run got there. A path
 * deleted by both runs isn't shown: there's nothing left in either final
 * tree to compare.
 */
export function FinalStateDiff({
  eventsA,
  eventsB,
}: {
  eventsA: RetraceEvent[];
  eventsB: RetraceEvent[];
}) {
  const diffPaths = useMemo(() => {
    const stateA = fileStateAt(eventsA, lastSeq(eventsA));
    const stateB = fileStateAt(eventsB, lastSeq(eventsB));
    const allPaths = new Set([...stateA.keys(), ...stateB.keys()]);

    const rows: DiffPath[] = [];
    for (const path of allPaths) {
      const a = stateA.get(path);
      const b = stateB.get(path);
      if (a?.ref !== b?.ref) rows.push({ path, refA: a?.ref, refB: b?.ref });
    }
    return rows.sort((x, y) => x.path.localeCompare(y.path));
  }, [eventsA, eventsB]);

  if (diffPaths.length === 0) {
    return <p className="muted small">Both runs left the working tree in the same state.</p>;
  }

  return (
    <div className="final-diff">
      {diffPaths.map((row) => (
        <FileDiffRow key={row.path} {...row} />
      ))}
    </div>
  );
}
