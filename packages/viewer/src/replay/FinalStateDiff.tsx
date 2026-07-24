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
  /** Content ref in each run's final tree, when that run captured a snapshot. */
  refA?: string;
  refB?: string;
  /**
   * Whether the path is in that run's final working tree at all. Present with
   * no ref means the run left the file there but captured no content for it.
   */
  inA: boolean;
  inB: boolean;
}

function FileDiffRow({ path, refA, refB, inA, inB }: DiffPath) {
  const state = useAsync(
    () =>
      Promise.all([
        refA ? getObjectText(refA) : Promise.resolve(""),
        refB ? getObjectText(refB) : Promise.resolve(""),
      ]),
    [refA, refB],
  );

  // A run that left the file in place but captured no snapshot has no content
  // to put on its side. Diffing against "" would read as "the other run
  // emptied the file" — precisely the wrong conclusion to hand a forensic
  // user — so say what's actually known instead. (An *absent* path is a
  // different thing: diffing against "" there is correct, and intended.)
  const unsnapshotted = (inA && !refA) || (inB && !refB);

  return (
    <div className="final-diff-file">
      <p className="file-path">{path}</p>
      {unsnapshotted ? (
        <p className="muted small">
          (no snapshot captured for run {inA && !refA ? "A" : "B"} — content can&apos;t be compared)
        </p>
      ) : (
        <>
          {state.status === "loading" && <p className="muted small">Loading…</p>}
          {state.status === "error" && (
            <p className="error small">Failed to load snapshot: {state.error.message}</p>
          )}
          {state.status === "ready" && <DiffView oldText={state.data[0]} newText={state.data[1]} />}
        </>
      )}
    </div>
  );
}

/**
 * Diffs the final working-tree state of two runs: every path either run's
 * content ref differs on at the end of the run, comparing run A's content
 * against run B's. Often the most useful comparison — "what did each run
 * actually leave behind" — independent of how each run got there. A path
 * deleted by both runs isn't shown: there's nothing left in either final
 * tree to compare. Neither is a path both runs left unsnapshotted — with no
 * content on either side there's no evidence they differ.
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
      if (a?.ref !== b?.ref) {
        rows.push({ path, refA: a?.ref, refB: b?.ref, inA: a !== undefined, inB: b !== undefined });
      }
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
