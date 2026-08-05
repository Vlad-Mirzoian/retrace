import type { ChainVerification } from "retrace-core";
import type { SessionRow } from "retrace-core/browser";
import { getVerification } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { projectLabel } from "../projectLabel.js";

function VerificationBadge({ verification }: { verification: ChainVerification }) {
  if (verification.ok) {
    return <span className="badge badge-verify-ok">✓ Tamper-evident · verified</span>;
  }
  // index -1 means the chain was never even reconstructed — events.jsonl
  // itself failed to read (see the CLI's matching formatVerifyResult) — so
  // "at step -1" would be a meaningless number, not a real event position.
  const at = verification.index >= 0 ? ` at step ${verification.index}` : "";
  return (
    <span className="badge badge-verify-broken">
      ✗ Integrity broken{at} — {verification.reason}
    </span>
  );
}

export function SessionHeader({ session }: { session: SessionRow }) {
  const verification = useAsync(() => getVerification(session.id), [session.id]);

  return (
    <header className="session-header">
      <h1>{session.title ?? session.id}</h1>
      <div className="session-meta">
        <span className="meta-item" title={session.cwd ?? session.project ?? undefined}>
          {projectLabel(session.project, session.cwd)}
        </span>
        {session.gitBranch && <span className="meta-item mono">{session.gitBranch}</span>}
        <span className="meta-item">{session.eventCount} events</span>
        {verification.status === "error" && (
          <span className="meta-item small">
            Integrity check unavailable: {verification.error.message}
          </span>
        )}
        {verification.status === "ready" && <VerificationBadge verification={verification.data} />}
      </div>
    </header>
  );
}
