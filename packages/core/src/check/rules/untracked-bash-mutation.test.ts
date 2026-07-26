import { describe, expect, it } from "vitest";
import { sealEvents } from "../../chain.js";
import type { RetraceEventDraft } from "../../schema.js";
import { untrackedBashMutationRule } from "./untracked-bash-mutation.js";

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
  return untrackedBashMutationRule.run(sealEvents(drafts(items)), {});
}

describe("untracked-bash-mutation", () => {
  it("fires for an rm command", () => {
    const findings = run([
      { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t1", input: { command: "rm -rf dist" } } },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: "untracked-bash-mutation",
      severity: "medium",
      seq: 0,
      detail: "rm -rf dist",
    });
  });

  it("does not fire for a read-only command", () => {
    const findings = run([
      { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t1", input: { command: "ls -la" } } },
    ]);
    expect(findings).toEqual([]);
  });

  it("also recognizes mutations run via the PowerShell tool", () => {
    const findings = run([
      { kind: "tool_call", payload: { toolName: "PowerShell", toolUseId: "t1", input: { command: "Remove-Item -Recurse dist" } } },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain("PowerShell command");
  });

  it("does not fire for a non-shell tool call", () => {
    const findings = run([
      { kind: "tool_call", payload: { toolName: "Write", toolUseId: "t1", input: { file_path: "/a.ts", content: "x" } } },
    ]);
    expect(findings).toEqual([]);
  });

  it("recognizes output redirection as a mutation shape", () => {
    const findings = run([
      { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t1", input: { command: "echo '{}' > config.json" } } },
    ]);
    expect(findings).toHaveLength(1);
  });

  it("recognizes sed -i, mv, git checkout, and package installs", () => {
    const commands = [
      "sed -i 's/foo/bar/' file.ts",
      "mv old.ts new.ts",
      "git checkout -- .",
      "npm install left-pad",
    ];
    for (const command of commands) {
      const findings = run([
        { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t1", input: { command } } },
      ]);
      expect(findings, command).toHaveLength(1);
    }
  });

  it("collapses repeats into one finding per distinct mutation shape, not per invocation", () => {
    const findings = run([
      { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t1", input: { command: "rm a.txt" } } },
      { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t2", input: { command: "rm b.txt" } } },
      { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t3", input: { command: "mv b.txt c.txt" } } },
    ]);
    expect(findings.map((f) => f.detail)).toEqual(["rm a.txt", "mv b.txt c.txt"]);
  });

  it("truncates a long command to the 120-char house style", () => {
    const command = `rm ${"a".repeat(150)}.txt`;
    const findings = run([
      { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t1", input: { command } } },
    ]);
    expect(findings[0].detail?.length).toBeLessThanOrEqual(120);
    expect(findings[0].detail?.endsWith("…")).toBe(true);
  });
});
