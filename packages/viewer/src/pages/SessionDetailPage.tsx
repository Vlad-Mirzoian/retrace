import { summarize } from "@retrace/core/browser";
import { Link, useParams } from "react-router-dom";
import { getEvents, getSession } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";

const PAGE_SIZE = 100;

export function SessionDetailPage() {
  const { id = "" } = useParams();
  const session = useAsync(() => getSession(id), [id]);
  const events = useAsync(() => getEvents(id, { limit: PAGE_SIZE }), [id]);

  return (
    <div className="page">
      <p>
        <Link to="/">← Sessions</Link>
      </p>

      {session.status === "loading" && <p className="muted">Loading…</p>}
      {session.status === "error" && (
        <p className="error">Failed to load session: {session.error.message}</p>
      )}
      {session.status === "ready" && (
        <>
          <h1>{session.data.title ?? session.data.id}</h1>
          <p className="muted">
            {session.data.project ?? "—"} · {session.data.gitBranch ?? "—"} ·{" "}
            {session.data.eventCount} events
          </p>
        </>
      )}

      {events.status === "loading" && <p className="muted">Loading events…</p>}
      {events.status === "error" && (
        <p className="error">Failed to load events: {events.error.message}</p>
      )}
      {events.status === "ready" &&
        (events.data.length === 0 ? (
          <p className="muted">No events recorded for this session.</p>
        ) : (
          <ul className="event-list">
            {events.data.map((event) => (
              <li key={event.seq} className="event-row">
                <span className="event-kind">{event.kind}</span>
                <span className="event-summary">{summarize(event)}</span>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
