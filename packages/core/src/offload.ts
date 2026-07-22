import type { ContentStore } from "./cas.js";

/**
 * Strings at or above this size are moved out of the event and into the CAS.
 * A handful of events (long tool outputs, long reasoning) account for most of
 * a session's bytes, so keeping them out of `events.jsonl` keeps the event log
 * small and lets identical bodies (the same file read twice, the same command
 * re-run) collapse to one stored object.
 */
export const OFFLOAD_THRESHOLD_BYTES = 8 * 1024;

/** Marker that replaces an offloaded string in the stored JSONL. */
interface OffloadRef {
  $retraceRef: string;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;

function isOffloadRef(value: unknown): value is OffloadRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const ref = (value as OffloadRef).$retraceRef;
  return typeof ref === "string" && HASH_PATTERN.test(ref);
}

function deflateValue(value: unknown, store: ContentStore, refs: string[]): unknown {
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") < OFFLOAD_THRESHOLD_BYTES) return value;
    const hash = store.putSync(value);
    refs.push(hash);
    return { $retraceRef: hash } satisfies OffloadRef;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deflateValue(item, store, refs));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = deflateValue(item, store, refs);
    }
    return out;
  }
  return value;
}

function inflateValue(value: unknown, store: ContentStore): unknown {
  if (isOffloadRef(value)) return store.getTextSync(value.$retraceRef);
  if (Array.isArray(value)) return value.map((item) => inflateValue(item, store));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = inflateValue(item, store);
    }
    return out;
  }
  return value;
}

/**
 * Move every oversized string in a payload into the CAS, returning the storage
 * form plus the hashes it now references.
 *
 * Runs *before* the event is sealed, so the resulting `artifactRefs` are part
 * of the hashed content — and the hash itself still covers the true, inflated
 * payload. Tampering with a CAS object therefore changes what
 * {@link inflateEvent} returns, and the recomputed hash stops matching.
 */
export function deflatePayload(
  payload: unknown,
  store: ContentStore,
): { payload: unknown; refs: string[] } {
  const refs: string[] = [];
  const deflated = deflateValue(payload, store, refs);
  return { payload: deflated, refs };
}

/** Restore an event read from storage to its full, schema-valid form. */
export function inflateEvent(
  stored: Record<string, unknown>,
  store: ContentStore,
): Record<string, unknown> {
  return { ...stored, payload: inflateValue(stored.payload, store) };
}
