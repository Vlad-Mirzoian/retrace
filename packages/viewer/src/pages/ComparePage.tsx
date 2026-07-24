import { Link, useSearchParams } from "react-router-dom";
import { getAllEvents, getSession } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { FinalStateDiff } from "../replay/FinalStateDiff.js";
import { CompareTimeline } from "./CompareTimeline.js";

export function ComparePage() {
  const [params] = useSearchParams();
  const idA = params.get("a") ?? "";
  const idB = params.get("b") ?? "";

  const sessionA = useAsync(() => getSession(idA), [idA]);
  const sessionB = useAsync(() => getSession(idB), [idB]);
  const eventsA = useAsync(() => getAllEvents(idA), [idA]);
  const eventsB = useAsync(() => getAllEvents(idB), [idB]);

  if (!idA || !idB) {
    return (
      <div className="page">
        <p className="error">
          Provide both a session to compare: /compare?a=&lt;sessionId&gt;&amp;b=&lt;sessionId&gt;
        </p>
      </div>
    );
  }

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
