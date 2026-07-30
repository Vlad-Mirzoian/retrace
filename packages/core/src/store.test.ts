import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyChain } from "./chain.js";
import type { RetraceEventDraft } from "./schema.js";
import { RetraceStore, retraceHome } from "./store.js";

let home: string;
let store: RetraceStore;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "retrace-store-"));
  store = new RetraceStore(home);
});

afterEach(async () => {
  store.close();
  await rm(home, { recursive: true, force: true });
});

function prompt(sessionId: string, text: string): RetraceEventDraft {
  return {
    ts: "2026-07-15T14:37:00.000Z",
    sessionId,
    kind: "user_prompt",
    payload: { text },
  };
}

describe("retraceHome", () => {
  it("honors RETRACE_HOME when set", () => {
    const prev = process.env.RETRACE_HOME;
    process.env.RETRACE_HOME = "/custom/path";
    expect(retraceHome()).toBe("/custom/path");
    if (prev === undefined) delete process.env.RETRACE_HOME;
    else process.env.RETRACE_HOME = prev;
  });
});

describe("RetraceStore.appendEvent", () => {
  it("seals events into a valid, growing chain", () => {
    const e0 = store.appendEvent(prompt("s1", "first"));
    const e1 = store.appendEvent(prompt("s1", "second"));
    expect(e0.seq).toBe(0);
    expect(e0.prevHash).toBeNull();
    expect(e1.seq).toBe(1);
    expect(e1.prevHash).toBe(e0.hash);
  });

  it("keeps independent chains per session", () => {
    const a = store.appendEvent(prompt("s1", "a"));
    const b = store.appendEvent(prompt("s2", "b"));
    expect(a.seq).toBe(0);
    expect(b.seq).toBe(0);
    expect(a.prevHash).toBeNull();
    expect(b.prevHash).toBeNull();
  });

  it("auto-creates the session row on first event", () => {
    store.appendEvent(prompt("s1", "hello"));
    const session = store.getSession("s1");
    expect(session).toBeDefined();
    expect(session?.eventCount).toBe(1);
  });

  it("resumes chain state after the store is reopened", () => {
    store.appendEvent(prompt("s1", "one"));
    store.appendEvent(prompt("s1", "two"));
    store.close();

    // Reassign so afterEach closes the live instance, not the one above.
    store = new RetraceStore(home);
    const third = store.appendEvent(prompt("s1", "three"));
    expect(third.seq).toBe(2);

    const all = store.readEvents("s1", 0, 10);
    expect(all).toHaveLength(3);
    expect(verifyChain(all)).toEqual({ ok: true });
  });
});

describe("RetraceStore.ensureSession", () => {
  it("does not clobber existing fields with omitted ones", () => {
    store.ensureSession({ id: "s1", project: "retrace", cwd: "/repo" });
    store.ensureSession({ id: "s1", title: "Fix the bug" });

    const session = store.getSession("s1");
    expect(session?.project).toBe("retrace");
    expect(session?.cwd).toBe("/repo");
    expect(session?.title).toBe("Fix the bug");
  });
});

describe("RetraceStore.listSessions / getSession", () => {
  it("lists all known sessions", () => {
    store.appendEvent(prompt("s1", "a"));
    store.appendEvent(prompt("s2", "b"));
    const sessions = store.listSessions();
    expect(sessions.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
  });

  it("returns undefined for an unknown session", () => {
    expect(store.getSession("nope")).toBeUndefined();
  });

  it("counts only tool calls in toolCallCount, separately from eventCount", () => {
    store.appendEvent(prompt("s1", "do the thing"));
    for (const toolUseId of ["t1", "t2"]) {
      store.appendEvent({
        ts: "2026-07-15T14:37:00.000Z",
        sessionId: "s1",
        kind: "tool_call",
        payload: { toolName: "Bash", toolUseId, input: {} },
      });
      store.appendEvent({
        ts: "2026-07-15T14:37:01.000Z",
        sessionId: "s1",
        kind: "tool_result",
        payload: { toolUseId, output: "ok" },
      });
    }

    const session = store.getSession("s1");
    expect(session?.eventCount).toBe(5);
    expect(session?.toolCallCount).toBe(2);
    expect(store.listSessions()[0].toolCallCount).toBe(2);
  });

  it("reports zero tool calls for a session that made none", () => {
    store.appendEvent(prompt("s1", "just chatting"));
    expect(store.getSession("s1")?.toolCallCount).toBe(0);
  });

  it("does not count another session's tool calls", () => {
    store.appendEvent({
      ts: "2026-07-15T14:37:00.000Z",
      sessionId: "s1",
      kind: "tool_call",
      payload: { toolName: "Bash", toolUseId: "t1", input: {} },
    });
    store.appendEvent(prompt("s2", "no tools here"));
    expect(store.getSession("s2")?.toolCallCount).toBe(0);
  });
});

describe("RetraceStore.readEvents", () => {
  it("paginates in seq order and round-trips content, including multi-byte text", () => {
    const texts = ["one", "два", "three 🚀", "four", "five"];
    for (const text of texts) store.appendEvent(prompt("s1", text));

    const page1 = store.readEvents("s1", 0, 2);
    const page2 = store.readEvents("s1", 2, 2);
    const page3 = store.readEvents("s1", 4, 2);

    const all = [...page1, ...page2, ...page3];
    expect(all.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(
      all.map((e) => (e.kind === "user_prompt" ? e.payload.text : "")),
    ).toEqual(texts);
  });

  it("returns an empty array past the end", () => {
    store.appendEvent(prompt("s1", "only one"));
    expect(store.readEvents("s1", 5, 10)).toEqual([]);
  });

  it("returns an empty array for a session with no events", () => {
    expect(store.readEvents("ghost", 0, 10)).toEqual([]);
  });
});

describe("RetraceStore.resolveSessionId", () => {
  it("returns an exact id unchanged", () => {
    store.appendEvent(prompt("session-abc", "hi"));
    expect(store.resolveSessionId("session-abc")).toBe("session-abc");
  });

  it("resolves a unique prefix to its full id", () => {
    store.appendEvent(prompt("25dffb61-c390-43db-91f6-4d19b02e4d5c", "hi"));
    expect(store.resolveSessionId("25dffb61-c")).toBe("25dffb61-c390-43db-91f6-4d19b02e4d5c");
  });

  it("throws on a prefix matching no session", () => {
    expect(() => store.resolveSessionId("nope")).toThrow(/no session matches/);
  });

  it("throws on a prefix matching more than one session", () => {
    store.appendEvent(prompt("abc-111", "a"));
    store.appendEvent(prompt("abc-222", "b"));
    expect(() => store.resolveSessionId("abc-")).toThrow(/matches 2 sessions/);
  });

  it("treats % and _ in the prefix as literal characters, not SQL wildcards", () => {
    store.appendEvent(prompt("weird_id", "a"));
    store.appendEvent(prompt("weirdXid", "b"));
    expect(store.resolveSessionId("weird_")).toBe("weird_id");
  });
});

describe("RetraceStore.getImportPathsForSession", () => {
  it("returns tied paths without deleting anything", () => {
    store.appendEvent(prompt("s1", "one"));
    store.setImportState("/transcripts/s1.jsonl", {
      sessionId: "s1",
      size: 10,
      mtimeMs: 1,
      lastLine: 1,
    });

    expect(store.getImportPathsForSession("s1")).toEqual(["/transcripts/s1.jsonl"]);
    // Purely a lookup — the session and its import state are untouched.
    expect(store.getSession("s1")).toBeDefined();
    expect(store.getImportState("/transcripts/s1.jsonl")).toBeDefined();
  });

  it("returns an empty array for a session with no known source", () => {
    store.appendEvent(prompt("hook-only", "hi"));
    expect(store.getImportPathsForSession("hook-only")).toEqual([]);
  });
});

describe("RetraceStore.deleteSession", () => {
  it("removes the session row, its events, and its on-disk directory", () => {
    store.appendEvent(prompt("s1", "one"));
    store.appendEvent(prompt("s1", "two"));
    const sessionDir = join(store.homeDir, "sessions", "s1");
    expect(existsSync(sessionDir)).toBe(true);

    const result = store.deleteSession("s1");
    expect(result.importPaths).toEqual([]);
    expect(store.getSession("s1")).toBeUndefined();
    expect(store.readEvents("s1")).toEqual([]);
    expect(existsSync(sessionDir)).toBe(false);
  });

  it("returns the import_state paths tied to the session, and clears that state", () => {
    store.appendEvent(prompt("s1", "one"));
    store.setImportState("/transcripts/s1.jsonl", {
      sessionId: "s1",
      size: 10,
      mtimeMs: 1,
      lastLine: 1,
    });

    const result = store.deleteSession("s1");
    expect(result.importPaths).toEqual(["/transcripts/s1.jsonl"]);
    expect(store.getImportState("/transcripts/s1.jsonl")).toBeUndefined();
  });

  it("lets a new chain start at seq 0 for a re-created session with the same id", () => {
    store.appendEvent(prompt("s1", "one"));
    store.appendEvent(prompt("s1", "two"));
    store.deleteSession("s1");

    const fresh = store.appendEvent(prompt("s1", "reborn"));
    expect(fresh.seq).toBe(0);
    expect(fresh.prevHash).toBeNull();
  });

  it("is safe to call on a session with no on-disk events directory", () => {
    expect(() => store.deleteSession("never-existed")).not.toThrow();
  });

  it("removes any commit links recorded for the session", () => {
    store.appendEvent(prompt("s1", "one"));
    store.linkCommit({
      sessionId: "s1",
      commitSha: "abc123",
      repoRoot: "/repo",
      confidence: "exact",
      linkedAt: "2026-07-15T14:30:00.000Z",
    });

    store.deleteSession("s1");
    expect(store.commitsForSession("s1")).toEqual([]);
  });
});

describe("RetraceStore commit linkage", () => {
  it("round-trips linkCommit through commitsForSession and sessionsForCommit", () => {
    store.appendEvent(prompt("s1", "one"));
    store.linkCommit({
      sessionId: "s1",
      commitSha: "abc123",
      repoRoot: "/repo",
      confidence: "exact",
      linkedAt: "2026-07-15T14:30:00.000Z",
    });

    expect(store.commitsForSession("s1")).toEqual([
      { sessionId: "s1", commitSha: "abc123", repoRoot: "/repo", confidence: "exact", linkedAt: "2026-07-15T14:30:00.000Z" },
    ]);
    expect(store.sessionsForCommit("abc123")).toEqual([
      { sessionId: "s1", commitSha: "abc123", repoRoot: "/repo", confidence: "exact", linkedAt: "2026-07-15T14:30:00.000Z" },
    ]);
  });

  it("upserts on a repeat link, updating repoRoot/linkedAt", () => {
    store.appendEvent(prompt("s1", "one"));
    store.linkCommit({
      sessionId: "s1",
      commitSha: "abc123",
      repoRoot: "/repo",
      confidence: "inferred",
      linkedAt: "2026-07-15T14:30:00.000Z",
    });
    store.linkCommit({
      sessionId: "s1",
      commitSha: "abc123",
      repoRoot: "/repo-renamed",
      confidence: "inferred",
      linkedAt: "2026-07-15T15:00:00.000Z",
    });

    const links = store.commitsForSession("s1");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ repoRoot: "/repo-renamed", linkedAt: "2026-07-15T15:00:00.000Z" });
  });

  it("never downgrades confidence from exact to inferred on a repeat link", () => {
    store.appendEvent(prompt("s1", "one"));
    store.linkCommit({
      sessionId: "s1",
      commitSha: "abc123",
      repoRoot: "/repo",
      confidence: "exact",
      linkedAt: "2026-07-15T14:30:00.000Z",
    });
    store.linkCommit({
      sessionId: "s1",
      commitSha: "abc123",
      repoRoot: "/repo",
      confidence: "inferred",
      linkedAt: "2026-07-15T15:00:00.000Z",
    });

    expect(store.commitsForSession("s1")[0].confidence).toBe("exact");
  });

  it("unlinkSession removes links without touching the session row", () => {
    store.appendEvent(prompt("s1", "one"));
    store.linkCommit({
      sessionId: "s1",
      commitSha: "abc123",
      repoRoot: "/repo",
      confidence: "exact",
      linkedAt: "2026-07-15T14:30:00.000Z",
    });

    store.unlinkSession("s1");
    expect(store.commitsForSession("s1")).toEqual([]);
    expect(store.getSession("s1")).toBeDefined();
  });

  it("a commit can be linked to more than one session", () => {
    store.appendEvent(prompt("s1", "one"));
    store.appendEvent(prompt("s2", "two"));
    store.linkCommit({ sessionId: "s1", commitSha: "shared", repoRoot: "/repo", confidence: "inferred", linkedAt: "2026-07-15T14:00:00.000Z" });
    store.linkCommit({ sessionId: "s2", commitSha: "shared", repoRoot: "/repo", confidence: "inferred", linkedAt: "2026-07-15T14:05:00.000Z" });

    expect(store.sessionsForCommit("shared").map((l) => l.sessionId)).toEqual(["s1", "s2"]);
  });
});

describe("RetraceStore.reset", () => {
  it("deletes the entire home directory, sessions and all", () => {
    store.appendEvent(prompt("s1", "one"));
    store.appendEvent(prompt("s2", "two"));
    expect(existsSync(home)).toBe(true);

    store.reset();
    expect(existsSync(home)).toBe(false);
  });

  it("closes the db handle, so a fresh store can reopen the same homeDir afterward", () => {
    store.appendEvent(prompt("s1", "one"));
    store.reset();

    const fresh = new RetraceStore(home);
    try {
      expect(fresh.listSessions()).toEqual([]);
    } finally {
      fresh.close();
    }
  });
});

describe("RetraceStore.listImportedSessionIds", () => {
  it("lists only sessions with a known source transcript", () => {
    store.appendEvent(prompt("hook-only", "from a live hook"));
    store.appendEvent(prompt("imported", "from a transcript"));
    store.setImportState("/transcripts/imported.jsonl", {
      sessionId: "imported",
      size: 10,
      mtimeMs: 1,
      lastLine: 1,
    });

    expect(store.listImportedSessionIds()).toEqual(["imported"]);
  });
});

describe("RetraceStore import_state", () => {
  it("round-trips import state per source path", () => {
    expect(store.getImportState("/transcripts/a.jsonl")).toBeUndefined();

    store.setImportState("/transcripts/a.jsonl", {
      sessionId: "s1",
      size: 1234,
      mtimeMs: 999.5,
      lastLine: 42,
    });
    expect(store.getImportState("/transcripts/a.jsonl")).toEqual({
      sessionId: "s1",
      size: 1234,
      mtimeMs: 999.5,
      lastLine: 42,
    });

    store.setImportState("/transcripts/a.jsonl", {
      sessionId: "s1",
      size: 2000,
      mtimeMs: 1000.5,
      lastLine: 50,
    });
    expect(store.getImportState("/transcripts/a.jsonl")?.lastLine).toBe(50);
  });
});
