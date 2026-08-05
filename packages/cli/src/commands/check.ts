import type { CheckOptions, CheckReport, EventsTruncation, RetraceStore, Severity } from "retrace-core";
import { runChecks } from "retrace-core";
import { collectAllEvents } from "../events.js";

export interface CheckSessionResult {
  sessionId: string;
  report: CheckReport;
  /** Set when events.jsonl couldn't be read past some point — the report only covers events up to there. */
  truncatedAt?: EventsTruncation;
}

/**
 * Run the check engine over one session's event stream.
 *
 * `idOrPrefix` may be a full session id or a unique prefix, same as
 * `export`/`verify`/`reimport`.
 */
export function checkSession(
  store: RetraceStore,
  idOrPrefix: string,
  options?: CheckOptions,
): CheckSessionResult {
  const sessionId = store.resolveSessionId(idOrPrefix);
  const { events, truncatedAt } = collectAllEvents(store, sessionId);
  return { sessionId, report: runChecks(sessionId, events, options), truncatedAt };
}

export interface CheckAllSummary {
  results: CheckSessionResult[];
  /** Sessions with at least one finding at or above the failure threshold. */
  failed: CheckSessionResult[];
}

const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

/**
 * Whether a report has a finding at or above `threshold` — `"never"` never
 * breaches, regardless of what the report contains. "How strict" is a
 * CLI/CI-gate concern, not a fact `runChecks` itself computes, which is why
 * this lives here rather than on `CheckReport`.
 */
export function breachesThreshold(report: CheckReport, threshold: Severity | "never"): boolean {
  if (threshold === "never") return false;
  return report.findings.some((finding) => SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[threshold]);
}

/**
 * Run the check engine over every recorded session. A session lands in
 * `failed` when {@link breachesThreshold} says so for `failOn` (default
 * `"high"` — see the `Severity` doc comment in `retrace-core`'s
 * `check/types.ts` for what that threshold means).
 */
export function checkAll(
  store: RetraceStore,
  options?: CheckOptions,
  failOn: Severity | "never" = "high",
): CheckAllSummary {
  const results = store.listSessions().map((session) => checkSession(store, session.id, options));
  const failed = results.filter((result) => breachesThreshold(result.report, failOn));
  return { results, failed };
}
