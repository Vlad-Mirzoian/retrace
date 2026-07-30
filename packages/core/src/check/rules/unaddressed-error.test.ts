import { describe, expect, it } from "vitest";
import { sealEvents } from "../../chain.js";
import type { RetraceEventDraft } from "../../schema.js";
import { unaddressedErrorRule } from "./unaddressed-error.js";

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
  return unaddressedErrorRule.run(sealEvents(drafts(items)), {});
}

describe("unaddressed-error", () => {
  it("fires with high severity when a failure is the last thing in the session", () => {
    const findings = run([
      { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t1", input: { command: "npm test" } } },
      { kind: "tool_result", payload: { toolUseId: "t1", output: "3 tests failed", isError: true } },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: "unaddressed-error",
      severity: "high",
      seq: 1,
      relatedSeqs: [0],
      detail: "3 tests failed",
    });
  });

  it("does not fire when a matching retry (same tool, same target) follows", () => {
    const findings = run([
      { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t1", input: { command: "npm test" } } },
      { kind: "tool_result", payload: { toolUseId: "t1", output: "failed", isError: true } },
      { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t2", input: { command: "npm test" } } },
      { kind: "tool_result", payload: { toolUseId: "t2", output: "passed" } },
    ]);
    expect(findings).toEqual([]);
  });

  it("does not fire when a file_change follows, even an unrelated one", () => {
    const findings = run([
      { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t1", input: { command: "npm test" } } },
      { kind: "tool_result", payload: { toolUseId: "t1", output: "failed", isError: true } },
      { kind: "file_change", payload: { path: "/repo/a.ts", operation: "edit", oldString: "x", newString: "y" } },
    ]);
    expect(findings).toEqual([]);
  });

  it("does not fire when a user_prompt follows (the human took over)", () => {
    const findings = run([
      { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t1", input: { command: "npm test" } } },
      { kind: "tool_result", payload: { toolUseId: "t1", output: "failed", isError: true } },
      { kind: "user_prompt", payload: { text: "let me handle this" } },
    ]);
    expect(findings).toEqual([]);
  });

  it("fires with high severity when a failed test/build command has no follow-up action, even with trailing text", () => {
    const findings = run([
      { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t1", input: { command: "npm test" } } },
      { kind: "tool_result", payload: { toolUseId: "t1", output: "failed", isError: true } },
      { kind: "assistant_text", payload: { text: "The fix looks correct." } },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("high");
  });

  it("fires with medium severity for a non-test/build failure mid-session, when unrelated tool activity follows", () => {
    const findings = run([
      { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t1", input: { command: "rm stale-file.txt" } } },
      { kind: "tool_result", payload: { toolUseId: "t1", output: "rm: cannot remove", isError: true } },
      { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t2", input: { command: "ls" } } },
      { kind: "tool_result", payload: { toolUseId: "t2", output: "some-file.txt" } },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("medium");
  });

  it("excludes failures from read-only lookup tools (Read/Glob/Grep/LS)", () => {
    const findings = run([
      { kind: "tool_call", payload: { toolName: "Read", toolUseId: "t1", input: { file_path: "/repo/config.json" } } },
      { kind: "tool_result", payload: { toolUseId: "t1", output: "ENOENT", isError: true } },
      { kind: "assistant_text", payload: { text: "The config file does not exist yet." } },
    ]);
    expect(findings).toEqual([]);
  });

  it("fires for a standalone error event with no tool linkage", () => {
    const findings = run([{ kind: "error", payload: { message: "session crashed" } }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: "high", relatedSeqs: undefined });
  });

  it("tags a finding anchored in a subagent branch as sidechain", () => {
    const findings = run([
      {
        kind: "tool_call",
        payload: { toolName: "Bash", toolUseId: "t1", input: { command: "npm test" } },
        sidechain: true,
      },
      {
        kind: "tool_result",
        payload: { toolUseId: "t1", output: "failed", isError: true },
        sidechain: true,
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].sidechain).toBe(true);
  });
});
