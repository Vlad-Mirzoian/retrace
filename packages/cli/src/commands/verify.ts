import { verifyChain, type ChainVerification, type RetraceStore } from "retrace-core";
import { collectAllEvents } from "../events.js";

export interface VerifyResult {
  sessionId: string;
  eventCount: number;
  verification: ChainVerification;
}

/**
 * Verify a session's tamper-evident hash chain: every event's hash matches
 * its recorded contents, `prevHash` links are intact, and `seq` is
 * contiguous. Surfaces `chain.ts`'s `verifyChain` on demand, rather than only
 * ever checking it implicitly.
 *
 * `idOrPrefix` may be a full session id or a unique prefix, same as `export`.
 */
export function verifySession(store: RetraceStore, idOrPrefix: string): VerifyResult {
  const sessionId = store.resolveSessionId(idOrPrefix);
  try {
    const { events, truncatedAt } = collectAllEvents(store, sessionId);
    const chainVerification = verifyChain(events);
    
    if (!chainVerification.ok || !truncatedAt) {
      return { sessionId, eventCount: events.length, verification: chainVerification };
    }
    return {
      sessionId,
      eventCount: events.length,
      verification: {
        ok: false,
        index: truncatedAt.seq,
        reason: `events.jsonl could not be read from seq ${truncatedAt.seq} onward: ${truncatedAt.reason}`,
      },
    };
  } catch (err) {
    // A harder failure than a corrupted row — e.g. events.jsonl is missing
    // entirely, not just desynced (collectAllEvents no longer throws for a
    // corrupted row; see above) — with no specific seq to point at.
    const reason = err instanceof Error ? err.message : String(err);
    return {
      sessionId,
      eventCount: 0,
      verification: { ok: false, index: -1, reason: `events.jsonl could not be read: ${reason}` },
    };
  }
}

export interface VerifyAllSummary {
  results: VerifyResult[];
  /** Sessions whose chain failed verification. */
  failed: VerifyResult[];
}

/** Verify every recorded session's hash chain. */
export function verifyAll(store: RetraceStore): VerifyAllSummary {
  const results = store.listSessions().map((session) => verifySession(store, session.id));
  return { results, failed: results.filter((result) => !result.verification.ok) };
}
