import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sealEvents } from "../chain.js";
import { parseTranscript } from "../transcript/index.js";
import type { RetraceEventDraft } from "../schema.js";
import { RULES, runChecks } from "./index.js";
import type { CheckFinding, CheckRule } from "./types.js";

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

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url)), "utf8");
}

describe("RULES", () => {
  it("registers all five rules", () => {
    expect(RULES.map((r) => r.id)).toEqual([
      "edit-without-read",
      "unaddressed-error",
      "unverified-test-claim",
      "claimed-change-missing",
      "untracked-bash-mutation",
    ]);
  });

  it("gives every claim-verification rule a low or medium default severity, never high", () => {
    for (const rule of RULES) {
      if (["unverified-test-claim", "claimed-change-missing", "untracked-bash-mutation"].includes(rule.id)) {
        expect(rule.defaultSeverity).not.toBe("high");
      }
    }
  });
});

describe("runChecks", () => {
  const events = sealEvents(
    drafts([
      { kind: "file_change", payload: { path: "/repo/a.ts", operation: "edit", oldString: "x", newString: "y" } }, // 0: edit-without-read
      { kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t1", input: { command: "npm test" } } }, // 1
      { kind: "tool_result", payload: { toolUseId: "t1", output: "failed", isError: true } }, // 2: unaddressed-error
    ]),
  );

  it("runs every registered rule and reports which ran", () => {
    const report = runChecks("sess-1", events);
    expect(report.sessionId).toBe("sess-1");
    expect(report.eventCount).toBe(3);
    expect(report.rulesRun).toEqual(RULES.map((r) => r.id));
    expect(report.rulesSkipped).toEqual([]);
    // Only two of the five registered rules find anything in this tiny fixture.
    expect(report.findings.map((f) => f.ruleId)).toEqual(["edit-without-read", "unaddressed-error"]);
  });

  it("sorts findings by seq ascending, then ruleId", () => {
    const report = runChecks("sess-1", events);
    expect(report.findings.map((f) => f.seq)).toEqual([0, 2]);
  });

  it("skips a disabled rule", () => {
    const report = runChecks("sess-1", events, { disabled: ["edit-without-read"] });
    expect(report.rulesRun).toEqual(RULES.map((r) => r.id).filter((id) => id !== "edit-without-read"));
    expect(report.findings.map((f) => f.ruleId)).toEqual(["unaddressed-error"]);
  });

  it("applies a per-rule severity override to that rule's findings", () => {
    const report = runChecks("sess-1", events, { severity: { "edit-without-read": "low" } });
    const finding = report.findings.find((f) => f.ruleId === "edit-without-read");
    expect(finding?.severity).toBe("low");
    const other = report.findings.find((f) => f.ruleId === "unaddressed-error");
    expect(other?.severity).toBe("high");
  });

  it("isolates a throwing rule into rulesSkipped without losing other rules' findings", () => {
    const throwingRule: CheckRule = {
      id: "throws-always",
      description: "always throws, for testing runChecks's isolation",
      defaultSeverity: "low",
      run(): CheckFinding[] {
        throw new Error("boom");
      },
    };
    const report = runChecks("sess-1", events, {}, [throwingRule, ...RULES]);
    expect(report.rulesSkipped).toEqual([{ ruleId: "throws-always", reason: "boom" }]);
    expect(report.rulesRun).toEqual(RULES.map((r) => r.id));
    expect(report.findings.map((f) => f.ruleId)).toEqual(["edit-without-read", "unaddressed-error"]);
  });
});

describe("runChecks against canonical fixtures", () => {
  function checkedEvents(fixtureName: string, sessionId: string) {
    const parsed = parseTranscript(fixture(fixtureName), sessionId);
    return sealEvents(parsed.events);
  }

  it("returns zero findings for the clean basic-session fixture", () => {
    const report = runChecks("sess-basic", checkedEvents("basic-session.jsonl", "sess-basic"));
    expect(report.findings).toEqual([]);
    expect(report.rulesSkipped).toEqual([]);
  });

  it("returns exactly one stable finding per rule for the flagged-session fixture", () => {
    const report = runChecks("sess-flagged", checkedEvents("flagged-session.jsonl", "sess-flagged"));
    expect(report.rulesSkipped).toEqual([]);
    expect(report.findings).toEqual([
      {
        ruleId: "edit-without-read",
        severity: "medium",
        title: "/repo/calc.ts edited without being read",
        detail: "This edit has no preceding Read tool call for this path in the session.",
        seq: 5,
        path: "/repo/calc.ts",
        toolUseId: "toolu_edit1",
      },
      {
        ruleId: "unaddressed-error",
        severity: "medium",
        title: "npm test failed with no follow-up",
        detail: "Error: 3 tests failed in calc.test.ts",
        seq: 8,
        relatedSeqs: [7],
        path: undefined,
        toolUseId: "toolu_bash1",
      },
      {
        ruleId: "claimed-change-missing",
        severity: "low",
        title: "src/utils/helpers.ts claimed changed, but no matching file_change was recorded",
        detail: "I also updated src/utils/helpers.ts to add a null check.",
        seq: 10,
        path: "src/utils/helpers.ts",
      },
      {
        ruleId: "unverified-test-claim",
        severity: "medium",
        title: "Claimed tests pass, but the last test run failed",
        detail: "All tests pass now.",
        seq: 10,
        relatedSeqs: [5, 7],
      },
      {
        ruleId: "untracked-bash-mutation",
        severity: "medium",
        title: "Bash command (rm) may have modified files outside Retrace's record",
        detail: "rm -rf dist",
        seq: 11,
        toolUseId: "toolu_rm1",
      },
    ]);
  });
});
