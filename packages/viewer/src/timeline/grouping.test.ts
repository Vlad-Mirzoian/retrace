import type { RetraceEvent } from "retrace-core/browser";
import { describe, expect, it } from "vitest";
import { groupEvents, itemKey } from "./grouping.js";

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
