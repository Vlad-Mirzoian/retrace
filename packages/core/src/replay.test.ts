import { describe, expect, it } from "vitest";
import { sealEvents } from "./chain.js";
import {
  buildNavIndex,
  causalChainFor,
  changesForPath,
  fileStateAt,
  filePathsTouched,
  fileStatusesAt,
  nextOfKind,
} from "./replay.js";
import type { RetraceEventDraft } from "./schema.js";

const ts = "2026-07-15T14:37:00.000Z";

// Mirrors chain.ts's own `as unknown as RetraceEvent` idiom: spreading a
// discriminated union loses the kind↔payload correlation at the type level,
// but each object below is a valid draft by construction.
function drafts(
  items: Array<{ kind: RetraceEventDraft["kind"]; payload: unknown; sidechain?: boolean }>,
): RetraceEventDraft[] {
  return items.map((item) => ({
    ts,
    sessionId: "sess-1",
    ...item,
  })) as unknown as RetraceEventDraft[];
}

describe("fileStateAt", () => {
  const events = sealEvents(
    drafts([
      {
        kind: "file_change",
        payload: {
          path: "a.txt",
          operation: "create",
          beforeRef: undefined,
          afterRef: "hash-a1",
        },
      },
      {
        kind: "file_change",
        payload: { path: "b.txt", operation: "write", beforeRef: "hash-b0", afterRef: "hash-b1" },
      },
      {
        kind: "file_change",
        payload: { path: "a.txt", operation: "edit", oldString: "x", newString: "y" },
      },
      {
        kind: "file_change",
        payload: { path: "b.txt", operation: "delete" },
      },
    ]),
  );

  it("reflects only changes at or before the cursor", () => {
    const state = fileStateAt(events, 0);
    expect([...state.keys()]).toEqual(["a.txt"]);
    expect(state.get("a.txt")).toMatchObject({ ref: "hash-a1", atSeq: 0, hadSnapshot: true });
  });

  it("tracks the latest afterRef per path, degrading to hadSnapshot=false when none is captured", () => {
    const state = fileStateAt(events, 2);
    expect(state.get("a.txt")).toMatchObject({
      ref: undefined,
      operation: "edit",
      atSeq: 2,
      hadSnapshot: false,
    });
    expect(state.get("b.txt")).toMatchObject({ ref: "hash-b1", atSeq: 1, hadSnapshot: true });
  });

  it("removes a path from the working tree once it's deleted", () => {
    const state = fileStateAt(events, 3);
    expect(state.has("b.txt")).toBe(false);
    expect(state.has("a.txt")).toBe(true);
  });

  it("seeds originalRef from the earliest beforeRef seen for a path", () => {
    const state = fileStateAt(events, 1);
    expect(state.get("b.txt")?.originalRef).toBe("hash-b0");
    expect(state.get("a.txt")?.originalRef).toBeUndefined();
  });
});

describe("fileStatusesAt", () => {
  const events = sealEvents(
    drafts([
      { kind: "file_change", payload: { path: "a.txt", operation: "create", afterRef: "hash-a1" } }, // 0
      { kind: "file_change", payload: { path: "b.txt", operation: "write", afterRef: "hash-b1" } }, // 1
      { kind: "file_change", payload: { path: "a.txt", operation: "edit", oldString: "x", newString: "y" } }, // 2
      { kind: "file_change", payload: { path: "b.txt", operation: "delete" } }, // 3
    ]),
  );

  it("lists only paths touched at or before the cursor, sorted by path", () => {
    expect(fileStatusesAt(events, 0).map((e) => e.path)).toEqual(["a.txt"]);
    expect(fileStatusesAt(events, 1).map((e) => e.path)).toEqual(["a.txt", "b.txt"]);
  });

  it("marks a live path with its current ref and hadSnapshot", () => {
    const entry = fileStatusesAt(events, 1).find((e) => e.path === "a.txt");
    expect(entry).toMatchObject({ operation: "create", atSeq: 0, ref: "hash-a1", hadSnapshot: true, deleted: false });
  });

  it("degrades hadSnapshot to false for a change with no captured content (create->edit)", () => {
    const entry = fileStatusesAt(events, 2).find((e) => e.path === "a.txt");
    expect(entry).toMatchObject({ operation: "edit", atSeq: 2, ref: undefined, hadSnapshot: false, deleted: false });
  });

  it("still lists a deleted path — unlike fileStateAt — flagged as deleted", () => {
    const statuses = fileStatusesAt(events, 3);
    const b = statuses.find((e) => e.path === "b.txt");
    expect(statuses.map((e) => e.path)).toContain("b.txt");
    expect(b).toMatchObject({ operation: "delete", atSeq: 3, ref: undefined, hadSnapshot: false, deleted: true });
    // a.txt is unaffected by b.txt's deletion.
    expect(statuses.find((e) => e.path === "a.txt")?.deleted).toBe(false);
  });
});

describe("filePathsTouched / changesForPath", () => {
  const events = sealEvents(
    drafts([
      { kind: "file_change", payload: { path: "a.txt", operation: "create", afterRef: "h1" } },
      { kind: "file_change", payload: { path: "b.txt", operation: "create", afterRef: "h2" } },
      { kind: "file_change", payload: { path: "a.txt", operation: "edit", oldString: "x", newString: "y" } },
    ]),
  );

  it("lists every distinct path in first-touched order", () => {
    expect(filePathsTouched(events)).toEqual(["a.txt", "b.txt"]);
  });

  it("returns a path's changes in seq order", () => {
    const changes = changesForPath(events, "a.txt");
    expect(changes.map((c) => c.seq)).toEqual([0, 2]);
  });
});

describe("buildNavIndex", () => {
  const events = sealEvents(
    drafts([
      { kind: "user_prompt", payload: { text: "go" } }, // 0
      { kind: "tool_call", payload: { toolName: "Task", toolUseId: "t1", input: {} } }, // 1
      { kind: "user_prompt", payload: { text: "sub" }, sidechain: true }, // 2
      { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t2", input: {} }, sidechain: true }, // 3
      { kind: "tool_result", payload: { toolUseId: "t2", output: "boom", isError: true }, sidechain: true }, // 4
      { kind: "subagent_stop", payload: {} }, // 5
      { kind: "file_change", payload: { path: "a.txt", operation: "create", afterRef: "h1" } }, // 6
      { kind: "error", payload: { message: "top-level failure" } }, // 7
    ]),
  );

  const index = buildNavIndex(events);

  it("collects error seqs from both error events and failed tool_results", () => {
    expect(index.errors).toEqual([4, 7]);
  });

  it("collects file_change, prompt, and tool_call seqs", () => {
    expect(index.fileChanges).toEqual([6]);
    expect(index.prompts).toEqual([0, 2]);
    expect(index.toolCalls).toEqual([1, 3]);
  });

  it("finds the contiguous sidechain run as one subagent range", () => {
    expect(index.subagentRanges).toEqual([{ startSeq: 2, endSeq: 4, parentToolUseId: undefined }]);
  });

  describe("nextOfKind", () => {
    it("finds the next error strictly after a given seq", () => {
      expect(nextOfKind(index, 0, "errors", 1)).toBe(4);
      expect(nextOfKind(index, 4, "errors", 1)).toBe(7);
      expect(nextOfKind(index, 7, "errors", 1)).toBeNull();
    });

    it("finds the previous error strictly before a given seq", () => {
      expect(nextOfKind(index, 7, "errors", -1)).toBe(4);
      expect(nextOfKind(index, 4, "errors", -1)).toBeNull();
    });
  });
});

describe("causalChainFor", () => {
  const events = sealEvents(
    drafts([
      { kind: "tool_call", payload: { toolName: "Edit", toolUseId: "t1", input: {} } }, // 0
      {
        kind: "file_change",
        payload: { path: "a.txt", operation: "edit", toolUseId: "t1", oldString: "x", newString: "y" },
      }, // 1
      { kind: "tool_result", payload: { toolUseId: "t1", output: "ok" } }, // 2
      { kind: "error", payload: { message: "unrelated" } }, // 3
    ]),
  );

  it("resolves the call/result pair and file changes from any anchor seq sharing the toolUseId", () => {
    const chain = causalChainFor(events, 2);
    expect(chain.toolCall?.seq).toBe(0);
    expect(chain.toolResult?.seq).toBe(2);
    expect(chain.fileChanges.map((f) => f.seq)).toEqual([1]);
  });

  it("returns an empty chain for events with no toolUseId linkage", () => {
    expect(causalChainFor(events, 3)).toEqual({ fileChanges: [] });
  });
});
