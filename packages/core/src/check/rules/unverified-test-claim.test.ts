import { describe, expect, it } from "vitest";
import { sealEvents } from "../../chain.js";
import type { RetraceEventDraft } from "../../schema.js";
import { unverifiedTestClaimRule } from "./unverified-test-claim.js";

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
  return unverifiedTestClaimRule.run(sealEvents(drafts(items)), {});
}

describe("unverified-test-claim", () => {
  it("fires (low) when no test command ran after the last file change", () => {
    const findings = run([
      { kind: "file_change", payload: { path: "/repo/a.ts", operation: "edit", oldString: "x", newString: "y" } },
      { kind: "assistant_text", payload: { text: "All tests pass." } },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: "unverified-test-claim",
      severity: "low",
      seq: 1,
      relatedSeqs: [0],
    });
  });

  it("does not fire when a matching test command ran after the last file change and passed", () => {
    const findings = run([
      { kind: "file_change", payload: { path: "/repo/a.ts", operation: "edit", oldString: "x", newString: "y" } },
      { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t1", input: { command: "npm test" } } },
      { kind: "tool_result", payload: { toolUseId: "t1", output: "5 passed" } },
      { kind: "assistant_text", payload: { text: "All tests pass." } },
    ]);
    expect(findings).toEqual([]);
  });

  it("fires (medium) when the claim contradicts a recorded test failure", () => {
    const findings = run([
      { kind: "file_change", payload: { path: "/repo/a.ts", operation: "edit", oldString: "x", newString: "y" } },
      { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t1", input: { command: "npm test" } } },
      { kind: "tool_result", payload: { toolUseId: "t1", output: "3 failed", isError: true } },
      { kind: "assistant_text", payload: { text: "All tests pass." } },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: "medium", relatedSeqs: [0, 1] });
  });

  it("does not fire when there is no file change and no claim (no-op session)", () => {
    expect(run([{ kind: "assistant_text", payload: { text: "Let me look around." } }])).toEqual([]);
  });

  it("ignores a test run that happened before an intervening file change", () => {
    const findings = run([
      { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t1", input: { command: "npm test" } } },
      { kind: "tool_result", payload: { toolUseId: "t1", output: "5 passed" } },
      { kind: "file_change", payload: { path: "/repo/a.ts", operation: "edit", oldString: "x", newString: "y" } },
      { kind: "assistant_text", payload: { text: "All tests pass." } },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("low");
  });

  it("recognizes a verifying command run via the PowerShell tool, not just Bash", () => {
    const findings = run([
      { kind: "file_change", payload: { path: "/repo/a.ts", operation: "edit", oldString: "x", newString: "y" } },
      { kind: "tool_call", payload: { toolName: "PowerShell", toolUseId: "t1", input: { command: "pnpm test" } } },
      { kind: "tool_result", payload: { toolUseId: "t1", output: "5 passed" } },
      { kind: "assistant_text", payload: { text: "All tests pass." } },
    ]);
    expect(findings).toEqual([]);
  });

  it("does not reset verification on a trailing .md file_change (a memory/handoff note written after tests already passed)", () => {
    const findings = run([
      { kind: "file_change", payload: { path: "/repo/a.ts", operation: "edit", oldString: "x", newString: "y" } },
      { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t1", input: { command: "go build ./..." } } },
      { kind: "tool_result", payload: { toolUseId: "t1", output: "" } },
      { kind: "file_change", payload: { path: "/repo/memory/notes.md", operation: "write", afterRef: "h1" } },
      { kind: "assistant_text", payload: { text: "The build succeeds." } },
    ]);
    expect(findings).toEqual([]);
  });

  it("recognizes a build-passes claim the same way", () => {
    const findings = run([
      { kind: "file_change", payload: { path: "/repo/a.ts", operation: "edit", oldString: "x", newString: "y" } },
      { kind: "assistant_text", payload: { text: "The build succeeds." } },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain("the build passes");
  });
});
