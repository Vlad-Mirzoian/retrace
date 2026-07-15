import { describe, expect, it } from "vitest";
import {
  EVENT_KINDS,
  PAYLOAD_SCHEMAS,
  RetraceEvent,
  RetraceEventDraft,
  isKind,
} from "./schema.js";

const baseSealed = {
  seq: 0,
  ts: "2026-07-15T14:37:00.000Z",
  sessionId: "sess-1",
  prevHash: null,
  hash: "abc123",
};

describe("PAYLOAD_SCHEMAS", () => {
  it("has an entry for every event kind", () => {
    for (const kind of EVENT_KINDS) {
      expect(PAYLOAD_SCHEMAS[kind]).toBeDefined();
    }
    expect(Object.keys(PAYLOAD_SCHEMAS)).toHaveLength(EVENT_KINDS.length);
  });
});

describe("RetraceEvent (sealed)", () => {
  it("accepts a well-formed tool_call event", () => {
    const event = {
      ...baseSealed,
      kind: "tool_call",
      payload: {
        toolName: "Read",
        toolUseId: "toolu_1",
        input: { file_path: "/tmp/x.md" },
      },
    };
    const parsed = RetraceEvent.parse(event);
    expect(parsed.kind).toBe("tool_call");
    // Discriminated union narrows payload by kind:
    if (isKind(parsed, "tool_call")) {
      expect(parsed.payload.toolName).toBe("Read");
    }
  });

  it("accepts a session_start with only optional fields omitted", () => {
    expect(() =>
      RetraceEvent.parse({
        ...baseSealed,
        kind: "session_start",
        payload: {},
      }),
    ).not.toThrow();
  });

  it("carries prevHash for a chained event and null for the first", () => {
    const first = RetraceEvent.parse({
      ...baseSealed,
      kind: "meta",
      payload: { originalType: "queue-operation" },
    });
    expect(first.prevHash).toBeNull();

    const second = RetraceEvent.parse({
      ...baseSealed,
      seq: 1,
      prevHash: "abc123",
      hash: "def456",
      kind: "meta",
      payload: {},
    });
    expect(second.prevHash).toBe("abc123");
  });

  it("marks subagent branch events via the sidechain flag", () => {
    const parsed = RetraceEvent.parse({
      ...baseSealed,
      sidechain: true,
      kind: "assistant_text",
      payload: { text: "working in a sidechain" },
    });
    expect(parsed.sidechain).toBe(true);
  });
});

describe("RetraceEvent rejects malformed events", () => {
  it("rejects an unknown kind", () => {
    const result = RetraceEvent.safeParse({
      ...baseSealed,
      kind: "totally_made_up",
      payload: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload that mismatches its kind", () => {
    // user_prompt requires `text`; provide the wrong shape.
    const result = RetraceEvent.safeParse({
      ...baseSealed,
      kind: "user_prompt",
      payload: { notText: 1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a sealed event missing its hash", () => {
    const result = RetraceEvent.safeParse({
      seq: 0,
      ts: baseSealed.ts,
      sessionId: "sess-1",
      prevHash: null,
      kind: "thinking",
      payload: { text: "hmm" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative seq", () => {
    const result = RetraceEvent.safeParse({
      ...baseSealed,
      seq: -1,
      kind: "meta",
      payload: {},
    });
    expect(result.success).toBe(false);
  });
});

describe("RetraceEventDraft (unsealed)", () => {
  it("accepts a draft without seq/prevHash/hash", () => {
    const draft = RetraceEventDraft.parse({
      ts: baseSealed.ts,
      sessionId: "sess-1",
      kind: "user_prompt",
      payload: { text: "what did the agent do at 14:37?" },
    });
    expect(draft.kind).toBe("user_prompt");
    expect("hash" in draft).toBe(false);
  });

  it("still validates the payload against its kind", () => {
    const result = RetraceEventDraft.safeParse({
      ts: baseSealed.ts,
      sessionId: "sess-1",
      kind: "file_change",
      payload: { path: "/a", operation: "nonsense" },
    });
    expect(result.success).toBe(false);
  });
});
