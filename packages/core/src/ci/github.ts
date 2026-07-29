import type { Severity } from "../check/types.js";
import type { RetraceReport } from "../report.js";

/**
 * Turns an already-assembled `RetraceReport` into the two things a GitHub
 * job can display: inline annotations (workflow commands on stdout — no
 * token, no `checks: write` permission, no GitHub App install) and a
 * markdown job summary. Pure string formatting, no Node imports, so this is
 * safe to re-export from `browser.ts` and unit-test without a filesystem or
 * a git repo. See module-06-ci-output-format.md for the design and the
 * research it's constrained by: findings only, never transcript content;
 * bounded by a documented cap, not a hidden one; non-blocking by default
 * (an `error`-level annotation is cosmetic — only the process exit code,
 * governed by `--fail-on`, fails a step).
 */

export interface GitHubAnnotation {
  level: "notice" | "warning" | "error";
  /** Repo-relative POSIX path. */
  file: string;
  line: number;
  title: string;
  message: string;
}

export interface FormatGithubOptions {
  /**
   * Repo-relative POSIX paths of files the commit range/PR actually
   * touches. A finding whose `repoPath` isn't in this set stays in the
   * summary table but is dropped from annotations — an annotation on a
   * file the diff doesn't show is invisible in review and pure noise
   * elsewhere. Omit to annotate every finding that has a `repoPath`,
   * regardless of diff membership.
   */
  changedFiles?: string[];
  /** Cap on emitted annotations — a documented input, not a hidden constant. */
  maxAnnotations?: number;
  /** Local command named in the summary footer as how to inspect a finding in context, keeping the transcript itself off the PR. */
  localCommand?: string;
}

export interface FormatGithubResult {
  annotations: GitHubAnnotation[];
  /** Pre-formatted `::level file=…,line=…,title=…::message` lines, one per annotation, ready to print to stdout verbatim. */
  annotationLines: string[];
  summaryMarkdown: string;
}

export const DEFAULT_MAX_ANNOTATIONS = 20;

/**
 * `high` → `error`, `medium` → `warning`, `low` → `notice`. An
 * `error`-level annotation does **not** fail the job on its own — GitHub
 * Actions annotation level is cosmetic; only the process's own exit code
 * fails a step, and that's governed separately by `--fail-on`
 * (`reportBreachesThreshold`). Conflating the two is how a check meant to
 * be non-blocking by default quietly becomes blocking.
 */
const LEVEL_BY_SEVERITY: Record<Severity, GitHubAnnotation["level"]> = {
  high: "error",
  medium: "warning",
  low: "notice",
};

const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

/**
 * Percent-encodes the characters GitHub's workflow-command parser treats as
 * structural inside a `key=value` pair — `%` first (so encoding itself
 * isn't double-encoded), then the two bytes that would otherwise truncate
 * or corrupt the line: a literal newline splits one workflow command into
 * two, and a literal `:` risks reading as the `::` that ends the property
 * list, cutting the message off mid-title. Used for the message body,
 * which sits after that boundary and so doesn't need the `:`/`,` escaping
 * a property value does.
 */
function escapeData(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/**
 * `escapeData` plus `:` and `,` — the two characters that are structural
 * *within* the property list (`file=…,line=…,title=…`) rather than only at
 * its end. Without this, a title containing `::` could be misread as the
 * end of the property list, truncating everything after it and losing the
 * real message — or worse, letting finding text be read as the start of an
 * unrelated workflow command.
 */
function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

function formatAnnotationLine(annotation: GitHubAnnotation): string {
  const file = escapeProperty(annotation.file);
  const title = escapeProperty(annotation.title);
  const message = escapeData(annotation.message);
  return `::${annotation.level} file=${file},line=${annotation.line},title=${title}::${message}`;
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function bySeverityThenSeq<T extends { severity: Severity; seq: number }>(a: T, b: T): number {
  return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.seq - b.seq;
}

interface SummaryCounts {
  omittedAnnotations: number;
  maxAnnotations: number;
  outsideDiff: number;
  localCommand: string;
}

function buildSummaryMarkdown(report: RetraceReport, counts: SummaryCounts): string {
  const lines: string[] = ["## Retrace findings", ""];

  if (report.findings.length === 0) {
    lines.push(`No findings — ${report.rulesRun.length} rule(s) run.`);
  } else {
    lines.push(`**${report.findings.length} finding(s) across ${report.sessions.length} session(s)**`, "");
    lines.push("| Severity | Rule | File | Finding |", "| --- | --- | --- | --- |");
    for (const finding of [...report.findings].sort(bySeverityThenSeq)) {
      const file = finding.repoPath ?? finding.path ?? "—";
      lines.push(
        `| ${finding.severity} | ${escapeMarkdownCell(finding.ruleId)} | ${escapeMarkdownCell(file)} | ${escapeMarkdownCell(finding.title)} |`,
      );
    }
  }

  if (report.findingsOmitted) {
    lines.push(
      "",
      `_${report.findingsOmitted} additional finding(s) were left out when the report was assembled (capped at that stage, before this summary ever saw them)._`,
    );
  }
  if (counts.outsideDiff > 0) {
    lines.push(
      "",
      `_${counts.outsideDiff} finding(s) fall outside this diff's changed files and were not annotated — see the table above._`,
    );
  }
  if (counts.omittedAnnotations > 0) {
    lines.push(
      "",
      `_${counts.omittedAnnotations} annotation(s) omitted — capped at ${counts.maxAnnotations}. See the table above for the full list._`,
    );
  }

  if (report.rulesSkipped.length > 0) {
    lines.push("", "**Rules skipped** (did not run — not the same as passing):");
    for (const skipped of report.rulesSkipped) lines.push(`- \`${skipped.ruleId}\`: ${skipped.reason}`);
  }

  const sessionFindingCounts = new Map<string, number>();
  for (const finding of report.findings) {
    sessionFindingCounts.set(finding.sessionId, (sessionFindingCounts.get(finding.sessionId) ?? 0) + 1);
  }
  if (sessionFindingCounts.size > 0) {
    lines.push("", "---", `Inspect in context with \`${counts.localCommand}\`:`);
    for (const [sessionId, count] of sessionFindingCounts) {
      lines.push(`- \`${sessionId}\` — ${count} finding(s)`);
    }
  }

  return lines.join("\n");
}

/**
 * Format a `RetraceReport` for a GitHub Actions job: bounded, ordered
 * annotations plus a markdown summary. Never touches a file, a git repo, or
 * stdout — the caller decides where each string goes (annotations to
 * stdout; the summary to `$GITHUB_STEP_SUMMARY` or stdout as a fallback).
 */
export function formatGithub(report: RetraceReport, options: FormatGithubOptions = {}): FormatGithubResult {
  const maxAnnotations = options.maxAnnotations ?? DEFAULT_MAX_ANNOTATIONS;
  const localCommand = options.localCommand ?? "retrace ui";
  const changedFiles = options.changedFiles ? new Set(options.changedFiles) : undefined;

  const withPath = report.findings.filter(
    (finding): finding is RetraceReport["findings"][number] & { repoPath: string } =>
      finding.repoPath !== undefined,
  );
  const inDiff = changedFiles ? withPath.filter((finding) => changedFiles.has(finding.repoPath)) : withPath;
  const outsideDiff = withPath.length - inDiff.length;

  const ordered = [...inDiff].sort(bySeverityThenSeq);
  const kept = ordered.slice(0, maxAnnotations);
  const omittedAnnotations = ordered.length - kept.length;

  const annotations: GitHubAnnotation[] = kept.map((finding) => ({
    level: LEVEL_BY_SEVERITY[finding.severity],
    file: finding.repoPath,
    line: 1,
    title: finding.title,
    message: finding.detail ?? finding.title,
  }));

  return {
    annotations,
    annotationLines: annotations.map(formatAnnotationLine),
    summaryMarkdown: buildSummaryMarkdown(report, {
      omittedAnnotations,
      maxAnnotations,
      outsideDiff,
      localCommand,
    }),
  };
}
