import type { CheckOptions, RetraceReport, RetraceStore, Severity } from "retrace-core";
import { buildReport, CORE_VERSION, type SessionReportInput } from "retrace-core";
import {
  changedFiles as gitChangedFiles,
  commitsInRange,
  defaultBranch,
  mergeBase,
  pushNotes,
  readNote,
  repoRoot as gitRepoRoot,
  resolveSha,
  writeNote,
  REPORT_NOTES_REF,
} from "../git.js";
import { checkSession } from "./check.js";

export interface GenerateReportOptions {
  base?: string;
  head?: string;
  checkOptions?: CheckOptions;
  maxFindings?: number;
}

export interface GenerateReportResult {
  report: RetraceReport;
  repoRoot: string;
  headSha: string;
  baseRef: string;
}

/**
 * The base ref a report defaults to when `--base` isn't given: the
 * merge-base with the repo's default branch, or `${head}~1` when that can't
 * be determined (no `origin` remote, or no common ancestor — e.g. an
 * unrelated-history repo).
 */
function resolveDefaultBase(repoRoot: string, head: string): string {
  const trunk = defaultBranch(repoRoot);
  if (trunk) {
    const base = mergeBase(repoRoot, trunk, head);
    if (base) return base;
  }
  return `${head}~1`;
}

/**
 * Assemble a `RetraceReport` for a commit range: resolve the range, find
 * every commit in it, look up the sessions linked to those commits (module
 * 04), run the check engine over each (reusing `checkSession` rather than
 * reimplementing it), and hand it all to `buildReport`. Throws when `cwd`
 * isn't inside a git repository.
 */
export function generateReport(
  store: RetraceStore,
  cwd: string,
  options: GenerateReportOptions = {},
): GenerateReportResult {
  const root = gitRepoRoot(cwd);
  if (!root) {
    throw new Error(`${cwd} is not inside a git repository`);
  }

  const head = options.head ?? "HEAD";
  const headSha = resolveSha(root, head);
  const baseRef = options.base ?? resolveDefaultBase(root, headSha);

  const commits = commitsInRange(root, baseRef, headSha);
  const commitShasInRange = commits.map((c) => c.sha);

  const sessionIds = new Set<string>();
  for (const sha of commitShasInRange) {
    for (const link of store.sessionsForCommit(sha)) sessionIds.add(link.sessionId);
  }

  const sessionInputs: SessionReportInput[] = [];
  for (const sessionId of sessionIds) {
    const session = store.getSession(sessionId);
    if (!session) continue; // a link outlived its session row — shouldn't happen, skip defensively
    const { report } = checkSession(store, sessionId, options.checkOptions);
    sessionInputs.push({ session, report, links: store.commitsForSession(sessionId) });
  }

  const report = buildReport(sessionInputs, {
    range: { base: baseRef, head: headSha },
    commitShasInRange,
    repoRoot: root,
    toolVersion: CORE_VERSION,
    maxFindings: options.maxFindings,
  });

  return { report, repoRoot: root, headSha, baseRef };
}

/** Write (or overwrite) the report note for `sha`. `ref` defaults to {@link REPORT_NOTES_REF}; overridable so a repo that already uses `refs/notes/<name>` for something else can pick a different one — module 07's Action input is `notes-ref`. */
export function writeReportNote(repoRoot: string, sha: string, report: RetraceReport, ref: string = REPORT_NOTES_REF): void {
  writeNote(repoRoot, ref, sha, JSON.stringify(report));
}

/** Read back the report note for `sha`, or `undefined` when none exists — the common case, not every commit is reported on. */
export function readReportNote(repoRoot: string, sha: string, ref: string = REPORT_NOTES_REF): RetraceReport | undefined {
  const body = readNote(repoRoot, ref, sha);
  return body === undefined ? undefined : (JSON.parse(body) as RetraceReport);
}

/** Push the report notes ref to `remote`, so CI (which never sees the developer's local refs) can fetch it. */
export function publishReportNote(repoRoot: string, remote: string, ref: string = REPORT_NOTES_REF): void {
  pushNotes(repoRoot, remote, ref);
}

/**
 * The git repo root containing `cwd`, or a thrown error with a clear
 * message. Exists for `retrace report --read`, which (unlike the rest of
 * this module) never opens a store — CI has none — so it has no session cwd
 * to fall back on and must resolve a repo root from the process's own cwd.
 */
export function resolveRepoRoot(cwd: string): string {
  const root = gitRepoRoot(cwd);
  if (!root) {
    throw new Error(`${cwd} is not inside a git repository`);
  }
  return root;
}

/**
 * Repo-relative paths changed in `range` — what `--format github` filters
 * annotations against (module 06). Best-effort: a shallow CI checkout may
 * not have `base` locally, so a failure here is not fatal to the report
 * command as a whole — the caller falls back to annotating every finding
 * that has a `repoPath`, unfiltered, rather than failing the whole command
 * over a display-filtering nicety.
 */
export function changedFilesInRange(repoRoot: string, range: RetraceReport["range"]): string[] | undefined {
  try {
    return gitChangedFiles(repoRoot, range.base ?? `${range.head}~1`, range.head);
  } catch {
    return undefined;
  }
}

const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

/** Same contract as `check.ts`'s `breachesThreshold`, applied to a report's flat finding list instead of one session's. */
export function reportBreachesThreshold(report: RetraceReport, threshold: Severity | "never"): boolean {
  if (threshold === "never") return false;
  return report.findings.some((finding) => SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[threshold]);
}
