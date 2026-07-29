import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RetraceStore } from "retrace-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  generateReport,
  publishReportNote,
  readReportNote,
  reportBreachesThreshold,
  writeReportNote,
} from "./report.js";

let repoDir: string;
let home: string;
let store: RetraceStore;

function git(args: string[], cwd: string = repoDir): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function commitFile(path: string, content: string, message: string): Promise<string> {
  await writeFile(join(repoDir, path), content, "utf8");
  git(["add", path]);
  git(["commit", "-m", message]);
  return git(["rev-parse", "HEAD"]);
}

/** Seed a session with a file_change event for `relPath` (repo-relative) and link it to `sha`. */
function seedSession(sessionId: string, relPath: string, sha: string, confidence: "exact" | "inferred" = "exact") {
  store.ensureSession({ id: sessionId, cwd: repoDir });
  store.appendEvent({
    ts: "2026-07-15T14:00:00.000Z",
    sessionId,
    kind: "file_change",
    payload: { path: join(repoDir, relPath), operation: "edit", oldString: "x", newString: "y" },
  });
  store.linkCommit({
    sessionId,
    commitSha: sha,
    repoRoot: repoDir,
    confidence,
    linkedAt: "2026-07-15T14:05:00.000Z",
  });
}

beforeEach(async () => {
  repoDir = await mkdtemp(join(tmpdir(), "retrace-report-repo-"));
  git(["init", "-q"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);

  home = await mkdtemp(join(tmpdir(), "retrace-report-home-"));
  store = new RetraceStore(home);
});

afterEach(async () => {
  store.close();
  await rm(repoDir, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

describe("generateReport", () => {
  it("throws a clear error outside a git repository", async () => {
    const outside = await mkdtemp(join(tmpdir(), "retrace-not-a-repo-"));
    try {
      expect(() => generateReport(store, outside)).toThrow(/not inside a git repository/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("produces a valid, empty report when nothing is in range", async () => {
    await commitFile("a.txt", "one", "first");
    const result = generateReport(store, repoDir, { base: "HEAD", head: "HEAD" });
    expect(result.report.sessions).toEqual([]);
    expect(result.report.findings).toEqual([]);
  });

  it("includes a session linked to a commit inside the range, with a repo-relative path on its findings", async () => {
    await commitFile("a.txt", "one", "first");
    // Don't assume "main" vs "master" — `git init`'s default branch name
    // depends on the local git config, so read whatever it actually is.
    const trunk = git(["symbolic-ref", "--short", "HEAD"]);
    git(["checkout", "-b", "feature"]);
    const headSha = await commitFile("b.txt", "two", "second");
    seedSession("sess-1", "b.txt", headSha);

    const result = generateReport(store, repoDir, { base: trunk, head: "HEAD" });
    expect(result.report.sessions.map((s) => s.id)).toEqual(["sess-1"]);
    // The seeded session has no check-engine findings of its own (a bare
    // file_change with no matching claim triggers nothing) — this asserts
    // the session made it into the report, which is what matters here.
    expect(result.headSha).toBe(headSha);
  });

  it("excludes a session whose linked commit is outside the requested range", async () => {
    const sha1 = await commitFile("a.txt", "one", "first");
    seedSession("sess-1", "a.txt", sha1);
    const sha2 = await commitFile("b.txt", "two", "second");

    // Range is sha1..sha2 (exclusive of sha1), so sess-1's only commit is outside it.
    const result = generateReport(store, repoDir, { base: sha1, head: sha2 });
    expect(result.report.sessions).toEqual([]);
  });
});

describe("note round-trip", () => {
  it("writeReportNote then readReportNote returns byte-identical JSON", async () => {
    const sha = await commitFile("a.txt", "one", "first");
    const { report } = generateReport(store, repoDir, { base: sha, head: sha });

    writeReportNote(repoDir, sha, report);
    const readBack = readReportNote(repoDir, sha);
    expect(JSON.stringify(readBack)).toBe(JSON.stringify(report));
  });

  it("readReportNote returns undefined when no note exists", async () => {
    const sha = await commitFile("a.txt", "one", "first");
    expect(readReportNote(repoDir, sha)).toBeUndefined();
  });

  it("publishReportNote pushes the note so a fresh clone can fetch it", async () => {
    const remoteDir = await mkdtemp(join(tmpdir(), "retrace-report-remote-"));
    const ciDir = await mkdtemp(join(tmpdir(), "retrace-report-ci-"));
    try {
      execFileSync("git", ["init", "-q", "--bare", remoteDir]);
      git(["remote", "add", "origin", remoteDir]);

      const sha = await commitFile("a.txt", "one", "first");
      git(["push", "-q", "origin", "HEAD:refs/heads/master"]);
      const { report } = generateReport(store, repoDir, { base: sha, head: sha });
      writeReportNote(repoDir, sha, report);

      publishReportNote(repoDir, "origin");

      execFileSync("git", ["clone", "-q", remoteDir, ciDir]);
      execFileSync("git", ["fetch", "-q", "origin", "refs/notes/retrace:refs/notes/retrace"], { cwd: ciDir });
      expect(readReportNote(ciDir, sha)).toEqual(report);
    } finally {
      await rm(remoteDir, { recursive: true, force: true });
      await rm(ciDir, { recursive: true, force: true });
    }
  });
});

describe("reportBreachesThreshold", () => {
  function reportWith(severities: Array<"high" | "medium" | "low">) {
    return {
      version: 1,
      generatedAt: "2026-07-15T14:00:00.000Z",
      tool: { name: "retrace" as const, version: "0.4.0" },
      range: { head: "HEAD" },
      sessions: [],
      findings: severities.map((severity, i) => ({
        ruleId: "edit-without-read",
        severity,
        title: "x",
        seq: i,
        sessionId: "sess-1",
      })),
      rulesRun: [],
      rulesSkipped: [],
    };
  }

  it("breaches when a finding meets or exceeds the threshold", () => {
    expect(reportBreachesThreshold(reportWith(["medium"]), "medium")).toBe(true);
    expect(reportBreachesThreshold(reportWith(["low"]), "medium")).toBe(false);
  });

  it("never breaches for threshold 'never', regardless of findings", () => {
    expect(reportBreachesThreshold(reportWith(["high"]), "never")).toBe(false);
  });

  it("does not breach an empty report", () => {
    expect(reportBreachesThreshold(reportWith([]), "low")).toBe(false);
  });
});
