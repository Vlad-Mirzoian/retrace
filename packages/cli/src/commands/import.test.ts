import { mkdir, mkdtemp, readFile, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RetraceStore } from "@retrace/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findTranscripts, importFile, importOnce, watchImport } from "./import.js";

let home: string;
let projectsDir: string;
let store: RetraceStore;

function record(fields: Record<string, unknown>): string {
  return JSON.stringify({ sessionId: "sess-x", ...fields });
}

const USER_LINE = record({
  type: "user",
  isSidechain: false,
  promptId: "p1",
  message: { role: "user", content: "hello" },
  timestamp: "2026-07-15T10:00:00.000Z",
  cwd: "/repo",
  gitBranch: "main",
  version: "2.1.181",
});
const ASSISTANT_LINE = record({
  type: "assistant",
  isSidechain: false,
  message: { role: "assistant", content: [{ type: "text", text: "hi there" }] },
  timestamp: "2026-07-15T10:00:01.000Z",
});
const FOLLOWUP_LINE = record({
  type: "assistant",
  isSidechain: false,
  message: { role: "assistant", content: [{ type: "text", text: "a follow-up" }] },
  timestamp: "2026-07-15T10:00:02.000Z",
});

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "retrace-import-home-"));
  projectsDir = await mkdtemp(join(tmpdir(), "retrace-import-projects-"));
  store = new RetraceStore(home);
});

afterEach(async () => {
  store.close();
  await rm(home, { recursive: true, force: true });
  await rm(projectsDir, { recursive: true, force: true });
});

async function writeTranscript(project: string, sessionId: string, lines: string[]): Promise<string> {
  const dir = join(projectsDir, project);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${sessionId}.jsonl`);
  await writeFile(path, lines.map((l) => `${l}\n`).join(""), "utf8");
  return path;
}

describe("findTranscripts", () => {
  it("finds .jsonl files nested under project directories", async () => {
    await writeTranscript("proj-a", "sess-1", [USER_LINE]);
    await writeTranscript("proj-b", "sess-2", [USER_LINE]);
    await mkdir(join(projectsDir, "proj-a"), { recursive: true });
    await writeFile(join(projectsDir, "proj-a", "notes.txt"), "not a transcript");

    const found = findTranscripts(projectsDir);
    expect(found).toHaveLength(2);
    expect(found.every((f) => f.endsWith(".jsonl"))).toBe(true);
  });

  it("returns an empty array for a missing directory", () => {
    expect(findTranscripts(join(projectsDir, "does-not-exist"))).toEqual([]);
  });
});

describe("importFile", () => {
  it("imports a fresh transcript into events + session metadata", async () => {
    const path = await writeTranscript("proj-a", "sess-x", [USER_LINE, ASSISTANT_LINE]);

    const result = importFile(store, path);
    expect(result.skipped).toBe(false);
    expect(result.imported).toBe(2); // user_prompt + assistant_text
    expect(result.sessionId).toBe("sess-x");

    const session = store.getSession("sess-x");
    expect(session?.project).toBe("proj-a");
    expect(session?.cwd).toBe("/repo");
    expect(session?.gitBranch).toBe("main");
    expect(session?.ccVersion).toBe("2.1.181");
    expect(session?.eventCount).toBe(2);

    const events = store.readEvents("sess-x", 0, 10);
    expect(events.map((e) => e.kind)).toEqual(["user_prompt", "assistant_text"]);
  });

  it("is a no-op on an unchanged file", async () => {
    const path = await writeTranscript("proj-a", "sess-x", [USER_LINE]);
    importFile(store, path);

    const second = importFile(store, path);
    expect(second.skipped).toBe(true);
    expect(second.imported).toBe(0);
    expect(store.getSession("sess-x")?.eventCount).toBe(1);
  });

  it("imports only newly appended lines on a growing transcript", async () => {
    const path = await writeTranscript("proj-a", "sess-x", [USER_LINE]);
    const first = importFile(store, path);
    expect(first.imported).toBe(1);

    const beforeGrowth = store.readEvents("sess-x", 0, 10);
    const firstEventHash = beforeGrowth[0].hash;

    await appendFile(path, `${ASSISTANT_LINE}\n${FOLLOWUP_LINE}\n`, "utf8");
    const second = importFile(store, path);
    expect(second.skipped).toBe(false);
    expect(second.imported).toBe(2);

    const all = store.readEvents("sess-x", 0, 10);
    expect(all).toHaveLength(3);
    expect(all.map((e) => e.kind)).toEqual([
      "user_prompt",
      "assistant_text",
      "assistant_text",
    ]);
    // The original event's position in the hash chain is untouched by the
    // incremental append.
    expect(all[0].hash).toBe(firstEventHash);
    expect(all[0].seq).toBe(0);
    expect(all[1].seq).toBe(1);
  });

  it("mirrors imported lines into the session's raw.jsonl in order", async () => {
    const path = await writeTranscript("proj-a", "sess-x", [USER_LINE]);
    importFile(store, path);
    await appendFile(path, `${ASSISTANT_LINE}\n`, "utf8");
    importFile(store, path);

    const raw = await readFile(store.rawPath("sess-x"), "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toEqual([USER_LINE, ASSISTANT_LINE]);
  });
});

describe("importOnce", () => {
  it("scans and imports every transcript under the projects directory", async () => {
    await writeTranscript("proj-a", "sess-1", [USER_LINE]);
    await writeTranscript("proj-b", "sess-2", [USER_LINE, ASSISTANT_LINE]);

    const summary = importOnce(store, { projectsDir });
    expect(summary.filesScanned).toBe(2);
    expect(summary.filesChanged).toBe(2);
    expect(summary.eventsImported).toBe(3);
    expect(store.listSessions().map((s) => s.id).sort()).toEqual(["sess-1", "sess-2"]);
  });

  it("is idempotent: a repeated run imports nothing new", async () => {
    await writeTranscript("proj-a", "sess-1", [USER_LINE]);
    importOnce(store, { projectsDir });

    const second = importOnce(store, { projectsDir });
    expect(second.filesChanged).toBe(0);
    expect(second.eventsImported).toBe(0);
  });
});

describe("watchImport", () => {
  it("runs an initial import pass for pre-existing transcripts", async () => {
    await writeTranscript("proj-a", "sess-1", [USER_LINE]);

    const handle = watchImport(store, { projectsDir, debounceMs: 20 });
    try {
      expect(store.getSession("sess-1")).toBeDefined();
    } finally {
      handle.stop();
    }
  });

  it("stop() releases the watcher without throwing", async () => {
    const handle = watchImport(store, { projectsDir, debounceMs: 20 });
    expect(() => handle.stop()).not.toThrow();
  });

  it("picks up a transcript created after the watch starts", async () => {
    const handle = watchImport(store, { projectsDir, debounceMs: 20 });
    try {
      await writeTranscript("proj-a", "sess-late", [USER_LINE]);

      await vi.waitFor(
        () => {
          expect(store.getSession("sess-late")).toBeDefined();
        },
        { timeout: 5000, interval: 50 },
      );
    } finally {
      handle.stop();
    }
  });
});
