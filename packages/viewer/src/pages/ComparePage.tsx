import { Link, useSearchParams } from "react-router-dom";
import { getAllEvents, getSession } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { FinalStateDiff } from "../replay/FinalStateDiff.js";
import { CompareTimeline } from "./CompareTimeline.js";

export function ComparePage() {
  const [params] = useSearchParams();
  const idA = params.get("a") ?? "";
  const idB = params.get("b") ?? "";

  if (!idA || !idB) {
    return (
      <div className="page">
        <p className="error">
          Provide both sessions to compare: /compare?a=&lt;sessionId&gt;&amp;b=&lt;sessionId&gt;
        </p>
      </div>
    );
  }

  return <CompareView idA={idA} idB={idB} />;
}

/**
 * Split out so the fetches only ever mount with real ids — hooks can't be
 * skipped by an early return, and firing them on an empty id would just queue
 * four requests that are guaranteed to fail.
 */
function CompareView({ idA, idB }: { idA: string; idB: string }) {
  const sessionA = useAsync(() => getSession(idA), [idA]);
  const sessionB = useAsync(() => getSession(idB), [idB]);
  const eventsA = useAsync(() => getAllEvents(idA), [idA]);
  const eventsB = useAsync(() => getAllEvents(idB), [idB]);

  return (
    <div className="page">
      <p>
        <Link to="/">← Sessions</Link>
      </p>
      <h1>Comparing two runs</h1>

      <div className="compare-headers">
        <h2>
          {sessionA.status === "ready" ? (sessionA.data.title ?? sessionA.data.id) : idA}
        </h2>
        <h2>
          {sessionB.status === "ready" ? (sessionB.data.title ?? sessionB.data.id) : idB}
        </h2>
      </div>

      {eventsA.status === "loading" || eventsB.status === "loading" ? (
        <p className="muted">Loading both runs…</p>
      ) : null}
      {eventsA.status === "error" && (
        <p className="error">Failed to load run A: {eventsA.error.message}</p>
      )}
      {eventsB.status === "error" && (
        <p className="error">Failed to load run B: {eventsB.error.message}</p>
      )}

      {eventsA.status === "ready" && eventsB.status === "ready" && (
        <>
          <CompareTimeline eventsA={eventsA.data} eventsB={eventsB.data} />
          <h2 className="side-heading">Final state diff</h2>
          <FinalStateDiff eventsA={eventsA.data} eventsB={eventsB.data} />
        </>
      )}
    </div>
  );
}
