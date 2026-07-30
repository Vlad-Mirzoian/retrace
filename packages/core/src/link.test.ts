import { describe, expect, it } from "vitest";
import type { SessionRow } from "./schema.js";
import {
  isPathInside,
  matchCommitsToSession,
  toRepoRelativePath,
  type CommitCandidate,
} from "./link.js";

function session(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "sess-1",
    project: null,
    cwd: "D:\\Projects\\Retrace\\retrace",
    gitBranch: null,
    ccVersion: null,
    permissionMode: null,
    title: null,
    startedAt: "2026-07-15T14:00:00.000Z",
    endedAt: "2026-07-15T14:30:00.000Z",
    eventCount: 0,
    toolCallCount: 0,
    ...overrides,
  };
}

function candidate(overrides: Partial<CommitCandidate> = {}): CommitCandidate {
  return {
    sha: "abc123",
    repoRoot: "D:/Projects/Retrace/retrace",
    authoredAt: "2026-07-15T14:15:00.000Z",
    paths: ["packages/core/src/store.ts"],
    ...overrides,
  };
}

describe("toRepoRelativePath", () => {
  it("normalizes a Windows absolute path under the repo root", () => {
    expect(toRepoRelativePath("D:\\Projects\\Retrace\\retrace\\packages\\core\\src\\store.ts", "D:/Projects/Retrace/retrace")).toBe(
      "packages/core/src/store.ts",
    );
  });

  it("normalizes a POSIX absolute path under the repo root", () => {
    expect(toRepoRelativePath("/home/dev/retrace/packages/core/src/store.ts", "/home/dev/retrace")).toBe(
      "packages/core/src/store.ts",
    );
  });

  it("handles mixed separators in the input path", () => {
    expect(toRepoRelativePath("D:/Projects/Retrace/retrace\\packages/core\\src/store.ts", "D:\\Projects\\Retrace\\retrace")).toBe(
      "packages/core/src/store.ts",
    );
  });

  it("is case-insensitive, matching a Windows-recorded session against a POSIX-shaped commit path", () => {
    // The Windows path is upper-cased on the drive letter and a directory
    // segment, as a real Windows path picker might produce.
    expect(toRepoRelativePath("D:\\Projects\\Retrace\\RETRACE\\packages\\Core\\src\\store.ts", "d:/projects/retrace/retrace")).toBe(
      "packages/core/src/store.ts",
    );
  });

  it("returns undefined when the path is not under the repo root", () => {
    expect(toRepoRelativePath("D:\\Elsewhere\\file.ts", "D:/Projects/Retrace/retrace")).toBeUndefined();
  });

  it("returns the empty string for the repo root itself", () => {
    expect(toRepoRelativePath("D:\\Projects\\Retrace\\retrace", "D:/Projects/Retrace/retrace")).toBe("");
  });
});

describe("isPathInside", () => {
  it("is true when child equals parent", () => {
    expect(isPathInside("D:/Projects/Retrace/retrace", "D:\\Projects\\Retrace\\retrace")).toBe(true);
  });

  it("is true when child is nested under parent", () => {
    expect(isPathInside("D:/Projects/Retrace/retrace", "D:\\Projects\\Retrace\\retrace\\packages\\core")).toBe(true);
  });

  it("is false when child is a sibling with a shared prefix", () => {
    expect(isPathInside("D:/Projects/Retrace/retrace", "D:/Projects/Retrace/retrace-other")).toBe(false);
  });

  it("is false when child is unrelated", () => {
    expect(isPathInside("D:/Projects/Retrace/retrace", "D:/Elsewhere")).toBe(false);
  });
});

describe("matchCommitsToSession", () => {
  it("links on exact overlap: more than one matching file", () => {
    const links = matchCommitsToSession(
      session(),
      [
        "D:\\Projects\\Retrace\\retrace\\packages\\core\\src\\store.ts",
        "D:\\Projects\\Retrace\\retrace\\packages\\core\\src\\link.ts",
      ],
      [candidate({ paths: ["packages/core/src/store.ts", "packages/core/src/link.ts"] })],
    );
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ sessionId: "sess-1", commitSha: "abc123", confidence: "exact" });
  });

  it("links on exact overlap: the commit's entire (single-file) path set is covered", () => {
    const links = matchCommitsToSession(
      session(),
      ["D:\\Projects\\Retrace\\retrace\\packages\\core\\src\\store.ts"],
      [candidate({ paths: ["packages/core/src/store.ts"] })],
    );
    expect(links[0].confidence).toBe("exact");
  });

  it("links on partial overlap as inferred: one matching file out of several the commit touched", () => {
    const links = matchCommitsToSession(
      session(),
      ["D:\\Projects\\Retrace\\retrace\\packages\\core\\src\\store.ts"],
      [candidate({ paths: ["packages/core/src/store.ts", "packages/core/src/other.ts"] })],
    );
    expect(links).toHaveLength(1);
    expect(links[0].confidence).toBe("inferred");
  });

  it("does not link when there is no path overlap", () => {
    const links = matchCommitsToSession(
      session(),
      ["D:\\Projects\\Retrace\\retrace\\packages\\core\\src\\unrelated.ts"],
      [candidate({ paths: ["packages/core/src/store.ts"] })],
    );
    expect(links).toEqual([]);
  });

  it("does not link a commit outside the session's time window", () => {
    const links = matchCommitsToSession(
      session(),
      ["D:\\Projects\\Retrace\\retrace\\packages\\core\\src\\store.ts"],
      [candidate({ authoredAt: "2026-07-15T15:30:00.000Z" })], // an hour after ended_at, past the default grace
    );
    expect(links).toEqual([]);
  });

  it("links a commit authored inside the grace window after ended_at", () => {
    const links = matchCommitsToSession(
      session(),
      ["D:\\Projects\\Retrace\\retrace\\packages\\core\\src\\store.ts"],
      [candidate({ authoredAt: "2026-07-15T14:35:00.000Z" })], // 5 minutes after ended_at
      { graceMs: 30 * 60 * 1000 },
    );
    expect(links).toHaveLength(1);
  });

  it("does not link a commit authored before the session started, even with path overlap", () => {
    const links = matchCommitsToSession(
      session(),
      ["D:\\Projects\\Retrace\\retrace\\packages\\core\\src\\store.ts"],
      [candidate({ authoredAt: "2026-07-15T13:00:00.000Z" })],
    );
    expect(links).toEqual([]);
  });

  it("returns no links for a session with no cwd", () => {
    const links = matchCommitsToSession(
      session({ cwd: null }),
      ["D:\\Projects\\Retrace\\retrace\\packages\\core\\src\\store.ts"],
      [candidate()],
    );
    expect(links).toEqual([]);
  });

  it("does not link a commit from a different repository", () => {
    const links = matchCommitsToSession(
      session(),
      ["D:\\Projects\\Retrace\\retrace\\packages\\core\\src\\store.ts"],
      [candidate({ repoRoot: "D:/Elsewhere/other-repo", paths: ["packages/core/src/store.ts"] })],
    );
    expect(links).toEqual([]);
  });
});
