import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_ANNOTATIONS, formatGithub } from "./github.js";
import type { RetraceReport } from "../report.js";

function reportFinding(overrides: Partial<RetraceReport["findings"][number]> = {}): RetraceReport["findings"][number] {
  return {
    ruleId: "edit-without-read",
    severity: "medium",
    title: "src/a.ts edited without being read",
    seq: 1,
    sessionId: "sess-1",
    repoPath: "src/a.ts",
    ...overrides,
  };
}

function report(overrides: Partial<RetraceReport> = {}): RetraceReport {
  return {
    version: 1,
    generatedAt: "2026-07-29T00:00:00.000Z",
    tool: { name: "retrace", version: "0.4.0" },
    range: { base: "main", head: "abc123" },
    sessions: [
      { id: "sess-1", startedAt: null, endedAt: null, commits: ["abc123"], confidence: "exact" },
    ],
    findings: [],
    rulesRun: ["edit-without-read"],
    rulesSkipped: [],
    ...overrides,
  };
}

describe("formatGithub", () => {
  it("maps severity to the correct GitHub annotation level", () => {
    const r = report({
      findings: [
        reportFinding({ severity: "high", seq: 1 }),
        reportFinding({ severity: "medium", seq: 2 }),
        reportFinding({ severity: "low", seq: 3 }),
      ],
    });
    const { annotations } = formatGithub(r);
    expect(annotations.map((a) => a.level)).toEqual(["error", "warning", "notice"]);
  });

  it("excludes a finding with no repoPath from annotations but keeps it in the summary", () => {
    const r = report({
      findings: [
        reportFinding({ seq: 1 }),
        reportFinding({ seq: 2, repoPath: undefined, path: "/abs/outside/repo.ts", title: "unattributed finding" }),
      ],
    });
    const { annotations, summaryMarkdown } = formatGithub(r);
    expect(annotations).toHaveLength(1);
    expect(summaryMarkdown).toContain("unattributed finding");
    expect(summaryMarkdown).toContain("2 finding(s)");
  });

  it("excludes a finding outside the changed-file list from annotations, noting it in the summary", () => {
    const r = report({
      findings: [
        reportFinding({ seq: 1, repoPath: "src/in-diff.ts" }),
        reportFinding({ seq: 2, repoPath: "src/outside-diff.ts", title: "not in this PR" }),
      ],
    });
    const { annotations, summaryMarkdown } = formatGithub(r, { changedFiles: ["src/in-diff.ts"] });
    expect(annotations).toHaveLength(1);
    expect(annotations[0].file).toBe("src/in-diff.ts");
    expect(summaryMarkdown).toContain("not in this PR");
    expect(summaryMarkdown).toMatch(/1 finding\(s\) fall outside this diff/);
  });

  it("caps annotations at maxAnnotations, sorted by severity then seq, and surfaces the omitted count in the summary", () => {
    const findings = Array.from({ length: 25 }, (_, i) =>
      reportFinding({ seq: i, repoPath: `src/f${i}.ts`, title: `finding ${i}` }),
    );
    const r = report({ findings });
    const { annotations, summaryMarkdown } = formatGithub(r);
    expect(annotations).toHaveLength(DEFAULT_MAX_ANNOTATIONS);
    expect(summaryMarkdown).toMatch(/5 annotation\(s\) omitted — capped at 20/);
  });

  it("respects a custom maxAnnotations and orders high severity before low regardless of seq", () => {
    const r = report({
      findings: [
        reportFinding({ seq: 1, severity: "low", repoPath: "a.ts", title: "low finding" }),
        reportFinding({ seq: 2, severity: "high", repoPath: "b.ts", title: "high finding" }),
      ],
    });
    const { annotations } = formatGithub(r, { maxAnnotations: 1 });
    expect(annotations).toHaveLength(1);
    expect(annotations[0].title).toBe("high finding");
  });

  it("produces a valid 'no findings' summary for an empty report", () => {
    const r = report({ findings: [], rulesRun: ["edit-without-read", "unaddressed-error"] });
    const { annotations, annotationLines, summaryMarkdown } = formatGithub(r);
    expect(annotations).toEqual([]);
    expect(annotationLines).toEqual([]);
    expect(summaryMarkdown).toMatch(/No findings — 2 rule\(s\) run\./);
  });

  it("names skipped rules in the summary, distinct from a clean pass", () => {
    const r = report({ rulesSkipped: [{ ruleId: "flaky-rule", reason: "needs snapshots" }] });
    const { summaryMarkdown } = formatGithub(r);
    expect(summaryMarkdown).toContain("flaky-rule");
    expect(summaryMarkdown).toContain("needs snapshots");
  });

  it("notes findings omitted at report-assembly time separately from annotation-cap omissions", () => {
    const r = report({
      findings: [reportFinding()],
      findingsOmitted: 12,
    });
    const { summaryMarkdown } = formatGithub(r);
    expect(summaryMarkdown).toMatch(/12 additional finding\(s\) were left out when the report was assembled/);
  });

  it("names the session id and local command in the summary footer", () => {
    const r = report({ findings: [reportFinding({ sessionId: "sess-42" })] });
    const { summaryMarkdown } = formatGithub(r, { localCommand: "retrace ui" });
    expect(summaryMarkdown).toContain("retrace ui");
    expect(summaryMarkdown).toContain("sess-42");
  });

  describe("escaping", () => {
    it("produces a single well-formed workflow command line for a title with %, a newline, and ::", () => {
      const r = report({
        findings: [
          reportFinding({
            title: 'suspicious :: title 100% "broken"?\nsecond line',
            detail: "clean message body, no special characters here",
            repoPath: "weird/file.ts",
          }),
        ],
      });
      const { annotationLines } = formatGithub(r);
      expect(annotationLines).toHaveLength(1);
      const line = annotationLines[0];

      // Exactly one physical line — a raw newline would split this into two workflow commands.
      expect(line).not.toMatch(/\r|\n/);
      expect(line.startsWith("::warning file=weird/file.ts,line=1,title=")).toBe(true);

      // % escaped first so the escape sequences themselves aren't re-escaped.
      expect(line).toContain("100%25");
      // The embedded "::" inside the title must not be readable as the property-list terminator:
      // only the real, final "::" (right before the message) should survive as a literal "::".
      const doubleColonCount = (line.match(/::/g) ?? []).length;
      expect(doubleColonCount).toBe(2); // "::warning" prefix, and the properties/message separator
      expect(line).toContain("%3A%3A"); // the title's own "::" is fully escaped
      expect(line).toContain("%0A"); // the embedded newline
    });

    it("percent-encodes a message body without needing colon/comma escaping", () => {
      const r = report({
        findings: [
          reportFinding({
            title: "plain title",
            detail: "100% reproducible, see a:b for details",
            repoPath: "a.ts",
          }),
        ],
      });
      const { annotationLines } = formatGithub(r);
      expect(annotationLines[0]).toContain("100%25 reproducible, see a:b for details");
    });
  });

  it("matches GitHub's documented workflow-command syntax exactly for a simple finding", () => {
    const r = report({
      findings: [reportFinding({ severity: "high", repoPath: "src/a.ts", title: "boom", detail: "kaboom" })],
    });
    const { annotationLines } = formatGithub(r);
    expect(annotationLines).toEqual(["::error file=src/a.ts,line=1,title=boom::kaboom"]);
  });
});
