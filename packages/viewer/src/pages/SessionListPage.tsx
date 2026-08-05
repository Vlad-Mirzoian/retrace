import type { SessionRow } from "retrace-core/browser";
import { formatDuration } from "retrace-core/browser";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listSessions } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { projectLabel } from "../projectLabel.js";

function formatTimestamp(ts: string | null): string {
  if (!ts) return "—";
  return ts.replace("T", " ").replace(/\.\d+Z$/, "");
}

interface Row {
  session: SessionRow;
  label: string;
}

/** Every field visible in the table, so search matches what's actually on screen (including the cwd/project shown only in the truncated cell's title attribute). */
function matchesSearch(row: Row, query: string): boolean {
  const haystack = [row.label, row.session.title, row.session.gitBranch, row.session.cwd, row.session.project]
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .toLowerCase();
  return haystack.includes(query);
}

export function SessionListPage() {
  const state = useAsync(listSessions, []);
  const [search, setSearch] = useState("");

  const rows = useMemo<Row[]>(
    () =>
      state.status === "ready"
        ? state.data.map((session) => ({ session, label: projectLabel(session.project, session.cwd) }))
        : [],
    [state],
  );

  const query = search.trim().toLowerCase();
  const filtered = useMemo(
    () => (query ? rows.filter((row) => matchesSearch(row, query)) : rows),
    [rows, query],
  );

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
          <>
            <div className="session-list-toolbar">
              <input
                type="search"
                className="filter-search"
                placeholder="Search sessions…"
                aria-label="Search sessions"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span className="muted small">
                {filtered.length} / {state.data.length}
              </span>
            </div>
            {filtered.length === 0 ? (
              <p className="muted">No sessions match "{search.trim()}".</p>
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
                  {filtered.map(({ session, label }) => (
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
                  ))}
                </tbody>
              </table>
            )}
          </>
        ))}
    </div>
  );
}
