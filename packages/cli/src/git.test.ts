import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  commitsInRange,
  defaultBranch,
  fetchNotes,
  listCommits,
  mergeBase,
  pushNotes,
  readNote,
  repoRoot,
  resolveSha,
  writeNote,
} from "./git.js";

let dir: string;

function git(args: string[], cwd: string = dir): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function commitFile(path: string, content: string, message: string): Promise<string> {
  await writeFile(join(dir, path), content, "utf8");
  git(["add", path]);
  git(["commit", "-m", message]);
  return git(["rev-parse", "HEAD"]);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "retrace-git-test-"));
  git(["init", "-q"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("repoRoot", () => {
  it("resolves the repository root from the root itself", () => {
    expect(repoRoot(dir)).toBeDefined();
  });

  it("resolves the same repository root from a subdirectory as from the root", async () => {
    const sub = join(dir, "a", "b");
    await writeFile(join(dir, "a-marker.txt"), "x", "utf8");
    git(["add", "a-marker.txt"]);
    git(["commit", "-m", "seed"]);
    await import("node:fs/promises").then((fs) => fs.mkdir(sub, { recursive: true }));
    // Compared against repoRoot(dir) itself, not the raw `dir` string — a
    // temp dir can round-trip through git with different casing or an
    // 8.3-style short name on Windows, so self-consistency is what matters.
    expect(repoRoot(sub)).toBe(repoRoot(dir));
  });

  it("returns undefined for a directory that is not a git repository", async () => {
    const outside = await mkdtemp(join(tmpdir(), "retrace-not-a-repo-"));
    try {
      expect(repoRoot(outside)).toBeUndefined();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("listCommits / commitsInRange", () => {
  it("parses a single commit's sha, author date, and changed paths", async () => {
    const sha = await commitFile("a.txt", "hello", "add a.txt");

    const commits = listCommits(dir);
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe(sha);
    expect(commits[0].paths).toEqual(["a.txt"]);
    expect(commits[0].repoRoot).toBe(dir);
    expect(Number.isNaN(Date.parse(commits[0].authoredAt))).toBe(false);
  });

  it("parses multiple commits, each with its own paths", async () => {
    const sha1 = await commitFile("a.txt", "one", "first");
    const sha2 = await commitFile("b.txt", "two", "second");

    const commits = listCommits(dir);
    const shas = commits.map((c) => c.sha);
    expect(shas).toEqual(expect.arrayContaining([sha1, sha2]));
    expect(commits.find((c) => c.sha === sha1)?.paths).toEqual(["a.txt"]);
    expect(commits.find((c) => c.sha === sha2)?.paths).toEqual(["b.txt"]);
  });

  it("parses a commit that touches more than one file", async () => {
    await writeFile(join(dir, "x.txt"), "x", "utf8");
    await writeFile(join(dir, "y.txt"), "y", "utf8");
    git(["add", "x.txt", "y.txt"]);
    git(["commit", "-m", "add two files"]);

    const commits = listCommits(dir);
    expect(commits[0].paths.sort()).toEqual(["x.txt", "y.txt"]);
  });

  it("commitsInRange returns only commits in base..head", async () => {
    const sha1 = await commitFile("a.txt", "one", "first");
    git(["branch", "before"]);
    const sha2 = await commitFile("b.txt", "two", "second");

    const range = commitsInRange(dir, "before", "HEAD");
    expect(range.map((c) => c.sha)).toEqual([sha2]);
    expect(range.map((c) => c.sha)).not.toContain(sha1);
  });

  it("listCommits respects --since", async () => {
    await commitFile("a.txt", "one", "first");
    const future = new Date(Date.now() + 3600_000).toISOString();

    const commits = listCommits(dir, { since: future });
    expect(commits).toEqual([]);
  });
});

describe("resolveSha", () => {
  it("resolves HEAD to the current commit's full sha", async () => {
    const sha = await commitFile("a.txt", "one", "first");
    expect(resolveSha(dir, "HEAD")).toBe(sha);
  });
});

describe("mergeBase", () => {
  it("finds the common ancestor of two diverged branches", async () => {
    const base = await commitFile("a.txt", "one", "first");
    // Don't assume "main" vs "master" — `git init`'s default branch name
    // depends on the local git config, so read whatever it actually is.
    const trunk = git(["symbolic-ref", "--short", "HEAD"]);
    git(["checkout", "-b", "feature"]);
    await commitFile("b.txt", "two", "on feature");
    git(["checkout", trunk, "-q"]);

    expect(mergeBase(dir, trunk, "feature")).toBe(base);
  });

  it("returns undefined when a ref does not resolve", () => {
    expect(mergeBase(dir, "does-not-exist", "HEAD")).toBeUndefined();
  });
});

describe("defaultBranch", () => {
  it("returns undefined when there is no origin remote", async () => {
    await commitFile("a.txt", "one", "first");
    expect(defaultBranch(dir)).toBeUndefined();
  });
});

describe("notes", () => {
  it("readNote returns undefined when no note exists for a sha", async () => {
    const sha = await commitFile("a.txt", "one", "first");
    expect(readNote(dir, "retrace", sha)).toBeUndefined();
  });

  it("writeNote then readNote round-trips the body, including a large one", async () => {
    const sha = await commitFile("a.txt", "one", "first");
    const body = JSON.stringify({ hello: "world", padding: "x".repeat(5000) });

    writeNote(dir, "retrace", sha, body);
    expect(readNote(dir, "retrace", sha)).toBe(body);
  });

  it("writeNote with -f overwrites a previous note for the same sha", async () => {
    const sha = await commitFile("a.txt", "one", "first");
    writeNote(dir, "retrace", sha, "first body");
    writeNote(dir, "retrace", sha, "second body");
    expect(readNote(dir, "retrace", sha)).toBe("second body");
  });

  it("pushNotes then fetchNotes carries a note to another clone of the same repo", async () => {
    // A bare repo as the "remote", and a second clone as the "CI runner" —
    // this is the exact push/fetch round trip retrace report --publish and
    // the Action depend on.
    const remoteDir = await mkdtemp(join(tmpdir(), "retrace-git-remote-"));
    const ciDir = await mkdtemp(join(tmpdir(), "retrace-git-ci-"));
    try {
      execFileSync("git", ["init", "-q", "--bare", remoteDir]);
      git(["remote", "add", "origin", remoteDir]);

      const sha = await commitFile("a.txt", "one", "first");
      git(["push", "-q", "origin", "HEAD:refs/heads/master"]);
      writeNote(dir, "retrace", sha, "pushed body");

      pushNotes(dir, "origin", "retrace");

      execFileSync("git", ["clone", "-q", remoteDir, ciDir]);
      expect(readNote(ciDir, "retrace", sha)).toBeUndefined(); // notes aren't cloned by default

      fetchNotes(ciDir, "origin", "retrace");
      expect(readNote(ciDir, "retrace", sha)).toBe("pushed body");
    } finally {
      await rm(remoteDir, { recursive: true, force: true });
      await rm(ciDir, { recursive: true, force: true });
    }
  });
});
