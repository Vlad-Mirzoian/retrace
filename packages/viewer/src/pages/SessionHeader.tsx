import type { ChainVerification } from "retrace-core";
import type { SessionRow } from "retrace-core/browser";
import { getVerification } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";

function VerificationBadge({ verification }: { verification: ChainVerification }) {
  if (verification.ok) {
    return <p className="verify-badge verify-ok">✓ Tamper-evident · verified</p>;
  }
  return (
    <p className="verify-badge verify-broken">
      ✗ Integrity broken at step {verification.index} — {verification.reason}
    </p>
  );
}

export function SessionHeader({ session }: { session: SessionRow }) {
  const verification = useAsync(() => getVerification(session.id), [session.id]);

  return (
    <>
      <h1>{session.title ?? session.id}</h1>
      <p className="muted">
        {session.project ?? "—"} · {session.gitBranch ?? "—"} · {session.eventCount} events
      </p>
      {verification.status === "error" && (
        <p className="muted small">Integrity check unavailable: {verification.error.message}</p>
      )}
      {verification.status === "ready" && <VerificationBadge verification={verification.data} />}
    </>
  );
}
