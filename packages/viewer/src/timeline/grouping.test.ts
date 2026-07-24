import type { RetraceEvent } from "retrace-core/browser";
import { describe, expect, it } from "vitest";
import { groupEvents, indexForSeq, itemKey, itemRange } from "./grouping.js";

let seq = 0;

function base(overrides: Partial<RetraceEvent> = {}) {
  return {
    seq: seq++,
    ts: "2026-07-15T14:37:00.000Z",
    sessionId: "sess-1",
    prevHash: null,
    hash: `h${seq}`,
    ...overrides,
  };
}

function prompt(text: string, sidechain?: true): RetraceEvent {
  return { ...base(), sidechain, kind: "user_prompt", payload: { text } } as RetraceEvent;
}

function toolCall(toolUseId: string, toolName = "Bash", sidechain?: true): RetraceEvent {
  return {
    ...base(),
    sidechain,
    kind: "tool_call",
    payload: { toolName, toolUseId, input: {} },
  } as RetraceEvent;
}

function toolResult(toolUseId: string, sidechain?: true, isError?: true): RetraceEvent {
  return {
    ...base(),
    sidechain,
    kind: "tool_result",
    payload: { toolUseId, output: "ok", ...(isError ? { isError } : {}) },
  } as RetraceEvent;
}

describe("groupEvents — tool pairing", () => {
  it("folds a tool_call together with its tool_result", () => {
    const call = toolCall("t1");
    const result = toolResult("t1");
    const items = groupEvents([call, result]);

    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("tool");
    if (items[0].kind === "tool") {
      expect(items[0].call).toBe(call);
      expect(items[0].result).toBe(result);
    }
  });

  it("pairs by toolUseId even when other events sit in between", () => {
    const call = toolCall("t1");
    const chatter = prompt("interruption");
    const result = toolResult("t1");
    const items = groupEvents([call, chatter, result]);

    // tool row + the interleaved prompt; the result is folded into the call.
    expect(items.map((i) => i.kind)).toEqual(["tool", "event"]);
    if (items[0].kind === "tool") expect(items[0].result).toBe(result);
  });

  it("keeps a tool_call with no result (still running / interrupted)", () => {
    const items = groupEvents([toolCall("t1")]);
    expect(items).toHaveLength(1);
    if (items[0].kind === "tool") expect(items[0].result).toBeUndefined();
  });

  it("keeps an orphan tool_result rather than dropping it", () => {
    const orphan = toolResult("no-such-call");
    const items = groupEvents([orphan]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("event");
  });

  it("does not pair unrelated calls that both lack a toolUseId", () => {
    const a = toolCall("");
    const b = toolCall("");
    const items = groupEvents([a, b]);
    expect(items).toHaveLength(2);
    if (items[0].kind === "tool") expect(items[0].result).toBeUndefined();
  });

  it("pairs each call with its own result across several tools", () => {
    const items = groupEvents([
      toolCall("t1", "Read"),
      toolResult("t1"),
      toolCall("t2", "Edit"),
      toolResult("t2"),
    ]);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.kind === "tool")).toBe(true);
  });
});

describe("groupEvents — subagent grouping", () => {
  it("collapses a contiguous sidechain run into one group", () => {
    const items = groupEvents([
      prompt("main"),
      prompt("sub work", true),
      toolCall("s1", "Glob", true),
      toolResult("s1", true),
      prompt("back to main"),
    ]);

    expect(items.map((i) => i.kind)).toEqual(["event", "subagent", "event"]);
    if (items[1].kind === "subagent") {
      // Tools are paired inside the group too.
      expect(items[1].items.map((i) => i.kind)).toEqual(["event", "tool"]);
    }
  });

  it("keeps separate subagent runs as separate groups", () => {
    const items = groupEvents([
      prompt("sub A", true),
      prompt("main"),
      prompt("sub B", true),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["subagent", "event", "subagent"]);
  });

  it("returns no groups when nothing is a sidechain", () => {
    const items = groupEvents([prompt("a"), prompt("b")]);
    expect(items.every((i) => i.kind === "event")).toBe(true);
  });

  it("handles an empty stream", () => {
    expect(groupEvents([])).toEqual([]);
  });
});

describe("itemKey", () => {
  it("is the starting event's seq for every row type", () => {
    const call = toolCall("t1");
    const result = toolResult("t1");
    const sub = prompt("sub", true);

    const items = groupEvents([call, result, sub]);
    expect(itemKey(items[0])).toBe(call.seq);
    expect(itemKey(items[1])).toBe(sub.seq);
  });

  it("gives distinct keys to every row of a real-shaped stream", () => {
    const items = groupEvents([
      prompt("a"),
      toolCall("t1"),
      toolResult("t1"),
      prompt("b", true),
      prompt("c"),
    ]);
    const keys = items.map(itemKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("itemRange", () => {
  it("is a single-seq range for a plain event", () => {
    const p = prompt("a");
    const items = groupEvents([p]);
    expect(itemRange(items[0])).toEqual([p.seq, p.seq]);
  });

  it("spans call..result for a tool row", () => {
    const call = toolCall("t1");
    const result = toolResult("t1");
    const items = groupEvents([call, result]);
    expect(itemRange(items[0])).toEqual([call.seq, result.seq]);
  });

  it("falls back to the call's own seq when a tool has no result yet", () => {
    const call = toolCall("t1");
    const items = groupEvents([call]);
    expect(itemRange(items[0])).toEqual([call.seq, call.seq]);
  });

  it("spans first..last inner event for a subagent group", () => {
    const items = groupEvents([
      prompt("main"),
      prompt("sub start", true),
      toolCall("s1", "Glob", true),
      toolResult("s1", true),
    ]);
    const subagent = items[1];
    expect(subagent.kind).toBe("subagent");
    if (subagent.kind === "subagent") {
      const first = subagent.items[0];
      const last = subagent.items[subagent.items.length - 1];
      const firstSeq = first.kind === "tool" ? first.call.seq : first.event.seq;
      const lastSeq = last.kind === "tool" ? (last.result?.seq ?? last.call.seq) : last.event.seq;
      expect(itemRange(subagent)).toEqual([firstSeq, lastSeq]);
    }
  });
});

describe("indexForSeq", () => {
  it("returns -1 for an empty list", () => {
    expect(indexForSeq([], 0)).toBe(-1);
  });

  it("finds the row containing an exact seq", () => {
    const call = toolCall("t1");
    const result = toolResult("t1");
    const trailing = prompt("after");
    const items = groupEvents([call, result, trailing]);

    expect(indexForSeq(items, call.seq)).toBe(0);
    expect(indexForSeq(items, result.seq)).toBe(0); // inside the tool row's span
    expect(indexForSeq(items, trailing.seq)).toBe(1);
  });

  it("snaps forward to the next visible row when seq falls in a filtered-out gap", () => {
    // Simulate a filter having hidden the middle event: items only has rows
    // for the first and third original events, with a gap seq in between.
    const first = prompt("a");
    const hidden = prompt("hidden"); // only its seq matters, to land the cursor in the gap
    const last = prompt("c");
    const items = groupEvents([first, last]);

    expect(indexForSeq(items, hidden.seq)).toBe(1);
  });

  it("snaps to the last row when seq is past everything currently visible", () => {
    const items = groupEvents([prompt("a"), prompt("b")]);
    const farSeq = itemKey(items[items.length - 1]) + 100;
    expect(indexForSeq(items, farSeq)).toBe(items.length - 1);
  });

  it("resolves into a subagent group's index when seq is inside its range", () => {
    const items = groupEvents([
      prompt("main"),
      prompt("sub", true),
      prompt("more sub", true),
      prompt("main again"),
    ]);
    const subagentSeq = items[1].kind === "subagent" ? items[1].items[1] : null;
    expect(subagentSeq).not.toBeNull();
    if (subagentSeq) {
      const innerSeq = subagentSeq.kind === "tool" ? subagentSeq.call.seq : subagentSeq.event.seq;
      expect(indexForSeq(items, innerSeq)).toBe(1);
    }
  });
});
