import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RetraceStore } from "retrace-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportSummary, WatchHandle } from "./commands/import.js";
import type { InitResult } from "./commands/init.js";
import type { UiHandle } from "./commands/ui.js";
import type { ExportResult } from "./commands/export.js";
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

describe("createProgram — init", () => {
  it("installs hooks and reports the result", async () => {
    const result: InitResult = {
      settingsPath: "/repo/.claude/settings.json",
      changed: true,
      created: true,
    };
    const initHooks = vi.fn().mockReturnValue(result);

    const program = createProgram({ createStore: () => store, initHooks });
    await program.parseAsync(["node", "retrace", "init"]);

    expect(initHooks).toHaveBeenCalledTimes(1);
    const [options] = initHooks.mock.calls[0];
    expect(options.settingsPath).toMatch(/\.claude[\\/]settings\.json$/);
    expect(output()).toMatch(/created/i);
  });

  it("reports when hooks are already present", async () => {
    const initHooks = vi.fn().mockReturnValue({
      settingsPath: "/repo/.claude/settings.json",
      changed: false,
      created: false,
    });

    const program = createProgram({ createStore: () => store, initHooks });
    await program.parseAsync(["node", "retrace", "init"]);
    expect(output()).toMatch(/already present/i);
  });
});

describe("createProgram — hook", () => {
  it("delegates to the injected hook runner", async () => {
    const runHook = vi.fn().mockResolvedValue(undefined);
    const program = createProgram({ createStore: () => store, runHook });
    await program.parseAsync(["node", "retrace", "hook"]);
    expect(runHook).toHaveBeenCalledTimes(1);
  });
});

describe("createProgram — ui", () => {
  it("starts the UI server and registers a SIGINT handler to stop it", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const handle: UiHandle = { url: "http://localhost:1234", port: 1234, stop };
    const startUi = vi.fn().mockResolvedValue(handle);

    const program = createProgram({ createStore: () => store, startUi });
    await program.parseAsync(["node", "retrace", "ui"]);

    expect(startUi).toHaveBeenCalledTimes(1);
    const [passedStore, options] = startUi.mock.calls[0];
    expect(passedStore).toBe(store);
    expect(options.port).toBeUndefined();

    process.emit("SIGINT");
    // stop() is async; flush microtasks before asserting.
    await Promise.resolve();
    await Promise.resolve();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("parses --port and passes it through as a number", async () => {
    const handle: UiHandle = { url: "http://localhost:9", port: 9, stop: vi.fn() };
    const startUi = vi.fn().mockResolvedValue(handle);

    const program = createProgram({ createStore: () => store, startUi });
    await program.parseAsync(["node", "retrace", "ui", "--port", "4321"]);

    const [, options] = startUi.mock.calls[0];
    expect(options.port).toBe(4321);

    process.emit("SIGINT");
  });

  it("opens the browser by default", async () => {
    const handle: UiHandle = { url: "http://localhost:9", port: 9, stop: vi.fn() };
    const startUi = vi.fn().mockResolvedValue(handle);

    const program = createProgram({ createStore: () => store, startUi });
    await program.parseAsync(["node", "retrace", "ui"]);

    const [, options] = startUi.mock.calls[0];
    expect(options.openBrowser).toBe(true);
    process.emit("SIGINT");
  });

  it("passes openBrowser: false when --no-open is given", async () => {
    const handle: UiHandle = { url: "http://localhost:9", port: 9, stop: vi.fn() };
    const startUi = vi.fn().mockResolvedValue(handle);

    const program = createProgram({ createStore: () => store, startUi });
    await program.parseAsync(["node", "retrace", "ui", "--no-open"]);

    const [, options] = startUi.mock.calls[0];
    expect(options.openBrowser).toBe(false);
    process.emit("SIGINT");
  });
});

describe("createProgram — export", () => {
  it("defaults to HTML and reports the result", async () => {
    const result: ExportResult = { path: "sess-1.html", format: "html", eventCount: 42 };
    const exportSession = vi.fn().mockReturnValue(result);

    const program = createProgram({ createStore: () => store, exportSession });
    await program.parseAsync(["node", "retrace", "export", "sess-1"]);

    expect(exportSession).toHaveBeenCalledTimes(1);
    const [passedStore, sessionId, options] = exportSession.mock.calls[0];
    expect(passedStore).toBe(store);
    expect(sessionId).toBe("sess-1");
    expect(options.format).toBe("html");
    expect(output()).toMatch(/exported 42 event\(s\) to sess-1\.html/i);
  });

  it("exports as JSON when --json is given", async () => {
    const exportSession = vi
      .fn()
      .mockReturnValue({ path: "sess-1.json", format: "json", eventCount: 1 });

    const program = createProgram({ createStore: () => store, exportSession });
    await program.parseAsync(["node", "retrace", "export", "sess-1", "--json"]);

    const [, , options] = exportSession.mock.calls[0];
    expect(options.format).toBe("json");
  });

  it("passes --output through to the injected exporter", async () => {
    const exportSession = vi
      .fn()
      .mockReturnValue({ path: "/tmp/custom.html", format: "html", eventCount: 0 });

    const program = createProgram({ createStore: () => store, exportSession });
    await program.parseAsync([
      "node",
      "retrace",
      "export",
      "sess-1",
      "--output",
      "/tmp/custom.html",
    ]);

    const [, , options] = exportSession.mock.calls[0];
    expect(options.output).toBe("/tmp/custom.html");
  });

  it("passes the cli-computed viewerExportDir through", async () => {
    const exportSession = vi
      .fn()
      .mockReturnValue({ path: "sess-1.html", format: "html", eventCount: 0 });

    const program = createProgram({
      createStore: () => store,
      exportSession,
      viewerExportDir: "/embedded/viewer-export",
    });
    await program.parseAsync(["node", "retrace", "export", "sess-1"]);

    const [, , options] = exportSession.mock.calls[0];
    expect(options.viewerExportDir).toBe("/embedded/viewer-export");
  });
});
