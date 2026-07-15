import { createHash } from "node:crypto";
import type { RetraceEvent, RetraceEventDraft } from "./schema.js";

/**
 * Deterministic JSON serialization: object keys are sorted recursively and
 * `undefined` values are dropped, so semantically-equal values always produce
 * the same string (and therefore the same hash) regardless of key order.
 * Arrays keep their order — order is meaningful there.
 */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const v = source[key];
      if (v !== undefined) out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

/** sha256 (hex) of the canonical form of any JSON-serializable value. */
export function hashObject(value: unknown): string {
  return createHash("sha256").update(canonicalJSON(value)).digest("hex");
}

/** Recompute an event's hash from its contents, excluding the stored `hash`. */
function contentHash(event: RetraceEvent): string {
  const clone: Record<string, unknown> = { ...event };
  delete clone.hash;
  return hashObject(clone);
}

/**
 * Seal a draft event into the hash chain: assign its position (`seq`), link it
 * to the previous event (`prevHash`), and stamp its own `hash`. The hash covers
 * every field except `hash` itself, so any later mutation is detectable.
 */
export function sealEvent(
  draft: RetraceEventDraft,
  seq: number,
  prevHash: string | null,
): RetraceEvent {
  // Spreading a discriminated union loses the kind↔payload correlation at the
  // type level, but the runtime object is a valid sealed event by construction.
  const base = { ...draft, seq, prevHash };
  const hash = hashObject(base);
  return { ...base, hash } as unknown as RetraceEvent;
}

/**
 * Seal an ordered list of drafts into a chain, each linked to the one before.
 * `startSeq`/`startPrevHash` let callers continue an existing session's chain
 * (e.g. incremental import appending to already-stored events).
 */
export function sealEvents(
  drafts: RetraceEventDraft[],
  startSeq = 0,
  startPrevHash: string | null = null,
): RetraceEvent[] {
  const sealed: RetraceEvent[] = [];
  let seq = startSeq;
  let prevHash = startPrevHash;
  for (const draft of drafts) {
    const event = sealEvent(draft, seq, prevHash);
    sealed.push(event);
    prevHash = event.hash;
    seq += 1;
  }
  return sealed;
}

export type ChainVerification =
  | { ok: true }
  | { ok: false; index: number; reason: string };

/**
 * Verify the internal consistency of an ordered event slice: each event's hash
 * matches its contents (tamper-evidence), each `prevHash` links to the prior
 * event, and `seq` is contiguous. The first event's `prevHash` is not checked
 * against anything — a slice may legitimately start mid-session.
 */
export function verifyChain(events: RetraceEvent[]): ChainVerification {
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (i > 0 && ev.prevHash !== events[i - 1].hash) {
      return { ok: false, index: i, reason: "prevHash does not match previous event's hash" };
    }
    if (i > 0 && ev.seq !== events[i - 1].seq + 1) {
      return { ok: false, index: i, reason: "seq is not contiguous" };
    }
    if (contentHash(ev) !== ev.hash) {
      return { ok: false, index: i, reason: "event hash does not match contents (tampered)" };
    }
  }
  return { ok: true };
}
