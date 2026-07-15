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
