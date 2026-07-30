import { describe, expect, it } from "vitest";
import { buildReport, RETRACE_REPORT_VERSION, type SessionReportInput } from "./report.js";
import type { CheckFinding, CheckReport } from "./check/types.js";
import type { SessionCommitLink } from "./link.js";
import type { SessionRow } from "./schema.js";

function session(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "sess-1",
    project: null,
    cwd: "D:\\Projects\\Retrace\\retrace",
    gitBranch: null,
    ccVersion: null,
    permissionMode: null,
    title: null,
    startedAt: "2026-07-15T14:00:00.000Z",
    endedAt: "2026-07-15T14:30:00.000Z",
    eventCount: 3,
    toolCallCount: 1,
    ...overrides,
  };
}

function link(overrides: Partial<SessionCommitLink> = {}): SessionCommitLink {
  return {
    sessionId: "sess-1",
    commitSha: "abc123",
    repoRoot: "D:/Projects/Retrace/retrace",
    confidence: "exact",
    linkedAt: "2026-07-15T14:30:00.000Z",
    ...overrides,
  };
}

function finding(overrides: Partial<CheckFinding> = {}): CheckFinding {
  return {
    ruleId: "edit-without-read",
    severity: "medium",
    title: "a.ts edited without being read",
    seq: 3,
    ...overrides,
  };
}

function checkReport(overrides: Partial<CheckReport> = {}): CheckReport {
  return {
    sessionId: "sess-1",
    eventCount: 3,
    findings: [],
    rulesRun: ["edit-without-read"],
    rulesSkipped: [],
    ...overrides,
  };
}

function baseOptions(overrides: Partial<Parameters<typeof buildReport>[1]> = {}) {
  return {
    range: { base: "main", head: "HEAD" },
    commitShasInRange: ["abc123"],
    repoRoot: "D:/Projects/Retrace/retrace",
    toolVersion: "0.4.0",
    ...overrides,
  };
}

describe("buildReport", () => {
  it("stamps the report version", () => {
    const report = buildReport([], baseOptions());
    expect(report.version).toBe(RETRACE_REPORT_VERSION);
  });

  it("produces a valid, empty report for an empty range, without throwing", () => {
    const report = buildReport([], baseOptions({ commitShasInRange: [] }));
    expect(report).toMatchObject({ sessions: [], findings: [], rulesRun: [], rulesSkipped: [] });
    expect(report.findingsOmitted).toBeUndefined();
  });

  it("excludes a session whose only linked commit is outside the range", () => {
    const input: SessionReportInput = {
      session: session(),
      report: checkReport({ findings: [finding()] }),
      links: [link({ commitSha: "not-in-range" })],
    };
    const report = buildReport([input], baseOptions({ commitShasInRange: ["abc123"] }));
    expect(report.sessions).toEqual([]);
    expect(report.findings).toEqual([]);
  });

  it("includes a session whose linked commit is inside the range, with its findings", () => {
    const input: SessionReportInput = {
      session: session(),
      report: checkReport({ findings: [finding()] }),
      links: [link({ commitSha: "abc123" })],
    };
    const report = buildReport([input], baseOptions());
    expect(report.sessions).toEqual([
      {
        id: "sess-1",
        startedAt: "2026-07-15T14:00:00.000Z",
        endedAt: "2026-07-15T14:30:00.000Z",
        commits: ["abc123"],
        confidence: "exact",
      },
    ]);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].sessionId).toBe("sess-1");
  });

  it("populates repoPath for a finding whose absolute path is inside the repo", () => {
    const input: SessionReportInput = {
      session: session(),
      report: checkReport({
        findings: [finding({ path: "D:\\Projects\\Retrace\\retrace\\packages\\core\\src\\store.ts" })],
      }),
      links: [link()],
    };
    const report = buildReport([input], baseOptions());
    expect(report.findings[0].repoPath).toBe("packages/core/src/store.ts");
  });

  it("leaves repoPath absent when the finding has no path", () => {
    const input: SessionReportInput = {
      session: session(),
      report: checkReport({ findings: [finding({ path: undefined })] }),
      links: [link()],
    };
    const report = buildReport([input], baseOptions());
    expect(report.findings[0].repoPath).toBeUndefined();
  });

  it("leaves repoPath absent when the finding's path is outside the repo", () => {
    const input: SessionReportInput = {
      session: session(),
      report: checkReport({ findings: [finding({ path: "D:\\Elsewhere\\file.ts" })] }),
      links: [link()],
    };
    const report = buildReport([input], baseOptions());
    expect(report.findings[0].repoPath).toBeUndefined();
  });

  it("reports 'exact' confidence when any in-range link for the session is exact", () => {
    const input: SessionReportInput = {
      session: session(),
      report: checkReport(),
      links: [
        link({ commitSha: "abc123", confidence: "inferred" }),
        link({ commitSha: "def456", confidence: "exact" }),
      ],
    };
    const report = buildReport([input], baseOptions({ commitShasInRange: ["abc123", "def456"] }));
    expect(report.sessions[0].confidence).toBe("exact");
  });

  it("reports 'inferred' confidence only when every in-range link is inferred", () => {
    const input: SessionReportInput = {
      session: session(),
      report: checkReport(),
      links: [link({ commitSha: "abc123", confidence: "inferred" })],
    };
    const report = buildReport([input], baseOptions());
    expect(report.sessions[0].confidence).toBe("inferred");
  });

  it("dedupes rulesRun and rulesSkipped across sessions", () => {
    const inputA: SessionReportInput = {
      session: session({ id: "sess-a" }),
      report: checkReport({
        rulesRun: ["edit-without-read", "unaddressed-error"],
        rulesSkipped: [{ ruleId: "claimed-change-missing", reason: "no snapshots" }],
      }),
      links: [link({ sessionId: "sess-a" })],
    };
    const inputB: SessionReportInput = {
      session: session({ id: "sess-b" }),
      report: checkReport({
        rulesRun: ["edit-without-read"],
        rulesSkipped: [{ ruleId: "claimed-change-missing", reason: "no snapshots" }],
      }),
      links: [link({ sessionId: "sess-b" })],
    };
    const report = buildReport([inputA, inputB], baseOptions());
    expect(report.rulesRun.sort()).toEqual(["edit-without-read", "unaddressed-error"]);
    expect(report.rulesSkipped).toEqual([{ ruleId: "claimed-change-missing", reason: "no snapshots" }]);
  });

  it("caps findings at assembly time and records how many were omitted", () => {
    const findings = Array.from({ length: 5 }, (_, i) => finding({ seq: i }));
    const input: SessionReportInput = {
      session: session(),
      report: checkReport({ findings }),
      links: [link()],
    };
    const report = buildReport([input], baseOptions({ maxFindings: 3 }));
    expect(report.findings).toHaveLength(3);
    expect(report.findingsOmitted).toBe(2);
  });

  it("does not set findingsOmitted when under the cap", () => {
    const input: SessionReportInput = {
      session: session(),
      report: checkReport({ findings: [finding()] }),
      links: [link()],
    };
    const report = buildReport([input], baseOptions({ maxFindings: 3 }));
    expect(report.findingsOmitted).toBeUndefined();
  });
});
