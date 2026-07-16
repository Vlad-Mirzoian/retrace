import { Link, useParams } from "react-router-dom";
import { getAllEvents, getSession } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { SessionHeader } from "./SessionHeader.js";
import { SessionTimelinePanel } from "./SessionTimelinePanel.js";

export function SessionDetailPage() {
  const { id = "" } = useParams();
  const session = useAsync(() => getSession(id), [id]);
  const events = useAsync(() => getAllEvents(id), [id]);

  return (
    <div className="page">
      <p>
        <Link to="/">← Sessions</Link>
      </p>

      {session.status === "loading" && <p className="muted">Loading…</p>}
      {session.status === "error" && (
        <p className="error">Failed to load session: {session.error.message}</p>
      )}
      {session.status === "ready" && <SessionHeader session={session.data} />}

      {events.status === "loading" && <p className="muted">Loading events…</p>}
      {events.status === "error" && (
        <p className="error">Failed to load events: {events.error.message}</p>
      )}
      {events.status === "ready" && <SessionTimelinePanel events={events.data} />}
    </div>
  );
}
