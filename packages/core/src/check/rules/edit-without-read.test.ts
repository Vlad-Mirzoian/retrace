import { describe, expect, it } from "vitest";
import { sealEvents } from "../../chain.js";
import type { RetraceEventDraft } from "../../schema.js";
import { editWithoutReadRule } from "./edit-without-read.js";

const ts = "2026-07-15T14:37:00.000Z";

function drafts(
  items: Array<{ kind: RetraceEventDraft["kind"]; payload: unknown; sidechain?: boolean }>,
): RetraceEventDraft[] {
  return items.map((item) => ({
    ts,
    sessionId: "sess-1",
    ...item,
  })) as unknown as RetraceEventDraft[];
}

function run(items: Array<{ kind: RetraceEventDraft["kind"]; payload: unknown; sidechain?: boolean }>) {
  return editWithoutReadRule.run(sealEvents(drafts(items)), {});
}

describe("edit-without-read", () => {
  it("fires when a file is edited without a preceding Read in the session", () => {
    const findings = run([
      { kind: "file_change", payload: { path: "/repo/a.ts", operation: "edit", oldString: "x", newString: "y" } },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: "edit-without-read",
      severity: "medium",
      seq: 0,
      path: "/repo/a.ts",
    });
  });

  it("does not fire when the path was read earlier in the session", () => {
    const findings = run([
      { kind: "tool_call", payload: { toolName: "Read", toolUseId: "t1", input: { file_path: "/repo/a.ts" } } },
      { kind: "file_change", payload: { path: "/repo/a.ts", operation: "edit", oldString: "x", newString: "y" } },
    ]);
    expect(findings).toEqual([]);
  });

  it("does not fire for a file created earlier in this session", () => {
    const findings = run([
      { kind: "file_change", payload: { path: "/repo/new.ts", operation: "create", afterRef: "h1" } },
      { kind: "file_change", payload: { path: "/repo/new.ts", operation: "edit", oldString: "x", newString: "y" } },
    ]);
    expect(findings).toEqual([]);
  });

  it("does not fire for a Write to a path with no beforeRef (a Write to a nonexistent file)", () => {
    const findings = run([
      { kind: "file_change", payload: { path: "/repo/new.ts", operation: "write", afterRef: "h1" } },
    ]);
    expect(findings).toEqual([]);
  });

  it("still fires for a Write that overwrites a pre-existing file (beforeRef present) with no prior read", () => {
    const findings = run([
      { kind: "file_change", payload: { path: "/repo/a.ts", operation: "write", beforeRef: "h0", afterRef: "h1" } },
    ]);
    expect(findings).toHaveLength(1);
  });

  it("fires only once per path across repeated edits", () => {
    const findings = run([
      { kind: "file_change", payload: { path: "/repo/a.ts", operation: "edit", oldString: "x", newString: "y" } },
      { kind: "file_change", payload: { path: "/repo/a.ts", operation: "edit", oldString: "y", newString: "z" } },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].seq).toBe(0);
  });

  it("matches a Windows-style backslash path from Read against a forward-slash path from the later edit", () => {
    const findings = run([
      { kind: "tool_call", payload: { toolName: "Read", toolUseId: "t1", input: { file_path: "C:\\repo\\a.ts" } } },
      { kind: "file_change", payload: { path: "C:/repo/a.ts", operation: "edit", oldString: "x", newString: "y" } },
    ]);
    expect(findings).toEqual([]);
  });

  it("tags a finding from a subagent branch as sidechain, while a parent-session read still covers it", () => {
    const covered = run([
      { kind: "tool_call", payload: { toolName: "Read", toolUseId: "t1", input: { file_path: "/repo/a.ts" } } },
      {
        kind: "file_change",
        payload: { path: "/repo/a.ts", operation: "edit", oldString: "x", newString: "y" },
        sidechain: true,
      },
    ]);
    expect(covered).toEqual([]);

    const uncovered = run([
      {
        kind: "file_change",
        payload: { path: "/repo/b.ts", operation: "edit", oldString: "x", newString: "y" },
        sidechain: true,
      },
    ]);
    expect(uncovered).toHaveLength(1);
    expect(uncovered[0].sidechain).toBe(true);
  });
});
