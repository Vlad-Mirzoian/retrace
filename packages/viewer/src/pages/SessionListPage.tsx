import { formatDuration } from "retrace-core/browser";
import { Link } from "react-router-dom";
import { listSessions } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { projectLabel } from "../projectLabel.js";

function formatTimestamp(ts: string | null): string {
  if (!ts) return "—";
  return ts.replace("T", " ").replace(/\.\d+Z$/, "");
}

export function SessionListPage() {
  const state = useAsync(listSessions, []);

  return (
    <div className="page">
      <h1>Sessions</h1>
      {state.status === "loading" && <p className="muted">Loading…</p>}
      {state.status === "error" && (
        <p className="error">Failed to load sessions: {state.error.message}</p>
      )}
      {state.status === "ready" &&
        (state.data.length === 0 ? (
          <p className="muted">
            No sessions recorded yet. Run <code>retrace import</code> first.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Branch</th>
                <th>Title</th>
                <th>Started</th>
                <th>Duration</th>
                <th className="col-num">Events</th>
                <th className="col-num">Tools</th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((session) => {
                const label = projectLabel(session.project, session.cwd);
                return (
                  <tr key={session.id}>
                    <td className="col-truncate" title={session.cwd ?? session.project ?? undefined}>
                      <Link to={`/sessions/${session.id}`}>
                        {label !== "—" ? label : session.id.slice(0, 10)}
                      </Link>
                    </td>
                    <td className="mono small">{session.gitBranch ?? "—"}</td>
                    <td className="col-truncate" title={session.title ?? undefined}>
                      {session.title ?? "—"}
                    </td>
                    <td>{formatTimestamp(session.startedAt)}</td>
                    <td>{formatDuration(session.startedAt, session.endedAt) ?? "—"}</td>
                    <td className="col-num">{session.eventCount}</td>
                    <td className="col-num">{session.toolCallCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
    </div>
  );
}
