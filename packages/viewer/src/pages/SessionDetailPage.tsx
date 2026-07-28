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
              <section className="panel">
                <header className="panel-header">
                  <h2 className="panel-title">Findings</h2>
                  {report && report.findings.length > 0 && (
                    <span className="panel-count">{report.findings.length}</span>
                  )}
                </header>
                <div className="panel-body">
                  {report && <FindingsPanel report={report} events={events.data} />}
                </div>
              </section>
              <section className="panel">
                <header className="panel-header">
                  <h2 className="panel-title">Failures</h2>
                </header>
                <div className="panel-body">
                  <FailurePanel events={events.data} />
                </div>
              </section>
              <section className="panel">
                <header className="panel-header">
                  <h2 className="panel-title">Working tree</h2>
                </header>
                <div className="panel-body">
                  <WorkingTreePanel events={events.data} />
                </div>
              </section>
            </div>
          </div>
        </ReplayProvider>
      )}
    </div>
  );
}
