import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RetraceStore } from "retrace-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteSessions } from "./delete.js";

let home: string;
let store: RetraceStore;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "retrace-delete-"));
  store = new RetraceStore(home);
});

afterEach(async () => {
  store.close();
  await rm(home, { recursive: true, force: true });
});

function prompt(sessionId: string, text: string) {
  return {
    ts: "2026-07-15T14:37:00.000Z",
    sessionId,
    kind: "user_prompt" as const,
    payload: { text },
  };
}

describe("deleteSessions", () => {
  it("deletes every session in the list", () => {
    store.appendEvent(prompt("s1", "one"));
    store.appendEvent(prompt("s2", "two"));

    const result = deleteSessions(store, ["s1", "s2"]);

    expect(result.deleted).toEqual(["s1", "s2"]);
    expect(result.failed).toEqual([]);
    expect(store.getSession("s1")).toBeUndefined();
    expect(store.getSession("s2")).toBeUndefined();
  });

  it("resolves a unique id prefix", () => {
    store.appendEvent(prompt("sess-unique-full-id", "hi"));

    const result = deleteSessions(store, ["sess-unique"]);
    expect(result.deleted).toEqual(["sess-unique-full-id"]);
  });

  it("records an unresolvable id as failed and keeps processing the rest of the batch", () => {
    store.appendEvent(prompt("s1", "one"));
    store.appendEvent(prompt("s2", "two"));

    const result = deleteSessions(store, ["s1", "does-not-exist", "s2"]);

    expect(result.deleted).toEqual(["s1", "s2"]);
    expect(result.failed).toEqual([
      { input: "does-not-exist", error: expect.stringContaining("no session matches") },
    ]);
  });

  it("leaves everything else untouched when a session id is ambiguous", () => {
    store.appendEvent(prompt("abc-1", "one"));
    store.appendEvent(prompt("abc-2", "two"));

    const result = deleteSessions(store, ["abc-"]);

    expect(result.deleted).toEqual([]);
    expect(result.failed).toEqual([
      { input: "abc-", error: expect.stringContaining("matches 2 sessions") },
    ]);
    expect(store.getSession("abc-1")).toBeDefined();
    expect(store.getSession("abc-2")).toBeDefined();
  });
});
