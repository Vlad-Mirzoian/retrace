import type { ChainVerification } from "retrace-core";
import { buildNavIndex, type RetraceEvent, type SessionRow } from "retrace-core/browser";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerEmbeddedObjects, registerEmbeddedVerification } from "./api/client.js";
import { SessionHeader } from "./pages/SessionHeader.js";
import { SessionTimelinePanel } from "./pages/SessionTimelinePanel.js";
import { ReplayControls } from "./replay/ReplayControls.js";
import { ReplayProvider } from "./replay/ReplayContext.js";
import "./theme.css";

/** Embedded by `retrace export --html` (see cli/src/commands/export.ts). */
interface ExportedData {
  session: SessionRow;
  events: RetraceEvent[];
  objects?: Record<string, string>;
  verification?: ChainVerification;
}

declare global {
  interface Window {
    __RETRACE_EXPORT__?: ExportedData;
  }
}

function ExportedSession({ data }: { data: ExportedData }) {
  const navIndex = buildNavIndex(data.events);
  const maxSeq = data.events.length > 0 ? data.events[data.events.length - 1].seq : 0;

  return (
    <div className="page">
      <SessionHeader session={data.session} />
      <ReplayProvider maxSeq={maxSeq}>
        <ReplayControls navIndex={navIndex} />
        <SessionTimelinePanel events={data.events} />
      </ReplayProvider>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");

const data = window.__RETRACE_EXPORT__;

// Make the bundled file snapshots resolvable before anything renders, so the
// diff cards find them instead of reaching for an API that isn't there.
if (data?.objects) registerEmbeddedObjects(data.objects);
if (data?.verification) registerEmbeddedVerification(data.verification);

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
