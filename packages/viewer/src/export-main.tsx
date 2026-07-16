import type { RetraceEvent, SessionRow } from "retrace-core/browser";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SessionHeader } from "./pages/SessionHeader.js";
import { SessionTimelinePanel } from "./pages/SessionTimelinePanel.js";
import "./theme.css";

/** Embedded by `retrace export --html` (see cli/src/commands/export.ts). */
interface ExportedData {
  session: SessionRow;
  events: RetraceEvent[];
}

declare global {
  interface Window {
    __RETRACE_EXPORT__?: ExportedData;
  }
}

function ExportedSession({ data }: { data: ExportedData }) {
  return (
    <div className="page">
      <SessionHeader session={data.session} />
      <SessionTimelinePanel events={data.events} />
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");

const data = window.__RETRACE_EXPORT__;

createRoot(root).render(
  <StrictMode>
    <header className="app-header">
      <strong>Retrace</strong> <span className="muted small">— exported session</span>
    </header>
    {data ? (
      <ExportedSession data={data} />
    ) : (
      <p className="page error">No session data was embedded in this export.</p>
    )}
  </StrictMode>,
);
