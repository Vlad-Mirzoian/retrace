import { changesForPath, type FileStatusEntry, type RetraceEvent } from "retrace-core/browser";
import { useState } from "react";
import { getObjectText } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { DiffView } from "../timeline/DiffView.js";
import { CodeBlock } from "../timeline/primitives.js";

function FileContent({ hash }: { hash: string }) {
  const state = useAsync(() => getObjectText(hash), [hash]);
  if (state.status === "loading") return <p className="muted small">Loading…</p>;
  if (state.status === "error") {
    return <p className="error small">Failed to load file: {state.error.message}</p>;
  }
  return <CodeBlock text={state.data} label="file content" />;
}

/**
 * Diffs a path's content at `entry.atSeq` against its previous recorded
 * change. Both sides need a full-file CAS snapshot (`afterRef`) — an
 * Edit-only change with just oldString/newString can't be chained into this
 * kind of history diff, so that case degrades to a message rather than a
 * partial/misleading diff.
 */
function FileDiffSincePrevious({
  entry,
  events,
}: {
  entry: FileStatusEntry;
  events: RetraceEvent[];
}) {
  const changes = changesForPath(events, entry.path).filter((change) => change.seq <= entry.atSeq);
  const previousChange = changes[changes.length - 2];
  const prevRef = previousChange?.payload.afterRef;
  const currentRef = entry.ref;

  const state = useAsync(
    () =>
      Promise.all([
        prevRef ? getObjectText(prevRef) : Promise.resolve(undefined),
        currentRef ? getObjectText(currentRef) : Promise.resolve(undefined),
      ]),
    [prevRef, currentRef],
  );

  if (!previousChange) {
    return <p className="muted small">This is the first recorded change to this file.</p>;
  }
  if (!prevRef || !currentRef) {
    return <p className="muted small">(no snapshot captured for this comparison)</p>;
  }
  if (state.status === "loading") return <p className="muted small">Loading…</p>;
  if (state.status === "error") {
    return <p className="error small">Failed to load snapshot: {state.error.message}</p>;
  }

  const [before, after] = state.data;
  return <DiffView oldText={before ?? ""} newText={after ?? ""} />;
}

type ViewMode = "content" | "diff";

export function FileStateView({
  entry,
  events,
}: {
  entry: FileStatusEntry;
  events: RetraceEvent[];
}) {
  const [mode, setMode] = useState<ViewMode>("content");

  if (entry.deleted) {
    return (
      <p className="muted small">
        {entry.path} was deleted at step {entry.atSeq}.
      </p>
    );
  }

  return (
    <div className="file-state-view">
      <div className="file-state-toggle">
        <button
          type="button"
          className={mode === "content" ? "active" : ""}
          aria-pressed={mode === "content"}
          onClick={() => setMode("content")}
        >
          Content at this step
        </button>
        <button
          type="button"
          className={mode === "diff" ? "active" : ""}
          aria-pressed={mode === "diff"}
          onClick={() => setMode("diff")}
        >
          Diff since previous change
        </button>
      </div>
      {mode === "content" ? (
        entry.hadSnapshot && entry.ref ? (
          <FileContent hash={entry.ref} />
        ) : (
          <p className="muted small">(no snapshot captured)</p>
        )
      ) : (
        <FileDiffSincePrevious entry={entry} events={events} />
      )}
    </div>
  );
}
