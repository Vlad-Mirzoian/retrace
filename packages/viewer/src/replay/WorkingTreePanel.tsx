import { fileStatusesAt, type FileStatusEntry, type RetraceEvent } from "retrace-core/browser";
import { useMemo, useState } from "react";
import { FileStateView } from "./FileStateView.js";
import { useReplay } from "./ReplayContext.js";

const OPERATION_LABELS: Record<FileStatusEntry["operation"], string> = {
  create: "created",
  write: "written",
  edit: "edited",
  notebook_edit: "notebook edited",
  delete: "deleted",
};

function statusLabel(entry: FileStatusEntry): string {
  if (entry.deleted) return "deleted";
  if (!entry.hadSnapshot) return "no snapshot";
  return OPERATION_LABELS[entry.operation];
}

function statusClass(entry: FileStatusEntry): string {
  return entry.deleted ? "delete" : !entry.hadSnapshot ? "no-snapshot" : entry.operation;
}

/**
 * Lists every file touched by the session up to the replay cursor, each with
 * its status at that step (created / modified / deleted / no-snapshot).
 * Selecting a file opens its content — or a diff since its previous change —
 * in FileStateView below the list.
 */
export function WorkingTreePanel({ events }: { events: RetraceEvent[] }) {
  const { currentSeq } = useReplay();
  const statuses = useMemo(() => fileStatusesAt(events, currentSeq), [events, currentSeq]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const selected = statuses.find((entry) => entry.path === selectedPath) ?? null;

  if (statuses.length === 0) {
    return <p className="muted small">No files touched yet at this step.</p>;
  }

  return (
    <div className="working-tree">
      <ul className="working-tree-list">
        {statuses.map((entry) => (
          <li key={entry.path}>
            <button
              type="button"
              className={`working-tree-item${entry.path === selectedPath ? " active" : ""}`}
              onClick={() => setSelectedPath(entry.path === selectedPath ? null : entry.path)}
              aria-pressed={entry.path === selectedPath}
            >
              <span className={`badge working-tree-status-${statusClass(entry)}`}>
                {statusLabel(entry)}
              </span>
              <span className="file-path">{entry.path}</span>
            </button>
          </li>
        ))}
      </ul>
      {selected && <FileStateView entry={selected} events={events} />}
    </div>
  );
}
