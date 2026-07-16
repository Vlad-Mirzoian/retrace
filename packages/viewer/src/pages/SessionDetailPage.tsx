import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { getAllEvents, getSession } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { groupEvents } from "../timeline/grouping.js";
import { Timeline } from "../timeline/Timeline.js";

export function SessionDetailPage() {
  const { id = "" } = useParams();
  const session = useAsync(() => getSession(id), [id]);
  const events = useAsync(() => getAllEvents(id), [id]);

  const items = useMemo(
    () => (events.status === "ready" ? groupEvents(events.data) : []),
    [events],
  );

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
      {events.status === "ready" && <Timeline items={items} />}
    </div>
  );
}
