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
  const eventList = events.status === "ready" ? events.data.events : null;

  const navIndex = useMemo(() => (eventList ? buildNavIndex(eventList) : null), [eventList]);
  const report = useMemo(() => (eventList ? runChecks(id, eventList) : null), [id, eventList]);
  const maxSeq = eventList && eventList.length > 0 ? eventList[eventList.length - 1].seq : 0;

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
      {events.status === "ready" && events.data.truncatedAt && (
        <p className="error">
          Session truncated at seq {events.data.truncatedAt.seq}: events.jsonl could not be read
          further ({events.data.truncatedAt.reason}). Showing the {eventList?.length ?? 0} event(s)
          recovered before that point.
        </p>
      )}
      {eventList && navIndex && (
        <ReplayProvider maxSeq={maxSeq}>
          <ReplayControls navIndex={navIndex} />
          <div className="session-columns">
            <div className="session-column-main">
              <SessionTimelinePanel events={eventList} />
            </div>
            <div className="session-column-side">
              <section className="panel">
                <header className="panel-header">
                  <h2 className="panel-title">Findings</h2>
                  {report && report.findings.length > 0 && (
                    <span className="panel-count">{report.findings.length}</span>
                  )}
                </header>
                <div className="panel-body">
                  {report && <FindingsPanel report={report} events={eventList} />}
                </div>
              </section>
              <section className="panel">
                <header className="panel-header">
                  <h2 className="panel-title">Failures</h2>
                </header>
                <div className="panel-body">
                  <FailurePanel events={eventList} />
                </div>
              </section>
              <section className="panel">
                <header className="panel-header">
                  <h2 className="panel-title">Working tree</h2>
                </header>
                <div className="panel-body">
                  <WorkingTreePanel events={eventList} />
                </div>
              </section>
            </div>
          </div>
        </ReplayProvider>
      )}
    </div>
  );
}
