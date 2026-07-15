import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RetraceStore } from "@retrace/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportSummary, WatchHandle } from "./commands/import.js";
import { createProgram } from "./program.js";

let home: string;
let store: RetraceStore;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "retrace-program-"));
  store = new RetraceStore(home);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  store.close();
  logSpy.mockRestore();
  await rm(home, { recursive: true, force: true });
});

function output(): string {
  return logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
}

describe("createProgram — list", () => {
  it("prints a friendly message when the store has no sessions", async () => {
    const program = createProgram({ createStore: () => store });
    await program.parseAsync(["node", "retrace", "list"]);
    expect(output()).toMatch(/no sessions/i);
  });

  it("prints the store's sessions as a table", async () => {
    store.appendEvent({
      ts: "2026-07-15T14:37:00.000Z",
      sessionId: "sess-1",
      kind: "user_prompt",
      payload: { text: "hello" },
    });
    store.ensureSession({ id: "sess-1", project: "demo", title: "Demo session" });

    const program = createProgram({ createStore: () => store });
    await program.parseAsync(["node", "retrace", "list"]);

    expect(output()).toContain("demo");
    expect(output()).toContain("Demo session");
  });
});

describe("createProgram — import", () => {
  it("runs a one-shot import and reports the summary", async () => {
    const summary: ImportSummary = {
      filesScanned: 3,
      filesChanged: 2,
      eventsImported: 10,
      results: [],
    };
    const importOnce = vi.fn().mockReturnValue(summary);

    const program = createProgram({ createStore: () => store, importOnce });
    await program.parseAsync(["node", "retrace", "import", "--projects-dir", "/some/dir"]);

    expect(importOnce).toHaveBeenCalledTimes(1);
    const [passedStore, options] = importOnce.mock.calls[0];
    expect(passedStore).toBe(store);
    expect(options.projectsDir).toBe("/some/dir");
    expect(output()).toMatch(/scanned 3 file/i);
    expect(output()).toMatch(/imported 10 event/i);
  });

  it("does not call the one-shot importer when --watch is passed", async () => {
    const importOnce = vi.fn();
    const handle: WatchHandle = { stop: vi.fn() };
    const watchImport = vi.fn().mockReturnValue(handle);

    const program = createProgram({ createStore: () => store, importOnce, watchImport });
    await program.parseAsync(["node", "retrace", "import", "--watch"]);

    expect(watchImport).toHaveBeenCalledTimes(1);
    expect(importOnce).not.toHaveBeenCalled();
    expect(output()).toMatch(/watching/i);

    // Clean up the SIGINT/SIGTERM listeners this invocation registered.
    process.emit("SIGINT");
    expect(handle.stop).toHaveBeenCalledTimes(1);
  });

  it("passes the --projects-dir option through to the injected importer", async () => {
    const importOnce = vi
      .fn()
      .mockReturnValue({ filesScanned: 0, filesChanged: 0, eventsImported: 0, results: [] });

    const program = createProgram({ createStore: () => store, importOnce });
    await program.parseAsync(["node", "retrace", "import"]);

    const [, options] = importOnce.mock.calls[0];
    expect(options.projectsDir).toBeUndefined();
  });
});
