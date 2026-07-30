import type { RetraceStore, SessionCommitLink } from "retrace-core";
import { matchCommitsToSession } from "retrace-core";
import { collectAllEvents } from "../events.js";
import { listCommits, repoRoot as gitRepoRoot } from "../git.js";

export interface LinkCommandOptions {
  /** Override the git repository directory instead of using the session's recorded `cwd`. */
  repoDir?: string;
  /** How long after a session ends a commit still counts as its work. Default 30 min (see link.ts's DEFAULT_GRACE_MS). */
  graceMinutes?: number;
}

export interface LinkSessionResult {
  sessionId: string;
  repoRoot: string;
  links: SessionCommitLink[];
}

/**
 * Resolve git commit candidates for a session's repository, match them
 * against the session's recorded `file_change` paths, and persist any links
 * found. Throws when the session has no way to resolve a git repository
 * (no recorded `cwd` and no `--repo` override, or the directory isn't
 * actually a git work tree) — the caller decides whether that's a hard
 * failure (a single `retrace link <id>`) or just a skip (`--all`, where most
 * sessions in a mixed corpus won't be git-tracked at all).
 */
export function linkSession(
  store: RetraceStore,
  idOrPrefix: string,
  options: LinkCommandOptions = {},
): LinkSessionResult {
  const sessionId = store.resolveSessionId(idOrPrefix);
  const session = store.getSession(sessionId);
  if (!session) throw new Error(`session ${sessionId} not found`);

  const cwd = options.repoDir ?? session.cwd ?? undefined;
  if (!cwd) {
    throw new Error(
      `${sessionId}: no working directory was recorded for this session, and no --repo override was given`,
    );
  }

  const root = gitRepoRoot(cwd);
  if (!root) {
    throw new Error(`${sessionId}: ${cwd} is not inside a git repository`);
  }

  const events = collectAllEvents(store, sessionId);
  const sessionPaths = events
    .filter((e): e is Extract<(typeof events)[number], { kind: "file_change" }> => e.kind === "file_change")
    .map((e) => e.payload.path);

  const candidates = listCommits(root, { since: session.startedAt ?? undefined });
  const links = matchCommitsToSession(
    session,
    sessionPaths,
    candidates,
    options.graceMinutes !== undefined ? { graceMs: options.graceMinutes * 60_000 } : {},
  );

  for (const link of links) store.linkCommit(link);

  return { sessionId, repoRoot: root, links };
}

export interface LinkAllSummary {
  results: LinkSessionResult[];
  /** Sessions a link couldn't be attempted for (no cwd, not a git repo, ...) — not linked, not an error. */
  skipped: { sessionId: string; reason: string }[];
}

/** Link every recorded session. A session that can't resolve a git repository is skipped, not failed — most corpora mix git-tracked and untracked work. */
export function linkAll(store: RetraceStore, options: LinkCommandOptions = {}): LinkAllSummary {
  const ids = store.listSessions().map((s) => s.id);
  const results: LinkSessionResult[] = [];
  const skipped: { sessionId: string; reason: string }[] = [];

  for (const id of ids) {
    try {
      results.push(linkSession(store, id, options));
    } catch (err) {
      skipped.push({ sessionId: id, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  return { results, skipped };
}
