import type { RetraceEvent } from "retrace-core/browser";
import { describe, expect, it } from "vitest";
import { groupEvents, indexForSeq, itemKey, itemRange, leafAt } from "./grouping.js";

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

function fileChange(path: string, toolUseId?: string): RetraceEvent {
  return {
    ...base(),
    kind: "file_change",
    payload: { path, operation: "edit", toolUseId },
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

describe("groupEvents — a file_change right after its tool's result", () => {
  // The parser (packages/core/src/transcript/parse.ts) synthesizes an Edit's
  // file_change *after* the tool_result, specifically so this never happens:
  // if it landed *between* the call and result instead, the tool row's
  // [call, result] span would swallow the file_change row's own single-seq
  // range, and two rows would both claim the cursor at once — the replay
  // cursor gets stuck there (indexForSeq keeps re-resolving to the tool row)
  // and both rows show `.active` simultaneously. This is that scenario,
  // fixed: call, result, *then* file_change, so the ranges are disjoint.
  it("keeps the tool row's range and the file_change row's range disjoint", () => {
    const call = toolCall("t1", "Edit");
    const result = toolResult("t1");
    const change = fileChange("/a.ts", "t1");
    const items = groupEvents([call, result, change]);

    expect(items).toHaveLength(2);
    const [toolRow, fileRow] = items;
    expect(itemRange(toolRow)).toEqual([call.seq, result.seq]);
    expect(itemRange(fileRow)).toEqual([change.seq, change.seq]);
    // No seq is claimed by both rows.
    expect(change.seq).toBeGreaterThan(result.seq);
  });

  it("resolves the file_change's own seq to only the file row, never the tool row too", () => {
    const call = toolCall("t1", "Edit");
    const result = toolResult("t1");
    const change = fileChange("/a.ts", "t1");
    const items = groupEvents([call, result, change]);

    expect(indexForSeq(items, change.seq)).toBe(1);
    const leaf = leafAt(items, change.seq);
    expect(leaf?.kind === "event" && leaf.event.kind).toBe("file_change");
  });

  it("lets playback advance past the file_change instead of stalling on it", () => {
    // Regression for the exact hang: advancing seq-by-seq from the tool row
    // must reach the file row next, not keep re-resolving back to the tool
    // row (which is what an overlapping range caused).
    const call = toolCall("t1", "Edit");
    const result = toolResult("t1");
    const change = fileChange("/a.ts", "t1");
    const trailing = prompt("after");
    const items = groupEvents([call, result, change, trailing]);

    const toolIndex = indexForSeq(items, call.seq);
    const fileIndex = indexForSeq(items, change.seq);
    const trailingIndex = indexForSeq(items, trailing.seq);
    expect([toolIndex, fileIndex, trailingIndex]).toEqual([0, 1, 2]);
  });
});

describe("groupEvents — parallel tool calls (overlapping ranges)", () => {
  // Several tool calls fired in one turn (e.g. three Greps back to back) land
  // as call1, call2, call3, then their results — in whatever order they
  // finish — all *after* call3. Each row's range is [call.seq, result.seq],
  // so row1's range legitimately reaches past call2 and call3's own seqs:
  // ranges overlap. This is the real-world shape of the replay hang.
  function parallelCalls(n: number) {
    const calls = Array.from({ length: n }, (_, i) => toolCall(`t${i}`, "Grep"));
    const results = Array.from({ length: n }, (_, i) => toolResult(`t${i}`));
    const items = groupEvents([...calls, ...results]);
    return { calls, results, items };
  }

  it("gives each parallel call a row whose range overlaps its siblings'", () => {
    const { calls, results, items } = parallelCalls(3);
    expect(items).toHaveLength(3);
    expect(itemRange(items[0])).toEqual([calls[0].seq, results[0].seq]);
    expect(itemRange(items[1])).toEqual([calls[1].seq, results[1].seq]);
    // call2's own seq falls inside row0's range — the overlap.
    expect(calls[1].seq).toBeGreaterThanOrEqual(itemRange(items[0])[0]);
    expect(calls[1].seq).toBeLessThanOrEqual(itemRange(items[0])[1]);
  });

  it("resolves each call's own seq to its own row, not always the first overlapping one", () => {
    const { calls, items } = parallelCalls(4);
    expect(calls.map((call) => indexForSeq(items, call.seq))).toEqual([0, 1, 2, 3]);
  });

  it("leafAt resolves the same way — the tightest match, not the first containing one", () => {
    const { calls, items } = parallelCalls(4);
    for (const [i, call] of calls.entries()) {
      const leaf = leafAt(items, call.seq);
      expect(leaf?.kind === "tool" && leaf.call.payload.toolUseId).toBe(`t${i}`);
    }
  });

  it("lets playback step forward through every call instead of stalling on the first", () => {
    // Regression for the exact hang: from call[i]'s seq, indexForSeq + 1
    // must land on call[i+1]'s row — never keep re-resolving to row 0.
    const { calls, items } = parallelCalls(4);
    for (let i = 0; i < calls.length - 1; i++) {
      const index = indexForSeq(items, calls[i].seq);
      expect(index).toBe(i);
      expect(itemKey(items[index + 1])).toBe(calls[i + 1].seq);
    }
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

describe("leafAt", () => {
  it("returns null for an empty list", () => {
    expect(leafAt([], 0)).toBeNull();
  });

  it("finds a plain leaf by its exact seq", () => {
    const first = prompt("a");
    const second = prompt("b");
    const items = groupEvents([first, second]);

    const found = leafAt(items, second.seq);
    expect(found?.kind === "event" && found.event.seq).toBe(second.seq);
  });

  it("finds a tool row for any seq within its call..result span", () => {
    const call = toolCall("t1");
    const result = toolResult("t1");
    const items = groupEvents([call, result]);

    const found = leafAt(items, result.seq);
    expect(found?.kind === "tool" && found.call.payload.toolUseId).toBe("t1");
  });

  it("descends into a subagent group to find the inner leaf, unlike indexForSeq", () => {
    const sub1 = prompt("sub work", true);
    const sub2 = prompt("more sub work", true);
    const items = groupEvents([prompt("main"), sub1, sub2]);

    const found = leafAt(items, sub2.seq);
    expect(found?.kind === "event" && found.event.seq).toBe(sub2.seq);
  });

  it("never snaps — returns null for a seq no row covers, instead of the nearest one", () => {
    const first = prompt("a");
    const hidden = prompt("hidden");
    const last = prompt("c");
    const items = groupEvents([first, last]); // "hidden"'s seq falls in the gap

    expect(leafAt(items, hidden.seq)).toBeNull();
  });
});
