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

/** `input`, when given, is piped to the subprocess's stdin (how `writeNote` gets a large body past argv limits). */
function runGit(args: string[], cwd: string, input?: string): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", input });
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

/** Resolve any ref (`HEAD`, a branch, a tag, a short sha) to its full commit sha. */
export function resolveSha(repoRootPath: string, ref: string): string {
  return runGit(["rev-parse", ref], repoRootPath).trim();
}

/**
 * The repo's default branch, short form (e.g. `main`), or `undefined` when
 * it can't be determined — no `origin` remote, or the local clone never
 * fetched `origin/HEAD` (a shallow or manually-configured checkout).
 * `retrace report` falls back to `HEAD~1` as its base when this is absent.
 */
export function defaultBranch(repoRootPath: string): string | undefined {
  try {
    const ref = execFileSync(
      "git",
      ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      { cwd: repoRootPath, encoding: "utf8" },
    ).trim();
    // Strip the "origin/" prefix `symbolic-ref` includes, since callers
    // resolve branch names against the local repo (merge-base, rev-parse),
    // not remote-tracking refs specifically.
    return ref.replace(/^origin\//, "");
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "ENOENT") {
      throw new Error("git is not installed or not on PATH", { cause: err });
    }
    return undefined;
  }
}

/** The best common ancestor of `a` and `b`, or `undefined` when git can't find one (unrelated histories, or either ref doesn't resolve). */
export function mergeBase(repoRootPath: string, a: string, b: string): string | undefined {
  try {
    return execFileSync("git", ["merge-base", a, b], { cwd: repoRootPath, encoding: "utf8" }).trim();
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "ENOENT") {
      throw new Error("git is not installed or not on PATH", { cause: err });
    }
    return undefined;
  }
}

/** The default ref reports are written under — short form, as `git notes --ref` expects. */
export const REPORT_NOTES_REF = "retrace";

/**
 * The stored report body for `sha` under `ref`, or `undefined` when no note
 * exists there — the common case (most commits have never been reported on),
 * so this does not throw for it.
 *
 * Strips exactly one trailing newline if present: `git notes add` runs its
 * content through the same cleanup as a commit message and always ends the
 * stored blob with one, even when the body written via {@link writeNote} had
 * none — that trailing byte is git's normalization, not part of what was
 * written, so leaving it in would break an exact round-trip.
 */
export function readNote(repoRootPath: string, ref: string, sha: string): string | undefined {
  try {
    const raw = execFileSync("git", ["notes", `--ref=${ref}`, "show", sha], {
      cwd: repoRootPath,
      encoding: "utf8",
    });
    return raw.endsWith("\n") ? raw.slice(0, -1) : raw;
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "ENOENT") {
      throw new Error("git is not installed or not on PATH", { cause: err });
    }
    // `git notes show` exits non-zero when `sha` has no note under `ref`.
    return undefined;
  }
}

/**
 * Write (or overwrite) the note for `sha` under `ref`. The body is piped via
 * stdin (`-F -`) rather than passed as an argument, so a large report JSON
 * never hits an argv length limit; `-f` overwrites any note already there —
 * `retrace report` is meant to be re-run (a fixed check-engine bug, a
 * rebase that produced the same head sha another way).
 */
export function writeNote(repoRootPath: string, ref: string, sha: string, body: string): void {
  runGit(["notes", `--ref=${ref}`, "add", "-f", "-F", "-", sha], repoRootPath, body);
}

/** Push the notes ref to `remote`, so CI (which never sees the developer's local refs) can fetch it. */
export function pushNotes(repoRootPath: string, remote: string, ref: string): void {
  runGit(["push", remote, `refs/notes/${ref}:refs/notes/${ref}`], repoRootPath);
}

/** Fetch the notes ref from `remote` — what CI runs before `retrace report --read`. */
export function fetchNotes(repoRootPath: string, remote: string, ref: string): void {
  runGit(["fetch", remote, `refs/notes/${ref}:refs/notes/${ref}`], repoRootPath);
}
