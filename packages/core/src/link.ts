import type { SessionRow } from "./schema.js";

/**
 * Pure session↔commit matching. Zero Node dependencies — the same constraint
 * check/ and replay.ts live under — so this is safe to re-export from
 * `browser.ts`. Linkage is inferred, not declared: Retrace never asks the
 * agent to cooperate and never writes to a commit, a commit message, or a
 * git ref. See module-04-commit-linkage-store.md for the design.
 */

/** A candidate commit to match against a session — resolved by the CLI's git plumbing (git.ts), never Retrace-authored. */
export interface CommitCandidate {
  sha: string;
  repoRoot: string;
  /** ISO-8601 author timestamp. */
  authoredAt: string;
  /** Repo-relative, forward-slash paths touched by the commit — as `git log --name-only` reports them. */
  paths: string[];
}

export type LinkConfidence = "exact" | "inferred";

export interface SessionCommitLink {
  sessionId: string;
  commitSha: string;
  repoRoot: string | null;
  confidence: LinkConfidence;
  linkedAt: string;
}

export interface LinkOptions {
  /** How long after a session's end a commit still counts as its work. Default 30 min. */
  graceMs?: number;
}

const DEFAULT_GRACE_MS = 30 * 60 * 1000;

function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Whether `child` is `parent` itself or falls inside it. Both sides are
 * normalized (backslashes, trailing slash, case) before comparing — Windows
 * paths are case-insensitive, and this project develops on Windows, so a
 * verbatim comparison of a session's recorded `cwd` against a git-reported
 * repo root produces false negatives (see toolInput.ts's `normalizePath` for
 * the same reasoning, applied there to a single path rather than a
 * parent/child pair).
 */
export function isPathInside(parent: string, child: string): boolean {
  const normParent = toPosix(parent).toLowerCase().replace(/\/+$/, "");
  const normChild = toPosix(child).toLowerCase().replace(/\/+$/, "");
  return normChild === normParent || normChild.startsWith(`${normParent}/`);
}

/**
 * Normalize a session-recorded absolute path (Windows or POSIX-shaped, as
 * `file_change` events store it) into a repo-relative POSIX path — the shape
 * a commit's diff paths come in. Returns `undefined` when `absolutePath`
 * does not fall under `repoRoot` at all. This is deliberately its own
 * exported, separately tested function: normalizing between an
 * agent-recorded absolute path and a git-relative one is where path-matching
 * bugs live, not in the matching logic itself.
 */
export function toRepoRelativePath(absolutePath: string, repoRoot: string): string | undefined {
  const path = toPosix(absolutePath).toLowerCase();
  const root = toPosix(repoRoot).toLowerCase().replace(/\/+$/, "");
  if (path === root) return "";
  if (!path.startsWith(`${root}/`)) return undefined;
  return path.slice(root.length + 1);
}

function samePosixPath(a: string, b: string): boolean {
  return toPosix(a).toLowerCase() === toPosix(b).toLowerCase();
}

/**
 * Link a session to the commits it plausibly produced. A session and a
 * commit are linked when all of: the commit's repo root contains the
 * session's `cwd`; the commit's author timestamp falls within
 * `[session.startedAt, session.endedAt + graceMs]`; and at least one of the
 * commit's changed paths matches one of `sessionPaths` once both are
 * normalized to the same repo-relative POSIX form.
 *
 * Confidence is `exact` when the overlap is non-trivial — more than one
 * matching file, or every one of the commit's paths is covered by the
 * session — and `inferred` otherwise (exactly one matching file out of
 * several the commit touched). Callers decide what to do with a weak link;
 * this function does not silently drop one.
 *
 * Linkage is prospective only: a commit authored before `session.startedAt`
 * is never linked, even if its paths overlap — Retrace only ever sees
 * sessions it recorded, and a link with no session behind it is worse than
 * no link.
 */
export function matchCommitsToSession(
  session: SessionRow,
  sessionPaths: string[],
  candidates: CommitCandidate[],
  options: LinkOptions = {},
): SessionCommitLink[] {
  if (!session.cwd || !session.startedAt || !session.endedAt) return [];

  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const startMs = Date.parse(session.startedAt);
  const endMs = Date.parse(session.endedAt);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return [];

  const links: SessionCommitLink[] = [];

  for (const candidate of candidates) {
    if (!isPathInside(candidate.repoRoot, session.cwd)) continue;

    const authoredMs = Date.parse(candidate.authoredAt);
    if (Number.isNaN(authoredMs)) continue;
    if (authoredMs < startMs || authoredMs > endMs + graceMs) continue;

    const sessionRelPaths = sessionPaths
      .map((p) => toRepoRelativePath(p, candidate.repoRoot))
      .filter((p): p is string => p !== undefined);
    if (sessionRelPaths.length === 0) continue;

    const matching = candidate.paths.filter((commitPath) =>
      sessionRelPaths.some((sessionPath) => samePosixPath(commitPath, sessionPath)),
    );
    if (matching.length === 0) continue;

    const confidence: LinkConfidence =
      matching.length > 1 || matching.length === candidate.paths.length ? "exact" : "inferred";

    links.push({
      sessionId: session.id,
      commitSha: candidate.sha,
      repoRoot: candidate.repoRoot,
      confidence,
      linkedAt: new Date().toISOString(),
    });
  }

  return links;
}
