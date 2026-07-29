import { execFileSync } from "node:child_process";
import type { CommitCandidate } from "retrace-core";

/**
 * Thin, Node-only wrappers over the `git` binary via `execFileSync` — never
 * a shell string, so nothing here is vulnerable to argument injection. Stays
 * out of `retrace-core` (which must remain Node-free for the browser/export
 * build); the pure matching logic this feeds lives in `link.ts` there.
 */

// `%x00` (a NUL byte) marks the start of each commit's record so a
// multi-commit `--name-only` log can be split unambiguously — commit
// messages and file lists can themselves contain any other character
// git would use as a delimiter. `%x09` is a literal tab, separating the sha
// from the author date on that same marker line. RECORD_SEPARATOR is built
// via fromCharCode so no raw control byte sits in this source file.
const LOG_FORMAT = "%x00%H%x09%aI";
const RECORD_SEPARATOR = String.fromCharCode(0);

function runGit(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8" });
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "ENOENT") {
      throw new Error("git is not installed or not on PATH", { cause: err });
    }
    throw new Error(`git ${args.join(" ")} failed: ${(err as Error).message}`, { cause: err });
  }
}

/** Parse `git log --pretty=format:${LOG_FORMAT} --name-only` output into candidates. */
function parseCommitLog(output: string, repoRoot: string): CommitCandidate[] {
  return output
    .split(RECORD_SEPARATOR)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const lines = chunk.split("\n");
      const [sha, authoredAt] = lines[0].split("\t");
      const paths = lines
        .slice(1)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      return { sha, repoRoot, authoredAt, paths };
    });
}

/**
 * The git repository root containing `cwd`, or `undefined` when `cwd` is not
 * inside a git work tree — a normal, expected outcome (not every session's
 * recorded `cwd` is a git checkout), so callers decide how to react rather
 * than catching an exception for it. Throws only for a genuine operational
 * failure (git itself missing).
 */
export function repoRoot(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim();
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "ENOENT") {
      throw new Error("git is not installed or not on PATH", { cause: err });
    }
    // `git rev-parse` exits non-zero when `cwd` is not inside a work tree.
    return undefined;
  }
}

export interface ListCommitsOptions {
  /** `--since`, any format `git log` accepts (an ISO timestamp works). */
  since?: string;
  /** `--until`, same format rules as `since`. */
  until?: string;
}

/** Commits in `repoRootPath` within `[since, until]`, newest first, as `git log` reports it. */
export function listCommits(repoRootPath: string, options: ListCommitsOptions = {}): CommitCandidate[] {
  const args = ["log", `--pretty=format:${LOG_FORMAT}`, "--name-only"];
  if (options.since) args.push(`--since=${options.since}`);
  if (options.until) args.push(`--until=${options.until}`);
  return parseCommitLog(runGit(args, repoRootPath), repoRootPath);
}

/** Commits in `base..head` — what a PR's diff spans, and what module 05's report is built from. */
export function commitsInRange(repoRootPath: string, base: string, head: string): CommitCandidate[] {
  const args = ["log", `--pretty=format:${LOG_FORMAT}`, "--name-only", `${base}..${head}`];
  return parseCommitLog(runGit(args, repoRootPath), repoRootPath);
}
