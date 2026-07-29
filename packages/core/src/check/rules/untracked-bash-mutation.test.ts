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

function bash(toolUseId: string, command: string) {
  return { kind: "tool_call" as const, payload: { toolName: "Bash", toolUseId, input: { command } } };
}

describe("untracked-bash-mutation", () => {
  it("fires for an rm command", () => {
    const findings = run([bash("t1", "rm -rf temp-dist")]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: "untracked-bash-mutation",
      severity: "medium",
      seq: 0,
      detail: "rm -rf temp-dist",
      path: "temp-dist",
    });
  });

  it("does not fire for a read-only command", () => {
    const findings = run([bash("t1", "ls -la")]);
    expect(findings).toEqual([]);
  });

  it("also recognizes mutations run via the PowerShell tool", () => {
    const findings = run([
      { kind: "tool_call", payload: { toolName: "PowerShell", toolUseId: "t1", input: { command: "Remove-Item -Recurse build-output" } } },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ path: "build-output", severity: "medium" });
  });

  it("does not fire for a non-shell tool call", () => {
    const findings = run([
      { kind: "tool_call", payload: { toolName: "Write", toolUseId: "t1", input: { file_path: "/a.ts", content: "x" } } },
    ]);
    expect(findings).toEqual([]);
  });

  it("recognizes output redirection as a mutation shape and names the target file", () => {
    const findings = run([bash("t1", "echo x > src/generated.ts")]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      path: "src/generated.ts",
      severity: "medium",
      title: "src/generated.ts may have been modified by a shell command, outside Retrace's record",
    });
  });

  it("does not fire for stderr redirected to a null sink, in any form", () => {
    for (const command of ["some-cmd 2>/dev/null", "some-cmd 2>NUL", "some-cmd 2>$null"]) {
      expect(run([bash("t1", command)]), command).toEqual([]);
    }
  });

  it("does not fire for a stream merge redirect", () => {
    for (const command of ["some-cmd 2>&1", "some-cmd >&2"]) {
      expect(run([bash("t1", command)]), command).toEqual([]);
    }
  });

  it("still fires for a real stderr-to-file redirect", () => {
    const findings = run([bash("t1", "some-cmd 2>err.log")]);
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe("err.log");
  });

  it("recognizes sed -i, mv, git checkout, and package installs", () => {
    const commands = [
      "sed -i 's/foo/bar/' file.ts",
      "mv old.ts new.ts",
      "git checkout -- .",
      "npm install left-pad",
    ];
    for (const command of commands) {
      const findings = run([bash("t1", command)]);
      expect(findings, command).toHaveLength(1);
    }
  });

  it("resolves cp's destination as the path, not the source", () => {
    const findings = run([bash("t1", "cp a.ts b.ts")]);
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe("b.ts");
  });

  it("demotes housekeeping shapes with no resolvable target to low", () => {
    for (const command of ["mkdir -p dist", "npm install left-pad", "git checkout -- ."]) {
      const findings = run([bash("t1", command)]);
      expect(findings, command).toHaveLength(1);
      expect(findings[0].severity, command).toBe("low");
    }
  });

  it("demotes a resolved path in a transient location (node_modules/dist/.git/tmp) to low", () => {
    const findings = run([bash("t1", "cp a.ts dist/a.ts")]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ path: "dist/a.ts", severity: "low" });
  });

  it("collapses repeats into one finding per distinct (shape, resolved path), not per invocation", () => {
    const findings = run([bash("t1", "rm a.txt"), bash("t2", "rm a.txt"), bash("t3", "mv b.txt c.txt")]);
    expect(findings.map((f) => f.path)).toEqual(["a.txt", "c.txt"]);
  });

  it("keeps two cp commands to different destinations as two distinct findings", () => {
    const findings = run([bash("t1", "cp a.ts out1.ts"), bash("t2", "cp a.ts out2.ts")]);
    expect(findings.map((f) => f.path)).toEqual(["out1.ts", "out2.ts"]);
  });

  it("caps per-session findings, trailing with one summary of the remainder", () => {
    const calls = Array.from({ length: 11 }, (_, i) => bash(`t${i}`, `cp a.ts out${i}.ts`));
    const findings = run(calls);
    expect(findings.length).toBeLessThanOrEqual(10);
    const summary = findings[findings.length - 1];
    expect(summary.path).toBeUndefined();
    expect(summary.severity).toBe("low");
    expect(summary.title).toMatch(/more untracked-bash-mutation finding\(s\)/);
  });

  it("truncates a long command to the 120-char house style", () => {
    const command = `rm ${"a".repeat(150)}.txt`;
    const findings = run([bash("t1", command)]);
    expect(findings[0].detail?.length).toBeLessThanOrEqual(120);
    expect(findings[0].detail?.endsWith("…")).toBe(true);
  });
});
