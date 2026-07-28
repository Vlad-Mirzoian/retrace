import type { RetraceStore } from "retrace-core";

export interface DeleteSessionsSummary {
  deleted: string[];
  /** An id/prefix that couldn't be resolved (unknown or ambiguous) — the rest of the batch still runs. */
  failed: { input: string; error: string }[];
}

/**
 * Permanently delete one or more sessions: their row, events, and
 * import-tracking state, plus their on-disk `events.jsonl`/`raw.jsonl`. CAS
 * objects are left in place (no reference counting/GC yet — see
 * {@link RetraceStore.deleteSession}), so this doesn't reclaim snapshot
 * storage; `retrace reset` is the only way to do that today.
 *
 * A failure resolving one id/prefix (unknown, or ambiguous) is recorded in
 * `failed` rather than thrown, so one bad id in a batch doesn't stop the rest
 * from being deleted.
 */
export function deleteSessions(
  store: RetraceStore,
  idsOrPrefixes: string[],
): DeleteSessionsSummary {
  const deleted: string[] = [];
  const failed: { input: string; error: string }[] = [];

  for (const input of idsOrPrefixes) {
    try {
      const sessionId = store.resolveSessionId(input);
      store.deleteSession(sessionId);
      deleted.push(sessionId);
    } catch (err) {
      failed.push({ input, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { deleted, failed };
}
