import type { RetraceEvent } from "retrace-core/browser";
import { getObjectText } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { Card } from "./cards.js";
import { DiffView } from "./DiffView.js";

type FileChangeEvent = Extract<RetraceEvent, { kind: "file_change" }>;

/**
 * Diff whose sides live in the CAS (captured by the PreToolUse hook). A missing
 * ref means that side doesn't exist — e.g. a Write that created a new file has
 * no "before".
 */
function SnapshotDiff({ beforeRef, afterRef }: { beforeRef?: string; afterRef?: string }) {
  const state = useAsync(
    () =>
      Promise.all([
        beforeRef ? getObjectText(beforeRef) : Promise.resolve(""),
        afterRef ? getObjectText(afterRef) : Promise.resolve(""),
      ]),
    [beforeRef, afterRef],
  );

  if (state.status === "loading") return <p className="muted small">Loading snapshot…</p>;
  if (state.status === "error") {
    return <p className="error small">Failed to load snapshot: {state.error.message}</p>;
  }

  const [before, after] = state.data;
  return <DiffView oldText={before} newText={after} />;
}

export function FileChangeCard({ event }: { event: FileChangeEvent }) {
  const { path, operation, beforeRef, afterRef, oldString, newString } = event.payload;

  return (
    <Card
      kind="file"
      ts={event.ts}
      title={
        <>
          <span className="badge">{operation}</span>
          <span className="file-path">{path}</span>
        </>
      }
    >
      {beforeRef || afterRef ? (
        <SnapshotDiff beforeRef={beforeRef} afterRef={afterRef} />
      ) : oldString !== undefined || newString !== undefined ? (
        <DiffView oldText={oldString ?? ""} newText={newString ?? ""} />
      ) : (
        <p className="muted small">(no snapshot captured)</p>
      )}
    </Card>
  );
}
