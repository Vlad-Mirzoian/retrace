import { describe, expect, it } from "vitest";
import { sealEvents } from "./chain.js";
import { alignRuns } from "./compare.js";
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

describe("alignRuns", () => {
  it("matches an identical sequence entirely", () => {
    const events = sealEvents(
      drafts([
        { kind: "user_prompt", payload: { text: "fix the bug" } },
        { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t1", input: { command: "ls" } } },
        { kind: "tool_result", payload: { toolUseId: "t1", output: "ok" } },
      ]),
    );
    const rows = alignRuns(events, events);
    expect(rows.map((r) => r.status)).toEqual(["match", "match", "match"]);
    expect(rows.every((r) => r.a && r.b)).toBe(true);
  });

  it("marks an aligned tool_call as changed when its input differs, not merely absent", () => {
    const a = sealEvents(
      drafts([
        { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t1", input: { command: "ls" } } },
      ]),
    );
    const b = sealEvents(
      drafts([
        { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t2", input: { command: "pwd" } } },
      ]),
    );
    const rows = alignRuns(a, b);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("changed");
    expect(rows[0].a).toBe(a[0]);
    expect(rows[0].b).toBe(b[0]);
  });

  it("marks a file_change as changed when its content ref differs at the same path+operation", () => {
    const a = sealEvents(
      drafts([{ kind: "file_change", payload: { path: "a.txt", operation: "write", afterRef: "h1" } }]),
    );
    const b = sealEvents(
      drafts([{ kind: "file_change", payload: { path: "a.txt", operation: "write", afterRef: "h2" } }]),
    );
    const rows = alignRuns(a, b);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("changed");
  });

  it("aligns a file_change as a match when path, operation, and content ref are all identical", () => {
    const a = sealEvents(
      drafts([{ kind: "file_change", payload: { path: "a.txt", operation: "write", afterRef: "h1" } }]),
    );
    const b = sealEvents(
      drafts([{ kind: "file_change", payload: { path: "a.txt", operation: "write", afterRef: "h1" } }]),
    );
    const rows = alignRuns(a, b);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("match");
    expect(rows[0].a).toBe(a[0]);
    expect(rows[0].b).toBe(b[0]);
  });

  it("reports an event only present in run A", () => {
    const a = sealEvents(drafts([{ kind: "user_prompt", payload: { text: "unique to a" } }]));
    const rows = alignRuns(a, []);
    expect(rows).toEqual([{ a: a[0], status: "only-a" }]);
  });

  it("reports an event only present in run B", () => {
    const b = sealEvents(drafts([{ kind: "user_prompt", payload: { text: "unique to b" } }]));
    const rows = alignRuns([], b);
    expect(rows).toEqual([{ b: b[0], status: "only-b" }]);
  });

  it("treats prompts with different text as unaligned only-a/only-b pairs, not a changed match — a documented v1 limitation", () => {
    const a = sealEvents(drafts([{ kind: "user_prompt", payload: { text: "do X" } }]));
    const b = sealEvents(drafts([{ kind: "user_prompt", payload: { text: "do Y" } }]));
    const rows = alignRuns(a, b);
    expect(rows.map((r) => r.status)).toEqual(["only-a", "only-b"]);
  });

  it("correctly interleaves matched, only-a, and only-b rows around a real edit", () => {
    const a = sealEvents(
      drafts([
        { kind: "tool_call", payload: { toolName: "Read", toolUseId: "t1", input: {} } },
        { kind: "tool_call", payload: { toolName: "Edit", toolUseId: "t2", input: {} } },
        { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t3", input: {} } },
      ]),
    );
    const b = sealEvents(
      drafts([
        { kind: "tool_call", payload: { toolName: "Read", toolUseId: "t1", input: {} } },
        { kind: "tool_call", payload: { toolName: "Grep", toolUseId: "t9", input: {} } },
        { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t3", input: {} } },
      ]),
    );
    const rows = alignRuns(a, b);
    expect(rows.map((r) => r.status)).toEqual(["match", "only-a", "only-b", "match"]);
    expect(rows[0].a).toBe(a[0]);
    expect(rows[0].b).toBe(b[0]);
    expect(rows[1].a).toBe(a[1]); // Edit, only in A
    expect(rows[2].b).toBe(b[1]); // Grep, only in B
    expect(rows[3].a).toBe(a[2]);
    expect(rows[3].b).toBe(b[2]);
  });

  it("handles two empty runs", () => {
    expect(alignRuns([], [])).toEqual([]);
  });
});
