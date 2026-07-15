import { describe, expect, it } from "vitest";
import {
  canonicalJSON,
  hashObject,
  sealEvent,
  sealEvents,
  verifyChain,
} from "./chain.js";
import type { RetraceEvent, RetraceEventDraft } from "./schema.js";

function draft(text: string): RetraceEventDraft {
  return {
    ts: "2026-07-15T14:37:00.000Z",
    sessionId: "sess-1",
    kind: "assistant_text",
    payload: { text },
  };
}

describe("canonicalJSON", () => {
  it("is stable regardless of key insertion order", () => {
    const a = canonicalJSON({ b: 1, a: 2, nested: { y: 1, x: 2 } });
    const b = canonicalJSON({ nested: { x: 2, y: 1 }, a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it("preserves array order", () => {
    expect(canonicalJSON([3, 1, 2])).toBe("[3,1,2]");
  });

  it("drops undefined values", () => {
    expect(canonicalJSON({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("produces different hashes for different content", () => {
    expect(hashObject({ a: 1 })).not.toBe(hashObject({ a: 2 }));
  });
});

describe("sealEvent", () => {
  it("stamps seq, prevHash and a content hash", () => {
    const event = sealEvent(draft("hello"), 0, null);
    expect(event.seq).toBe(0);
    expect(event.prevHash).toBeNull();
    expect(event.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for identical inputs", () => {
    const a = sealEvent(draft("hello"), 0, null);
    const b = sealEvent(draft("hello"), 0, null);
    expect(a.hash).toBe(b.hash);
  });
});

describe("sealEvents + verifyChain", () => {
  const drafts = [draft("one"), draft("two"), draft("three")];

  it("produces a valid, linked chain", () => {
    const chain = sealEvents(drafts);
    expect(chain.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(chain[0].prevHash).toBeNull();
    expect(chain[1].prevHash).toBe(chain[0].hash);
    expect(chain[2].prevHash).toBe(chain[1].hash);
    expect(verifyChain(chain)).toEqual({ ok: true });
  });

  it("can continue an existing chain from a given seq/prevHash", () => {
    const first = sealEvents(drafts);
    const last = first[first.length - 1];
    const more = sealEvents([draft("four")], first.length, last.hash);
    expect(more[0].seq).toBe(3);
    expect(more[0].prevHash).toBe(last.hash);
    expect(verifyChain([...first, ...more])).toEqual({ ok: true });
  });

  it("detects a tampered payload", () => {
    const chain = sealEvents(drafts);
    // Mutate an event's contents after sealing, leaving its hash stale.
    const tampered = chain.map((e) => ({ ...e })) as RetraceEvent[];
    (tampered[1].payload as { text: string }).text = "MALICIOUS";
    const result = verifyChain(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.index).toBe(1);
      expect(result.reason).toMatch(/tampered/);
    }
  });

  it("detects a reordered / broken link", () => {
    const chain = sealEvents(drafts);
    const reordered = [chain[0], chain[2], chain[1]];
    const result = verifyChain(reordered);
    expect(result.ok).toBe(false);
  });

  it("detects a deleted event (broken prevHash)", () => {
    const chain = sealEvents(drafts);
    const withHole = [chain[0], chain[2]];
    const result = verifyChain(withHole);
    expect(result.ok).toBe(false);
  });
});
