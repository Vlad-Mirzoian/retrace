import type { CheckFinding, CheckReport } from "./check/types.js";
import { toRepoRelativePath, type LinkConfidence, type SessionCommitLink } from "./link.js";
import type { SessionRow } from "./schema.js";

/**
 * The portable report a `retrace report` run assembles for a commit range —
 * self-contained and versioned, since CI parses it with a different Retrace
 * version than the one that wrote it. Pure, no Node imports, so it's safe to
 * re-export from `browser.ts`. See module-05-report-transport.md for the
 * design: this is what travels over `refs/notes/retrace` (or a plain file)
 * from the developer's machine to CI, since CI has no access to
 * `~/.retrace`. Carries findings and identifiers only — never transcript
 * content (session context on a PR is a documented reviewer-trust problem,
 * see the module's research citation).
 */
export const RETRACE_REPORT_VERSION = 1;

/** A findings cap high enough to never trip in practice, but a report fetched by every CI run should still have a ceiling. */
const DEFAULT_MAX_FINDINGS = 500;

export interface RetraceReport {
  version: number;
  generatedAt: string;
  tool: { name: "retrace"; version: string };
  range: { base?: string; head: string };
  sessions: {
    id: string;
    startedAt: string | null;
    endedAt: string | null;
    commits: string[];
    confidence: LinkConfidence;
  }[];
  findings: (CheckFinding & {
    sessionId: string;
    /** Repo-relative POSIX path, when the finding's `path` could be normalized against `repoRoot`. */
    repoPath?: string;
  })[];
  /** Rules that ran in at least one included session, deduped. */
  rulesRun: string[];
  /** (ruleId, reason) pairs across included sessions, deduped — carried through so CI can tell "clean" from "not checked". */
  rulesSkipped: { ruleId: string; reason: string }[];
  /** Present only when findings were capped at assembly time — how many were left out. */
  findingsOmitted?: number;
}

export interface SessionReportInput {
  session: SessionRow;
  report: CheckReport;
  /** Every commit this session is linked to (not pre-filtered to the range — {@link buildReport} does that). */
  links: SessionCommitLink[];
}

export interface BuildReportOptions {
  range: { base?: string; head: string };
  /** Commit SHAs actually in `range`, resolved by the caller via `commitsInRange` (module 04's git plumbing) — {@link buildReport} itself never touches git. */
  commitShasInRange: string[];
  /** Absolute repo root, for normalizing each finding's absolute `path` into a repo-relative one. */
  repoRoot: string;
  /** `CORE_VERSION` — stamped so a report can be traced back to the Retrace build that produced it. */
  toolVersion: string;
  maxFindings?: number;
}

/**
 * Assemble a `RetraceReport` from sessions, their check reports, and their
 * (unfiltered) commit links. A session contributes to the report only if at
 * least one of its linked commits falls in `commitShasInRange` — a session
 * whose only commits are outside the range is excluded entirely, findings
 * and all. Confidence per session is the strongest among its in-range
 * links (`exact` wins over `inferred`).
 */
export function buildReport(
  sessionInputs: SessionReportInput[],
  options: BuildReportOptions,
): RetraceReport {
  const inRange = new Set(options.commitShasInRange);

  const sessions: RetraceReport["sessions"] = [];
  const findings: RetraceReport["findings"] = [];
  const rulesRun = new Set<string>();
  const rulesSkipped = new Map<string, { ruleId: string; reason: string }>();

  for (const { session, report, links } of sessionInputs) {
    const relevantLinks = links.filter((link) => inRange.has(link.commitSha));
    if (relevantLinks.length === 0) continue;

    sessions.push({
      id: session.id,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      commits: relevantLinks.map((link) => link.commitSha),
      confidence: relevantLinks.some((link) => link.confidence === "exact") ? "exact" : "inferred",
    });

    for (const ruleId of report.rulesRun) rulesRun.add(ruleId);
    for (const skip of report.rulesSkipped) rulesSkipped.set(`${skip.ruleId}\t${skip.reason}`, skip);

    for (const finding of report.findings) {
      const repoPath = finding.path ? toRepoRelativePath(finding.path, options.repoRoot) : undefined;
      findings.push({ ...finding, sessionId: session.id, repoPath });
    }
  }

  const maxFindings = options.maxFindings ?? DEFAULT_MAX_FINDINGS;
  const capped = findings.length > maxFindings;

  return {
    version: RETRACE_REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    tool: { name: "retrace", version: options.toolVersion },
    range: options.range,
    sessions,
    findings: capped ? findings.slice(0, maxFindings) : findings,
    rulesRun: [...rulesRun],
    rulesSkipped: [...rulesSkipped.values()],
    ...(capped ? { findingsOmitted: findings.length - maxFindings } : {}),
  };
}
