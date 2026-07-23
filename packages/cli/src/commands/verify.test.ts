import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RetraceStore } from "retrace-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyAll, verifySession } from "./verify.js";

let home: string;
let store: RetraceStore;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "retrace-verify-home-"));
  store = new RetraceStore(home);
});

afterEach(async () => {
  store.close();
  await rm(home, { recursive: true, force: true });
});

function seed(sessionId: string, text: string) {
  store.appendEvent({
    ts: "2026-07-15T14:37:00.000Z",
    sessionId,
    kind: "user_prompt",
    payload: { text },
  });
  store.ensureSession({ id: sessionId });
}

/**
 * Corrupt a stored event's on-disk bytes in place (equal-length replacement,
 * so every other event's SQLite-indexed byte offset stays valid) — simulating
 * a tamper attempt against `events.jsonl`, the sealed source of truth.
 */
async function tamperEventText(sessionId: string, find: string, replace: string) {
  if (find.length !== replace.length) {
    throw new Error("test helper requires an equal-length replacement");
  }
  const path = join(home, "sessions", sessionId, "events.jsonl");
  const content = await readFile(path, "utf8");
  expect(content).toContain(find);
  await writeFile(path, content.replace(find, replace), "utf8");
}

describe("verifySession", () => {
  it("reports an untouched session as verified", () => {
    seed("sess-1", "hello");
    const result = verifySession(store, "sess-1");
    expect(result).toEqual({
      sessionId: "sess-1",
      eventCount: 1,
      verification: { ok: true },
    });
  });

  it("resolves a unique id prefix", () => {
    seed("sess-unique-full-id", "hi");
    const result = verifySession(store, "sess-unique");
    expect(result.sessionId).toBe("sess-unique-full-id");
  });

  it("throws for an id that matches no session", () => {
    expect(() => verifySession(store, "does-not-exist")).toThrow(/no session matches/);
  });

  it("detects a tampered event", async () => {
    seed("sess-1", "hello");
    await tamperEventText("sess-1", "hello", "HELLO");

    const result = verifySession(store, "sess-1");
    expect(result.verification.ok).toBe(false);
    if (!result.verification.ok) {
      expect(result.verification.index).toBe(0);
      expect(result.verification.reason).toMatch(/tampered/);
    }
  });
});

describe("verifyAll", () => {
  it("verifies every recorded session, reporting none as failed when all are intact", () => {
    seed("sess-1", "hi");
    seed("sess-2", "there");

    const summary = verifyAll(store);
    expect(summary.results.map((r) => r.sessionId).sort()).toEqual(["sess-1", "sess-2"]);
    expect(summary.failed).toEqual([]);
  });

  it("isolates a tampered session in `failed` without affecting the rest", async () => {
    seed("sess-good", "hi");
    seed("sess-bad", "hello");
    await tamperEventText("sess-bad", "hello", "HELLO");

    const summary = verifyAll(store);
    expect(summary.failed.map((r) => r.sessionId)).toEqual(["sess-bad"]);
    const good = summary.results.find((r) => r.sessionId === "sess-good");
    expect(good?.verification).toEqual({ ok: true });
  });
});
