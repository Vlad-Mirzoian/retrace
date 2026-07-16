import type { RetraceEvent } from "retrace-core/browser";
import { describe, expect, it } from "vitest";
import {
  ALL_FILTER_KINDS,
  countEvents,
  filterItems,
  itemFilterKind,
  type FilterKind,
} from "./filter.js";
import { groupEvents } from "./grouping.js";

let seq = 0;
function base() {
  return {
    seq: seq++,
    ts: "2026-07-15T14:37:00.000Z",
    sessionId: "s",
    prevHash: null,
    hash: `h${seq}`,
  };
}

const prompt = (text: string, sidechain?: true): RetraceEvent =>
  ({ ...base(), sidechain, kind: "user_prompt", payload: { text } }) as RetraceEvent;

const assistant = (text: string, sidechain?: true): RetraceEvent =>
  ({ ...base(), sidechain, kind: "assistant_text", payload: { text } }) as RetraceEvent;

const toolCall = (toolUseId: string, toolName = "Bash"): RetraceEvent =>
  ({ ...base(), kind: "tool_call", payload: { toolName, toolUseId, input: {} } }) as RetraceEvent;

const toolResult = (toolUseId: string, output: unknown, isError?: true): RetraceEvent =>
  ({
    ...base(),
    kind: "tool_result",
    payload: { toolUseId, output, ...(isError ? { isError } : {}) },
  }) as RetraceEvent;

const fileChange = (path: string): RetraceEvent =>
  ({ ...base(), kind: "file_change", payload: { path, operation: "edit" } }) as RetraceEvent;

const meta = (): RetraceEvent =>
  ({ ...base(), kind: "meta", payload: { originalType: "queue-operation" } }) as RetraceEvent;

describe("itemFilterKind", () => {
  it("classifies a successful tool row as 'tool'", () => {
    const items = groupEvents([toolCall("t1"), toolResult("t1", "ok")]);
    expect(itemFilterKind(items[0] as never)).toBe("tool");
  });

  it("classifies a failed tool row as 'error'", () => {
    const items = groupEvents([toolCall("t1"), toolResult("t1", "boom", true)]);
    expect(itemFilterKind(items[0] as never)).toBe("error");
  });

  it("classifies boundary/meta kinds as 'other'", () => {
    const items = groupEvents([meta()]);
    expect(itemFilterKind(items[0] as never)).toBe("other");
  });

  it("passes through the plain event kinds it has dedicated buckets for", () => {
    const items = groupEvents([prompt("a"), assistant("b"), fileChange("/x")]);
    expect(items.map((i) => itemFilterKind(i as never))).toEqual([
      "user_prompt",
      "assistant_text",
      "file_change",
    ]);
  });
});

describe("filterItems — kind filter", () => {
  const events = [prompt("hello"), assistant("hi there"), toolCall("t1"), toolResult("t1", "ok")];
  const grouped = groupEvents(events);

  it("keeps everything when all kinds are active", () => {
    expect(filterItems(grouped, ALL_FILTER_KINDS, "")).toHaveLength(3);
  });

  it("drops rows whose kind is deselected", () => {
    const active = new Set(ALL_FILTER_KINDS);
    active.delete("tool");
    const result = filterItems(grouped, active, "");
    expect(result.every((i) => i.kind !== "tool")).toBe(true);
    expect(result).toHaveLength(2);
  });

  it("returns nothing when no kinds are active", () => {
    expect(filterItems(grouped, new Set(), "")).toEqual([]);
  });
});

describe("filterItems — text search", () => {
  const events = [prompt("fix the login bug"), assistant("looking into it"), fileChange("/auth.ts")];
  const grouped = groupEvents(events);

  it("is case-insensitive", () => {
    expect(filterItems(grouped, ALL_FILTER_KINDS, "LOGIN")).toHaveLength(1);
  });

  it("matches file_change rows by path", () => {
    const result = filterItems(grouped, ALL_FILTER_KINDS, "auth.ts");
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("event");
  });

  it("matches tool rows by tool name or output text", () => {
    const toolEvents = groupEvents([toolCall("t1", "Grep"), toolResult("t1", "no matches found")]);
    expect(filterItems(toolEvents, ALL_FILTER_KINDS, "grep")).toHaveLength(1);
    expect(filterItems(toolEvents, ALL_FILTER_KINDS, "no matches")).toHaveLength(1);
    expect(filterItems(toolEvents, ALL_FILTER_KINDS, "nonexistent-term")).toHaveLength(0);
  });

  it("returns everything (that passes the kind filter) for an empty/whitespace query", () => {
    expect(filterItems(grouped, ALL_FILTER_KINDS, "   ")).toHaveLength(3);
  });
});

describe("filterItems — subagent groups", () => {
  it("keeps a subagent group with only its matching rows when partially matched", () => {
    const events = [
      prompt("main"),
      prompt("find the bug", true),
      assistant("unrelated chatter", true),
    ];
    const grouped = groupEvents(events);
    const result = filterItems(grouped, ALL_FILTER_KINDS, "bug");

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("subagent");
    if (result[0].kind === "subagent") expect(result[0].items).toHaveLength(1);
  });

  it("drops a subagent group entirely when nothing inside matches", () => {
    const events = [prompt("main"), prompt("subagent work", true)];
    const grouped = groupEvents(events);
    expect(filterItems(grouped, ALL_FILTER_KINDS, "no-such-term")).toEqual([]);
  });
});

describe("countEvents", () => {
  it("sums to the raw event count when nothing is filtered out", () => {
    const events = [prompt("a"), assistant("b"), toolCall("t1"), toolResult("t1", "ok")];
    const grouped = groupEvents(events);
    expect(countEvents(grouped)).toBe(events.length);
  });

  it("counts an unpaired tool call as one event, not two", () => {
    const grouped = groupEvents([toolCall("t1")]);
    expect(countEvents(grouped)).toBe(1);
  });

  it("counts every leaf inside a subagent group", () => {
    const events = [prompt("sub a", true), prompt("sub b", true)];
    const grouped = groupEvents(events);
    expect(countEvents(grouped)).toBe(2);
  });

  it("reflects the reduced total after filtering", () => {
    const events = [prompt("a"), assistant("b"), toolCall("t1"), toolResult("t1", "ok")];
    const grouped = groupEvents(events);
    const active: ReadonlySet<FilterKind> = new Set(["user_prompt"]);
    expect(countEvents(filterItems(grouped, active, ""))).toBe(1);
  });
});
