import type { SessionRow } from "retrace-core/browser";

export function SessionHeader({ session }: { session: SessionRow }) {
  return (
    <>
      <h1>{session.title ?? session.id}</h1>
      <p className="muted">
        {session.project ?? "—"} · {session.gitBranch ?? "—"} · {session.eventCount} events
      </p>
    </>
  );
}
