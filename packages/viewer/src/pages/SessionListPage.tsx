import { formatDuration } from "retrace-core/browser";
import { Link } from "react-router-dom";
import { listSessions } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";

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
                <th>Events</th>
                <th>Tools</th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((session) => (
                <tr key={session.id}>
                  <td>
                    <Link to={`/sessions/${session.id}`}>
                      {session.project ?? session.id.slice(0, 10)}
                    </Link>
                  </td>
                  <td>{session.gitBranch ?? "—"}</td>
                  <td>{session.title ?? "—"}</td>
                  <td>{formatTimestamp(session.startedAt)}</td>
                  <td>{formatDuration(session.startedAt, session.endedAt) ?? "—"}</td>
                  <td>{session.eventCount}</td>
                  <td>{session.toolCallCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </div>
  );
}
