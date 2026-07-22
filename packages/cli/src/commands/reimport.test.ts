import { mkdir, mkdtemp, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RetraceStore } from "retrace-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importFile } from "./import.js";
import { reimportAll, reimportSession } from "./reimport.js";

let home: string;
let projectsDir: string;
let store: RetraceStore;

function record(sessionId: string, fields: Record<string, unknown>): string {
  return JSON.stringify({ sessionId, ...fields });
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "retrace-reimport-home-"));
  projectsDir = await mkdtemp(join(tmpdir(), "retrace-reimport-projects-"));
  store = new RetraceStore(home);
});

afterEach(async () => {
  store.close();
  await rm(home, { recursive: true, force: true });
  await rm(projectsDir, { recursive: true, force: true });
});

async function writeTranscript(sessionId: string, lines: string[]): Promise<string> {
  const dir = join(projectsDir, "proj-a");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${sessionId}.jsonl`);
  await writeFile(path, lines.map((l) => `${l}\n`).join(""), "utf8");
  return path;
}

describe("reimportSession", () => {
  it("replaces already-stored bad data with a fresh, correctly-parsed import", async () => {
    const path = await writeTranscript("sess-x", [
      record("sess-x", {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
        timestamp: "2026-07-15T10:00:00.000Z",
      }),
    ]);
    importFile(store, path);

    // Simulate data a since-fixed parser bug once wrote directly to the
    // store, bypassing the current (correct) parser entirely.
    store.appendEvent({
      ts: "2026-07-15T10:00:00.500Z",
      sessionId: "sess-x",
      kind: "thinking",
      payload: { text: "" },
    });
    expect(store.readEvents("sess-x").map((e) => e.kind)).toEqual([
      "assistant_text",
      "thinking",
    ]);

    const result = reimportSession(store, "sess-x");
    expect(result.sessionId).toBe("sess-x");
    expect(result.importPaths).toEqual([path]);
    expect(result.eventsImported).toBe(1);
    expect(store.readEvents("sess-x").map((e) => e.kind)).toEqual(["assistant_text"]);
  });

  it("resolves a unique id prefix", async () => {
    const path = await writeTranscript("sess-unique-full-id", [
      record("sess-unique-full-id", {
        type: "user",
        message: { role: "user", content: "hi" },
        timestamp: "2026-07-15T10:00:00.000Z",
      }),
    ]);
    importFile(store, path);

    const result = reimportSession(store, "sess-unique");
    expect(result.sessionId).toBe("sess-unique-full-id");
  });

  it("deletes a hook-only session (no source transcript) without attempting an import", () => {
    store.appendEvent({
      ts: "2026-07-15T10:00:00.000Z",
      sessionId: "hook-only",
      kind: "user_prompt",
      payload: { text: "hi" },
    });

    const result = reimportSession(store, "hook-only");
    expect(result.importPaths).toEqual([]);
    expect(result.eventsImported).toBe(0);
    expect(store.getSession("hook-only")).toBeUndefined();
  });

  it("throws for an id that matches no session", () => {
    expect(() => reimportSession(store, "does-not-exist")).toThrow(/no session matches/);
  });

  it("picks up newly appended lines from the source transcript, since import_state was reset", async () => {
    const path = await writeTranscript("sess-x", [
      record("sess-x", {
        type: "user",
        message: { role: "user", content: "first" },
        timestamp: "2026-07-15T10:00:00.000Z",
      }),
    ]);
    importFile(store, path);
    await appendFile(
      path,
      `${record("sess-x", {
        type: "user",
        message: { role: "user", content: "second" },
        timestamp: "2026-07-15T10:00:01.000Z",
      })}\n`,
      "utf8",
    );

    const result = reimportSession(store, "sess-x");
    expect(result.eventsImported).toBe(2);
  });

  it("refuses to reimport — and does NOT delete — a session whose source transcript is gone", async () => {
    const path = await writeTranscript("sess-x", [
      record("sess-x", {
        type: "user",
        message: { role: "user", content: "hi" },
        timestamp: "2026-07-15T10:00:00.000Z",
      }),
    ]);
    importFile(store, path);
    expect(store.getSession("sess-x")?.eventCount).toBe(1);

    // The source transcript vanishes — e.g. Claude Code pruned it — after
    // Retrace already has its own copy. This must not cost that copy.
    await rm(path);

    expect(() => reimportSession(store, "sess-x")).toThrow(/no longer on disk/);
    // The session's stored data must survive a refused reimport untouched.
    expect(store.getSession("sess-x")?.eventCount).toBe(1);
    expect(store.readEvents("sess-x")).toHaveLength(1);
  });
});

describe("reimportAll", () => {
  it("re-imports every session with a known source, and reports hook-only sessions as skipped", async () => {
    const path = await writeTranscript("sess-imported", [
      record("sess-imported", {
        type: "user",
        message: { role: "user", content: "hi" },
        timestamp: "2026-07-15T10:00:00.000Z",
      }),
    ]);
    importFile(store, path);
    store.appendEvent({
      ts: "2026-07-15T10:00:00.000Z",
      sessionId: "hook-only",
      kind: "user_prompt",
      payload: { text: "hi" },
    });

    const summary = reimportAll(store);
    expect(summary.results.map((r) => r.sessionId)).toEqual(["sess-imported"]);
    expect(summary.skipped).toEqual(["hook-only"]);
    expect(summary.failed).toEqual([]);
    // The hook-only session was never touched.
    expect(store.getSession("hook-only")).toBeDefined();
    expect(store.getSession("sess-imported")).toBeDefined();
  });

  it("isolates one session's missing-source failure — the rest of the batch still runs, and nothing is lost", async () => {
    const goodPath = await writeTranscript("sess-good", [
      record("sess-good", {
        type: "user",
        message: { role: "user", content: "hi" },
        timestamp: "2026-07-15T10:00:00.000Z",
      }),
    ]);
    const goneePath = await writeTranscript("sess-gone", [
      record("sess-gone", {
        type: "user",
        message: { role: "user", content: "hi" },
        timestamp: "2026-07-15T10:00:00.000Z",
      }),
    ]);
    importFile(store, goodPath);
    importFile(store, goneePath);
    await rm(goneePath); // its source vanishes before reimportAll runs

    const summary = reimportAll(store);

    expect(summary.results.map((r) => r.sessionId)).toEqual(["sess-good"]);
    expect(summary.failed).toEqual([
      { sessionId: "sess-gone", error: expect.stringContaining("no longer on disk") },
    ]);
    // The session whose source vanished must still have its stored data intact.
    expect(store.getSession("sess-gone")?.eventCount).toBe(1);
    expect(store.readEvents("sess-gone")).toHaveLength(1);
  });
});
