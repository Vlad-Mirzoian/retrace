import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { buildNavIndex, runChecks } from "retrace-core/browser";
import { getAllEvents, getSession } from "../api/client.js";
import { FindingsPanel } from "../check/FindingsPanel.js";
import { useAsync } from "../hooks/useAsync.js";
import { FailurePanel } from "../replay/FailurePanel.js";
import { ReplayControls } from "../replay/ReplayControls.js";
import { ReplayProvider } from "../replay/ReplayContext.js";
import { WorkingTreePanel } from "../replay/WorkingTreePanel.js";
import { SessionHeader } from "./SessionHeader.js";
import { SessionTimelinePanel } from "./SessionTimelinePanel.js";

export function SessionDetailPage() {
  const { id = "" } = useParams();
  const session = useAsync(() => getSession(id), [id]);
  const events = useAsync(() => getAllEvents(id), [id]);

  const navIndex = useMemo(
    () => (events.status === "ready" ? buildNavIndex(events.data) : null),
    [events],
  );
  const report = useMemo(
    () => (events.status === "ready" ? runChecks(id, events.data) : null),
    [id, events],
  );
  const maxSeq =
    events.status === "ready" && events.data.length > 0
      ? events.data[events.data.length - 1].seq
      : 0;

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
      {events.status === "ready" && navIndex && (
        <ReplayProvider maxSeq={maxSeq}>
          <ReplayControls navIndex={navIndex} />
          <div className="session-columns">
            <div className="session-column-main">
              <SessionTimelinePanel events={events.data} />
            </div>
            <div className="session-column-side">
              <h2 className="side-heading">Findings</h2>
              {report && <FindingsPanel report={report} events={events.data} />}
              <h2 className="side-heading">Failures</h2>
              <FailurePanel events={events.data} />
              <h2 className="side-heading">Working tree</h2>
              <WorkingTreePanel events={events.data} />
            </div>
          </div>
        </ReplayProvider>
      )}
    </div>
  );
}
