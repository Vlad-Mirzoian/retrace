import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RetraceStore, type RetraceReport } from "retrace-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportSummary, WatchHandle } from "./commands/import.js";
import type { InitResult } from "./commands/init.js";
import type { UiHandle } from "./commands/ui.js";
import type { ExportResult } from "./commands/export.js";
import type { ReimportAllSummary, ReimportResult } from "./commands/reimport.js";
import type { VerifyAllSummary, VerifyResult } from "./commands/verify.js";
import type { CheckAllSummary, CheckSessionResult } from "./commands/check.js";
import type { DeleteSessionsSummary } from "./commands/delete.js";
import type { ResetResult } from "./commands/reset.js";
import type { GenerateReportResult } from "./commands/report.js";
import { createProgram } from "./program.js";
import { CLI_VERSION } from "./version.js";

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

describe("createProgram — version", () => {
  it("wires CLI_VERSION into commander's --version, matching package.json rather than a hardcoded string", async () => {
    const program = createProgram({ createStore: () => store });
    expect(program.version()).toBe(CLI_VERSION);
  });
});

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

  it("fails clearly with exit code 2 when --projects-dir doesn't exist, instead of silently reporting 0 scanned", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // No injected `importOnce` here — this exercises the real, lazily-loaded
    // commands/import.js implementation, since the missing-directory check
    // lives there, not in program.ts's wiring.
    const program = createProgram({ createStore: () => store });
    await program.parseAsync([
      "node",
      "retrace",
      "import",
      "--projects-dir",
      join(home, "does-not-exist"),
    ]);

    expect(errorSpy.mock.calls.join("\n")).toMatch(/--projects-dir not found/i);
    expect(output()).not.toMatch(/scanned/i);
    expect(process.exitCode).toBe(2);

    errorSpy.mockRestore();
    process.exitCode = 0;
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

  it("reports a thrown error cleanly with exit code 2, instead of an uncaught stack trace", async () => {
    const exportSession = vi.fn().mockImplementation(() => {
      throw new Error("no session matches \"sess-1\"");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram({ createStore: () => store, exportSession });
    await program.parseAsync(["node", "retrace", "export", "sess-1"]);

    expect(errorSpy).toHaveBeenCalledWith('no session matches "sess-1"');
    expect(process.exitCode).toBe(2);

    errorSpy.mockRestore();
    process.exitCode = 0;
  });
});

describe("createProgram — reimport", () => {
  it("reimports a single session and reports the result", async () => {
    const result: ReimportResult = {
      sessionId: "sess-1",
      importPaths: ["/transcripts/sess-1.jsonl"],
      eventsImported: 12,
    };
    const reimportSession = vi.fn().mockReturnValue(result);

    const program = createProgram({ createStore: () => store, reimportSession });
    await program.parseAsync(["node", "retrace", "reimport", "sess-1"]);

    expect(reimportSession).toHaveBeenCalledTimes(1);
    const [passedStore, idOrPrefix] = reimportSession.mock.calls[0];
    expect(passedStore).toBe(store);
    expect(idOrPrefix).toBe("sess-1");
    expect(output()).toMatch(/sess-1: re-imported 12 event\(s\) from 1 file\(s\)/i);
  });

  it("prints exactly one summary line per session, not also importFile's own per-file log line", async () => {
    // Exercises the real (uninjected) reimportSession — the double-line
    // bug only shows up when the CLI's console logger actually gets
    // forwarded into importFile, which a mocked reimportSession bypasses.
    const projectsDir = await mkdtemp(join(tmpdir(), "retrace-program-reimport-projects-"));
    try {
      const dir = join(projectsDir, "proj-a");
      await mkdir(dir, { recursive: true });
      const path = join(dir, "sess-x.jsonl");
      await writeFile(
        path,
        `${JSON.stringify({
          sessionId: "sess-x",
          type: "user",
          message: { role: "user", content: "hi" },
          timestamp: "2026-07-15T10:00:00.000Z",
        })}\n`,
        "utf8",
      );
      const importOnce = (await import("./commands/import.js")).importOnce;
      importOnce(store, { projectsDir });

      const program = createProgram({ createStore: () => store });
      await program.parseAsync(["node", "retrace", "reimport", "sess-x"]);

      const lines = output().split("\n").filter(Boolean);
      expect(lines).toEqual(["sess-x: re-imported 1 event(s) from 1 file(s)"]);
    } finally {
      await rm(projectsDir, { recursive: true, force: true });
    }
  });

  it("reports a hook-only session as deleted with nothing to re-import", async () => {
    const reimportSession = vi
      .fn()
      .mockReturnValue({ sessionId: "hook-only", importPaths: [], eventsImported: 0 });

    const program = createProgram({ createStore: () => store, reimportSession });
    await program.parseAsync(["node", "retrace", "reimport", "hook-only"]);

    expect(output()).toMatch(/hook-only: deleted \(no known source transcript/i);
  });

  it("requires a sessionId when --all is not given", async () => {
    const reimportSession = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram({ createStore: () => store, reimportSession });
    await program.parseAsync(["node", "retrace", "reimport"]);

    expect(reimportSession).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("reimports every session and reports skipped ones with --all", async () => {
    const summary: ReimportAllSummary = {
      results: [{ sessionId: "sess-1", importPaths: ["/t/sess-1.jsonl"], eventsImported: 5 }],
      skipped: ["hook-only"],
      failed: [],
    };
    const reimportAll = vi.fn().mockReturnValue(summary);

    const program = createProgram({ createStore: () => store, reimportAll });
    await program.parseAsync(["node", "retrace", "reimport", "--all"]);

    expect(reimportAll).toHaveBeenCalledTimes(1);
    expect(output()).toMatch(/sess-1: re-imported 5 event\(s\) from 1 file\(s\)/i);
    expect(output()).toMatch(/skipped 1 session\(s\).*hook-only/i);
  });

  it("reports failed sessions via console.error and sets a non-zero exit code, without stopping the rest", async () => {
    const summary: ReimportAllSummary = {
      results: [{ sessionId: "sess-good", importPaths: ["/t/sess-good.jsonl"], eventsImported: 3 }],
      skipped: [],
      failed: [{ sessionId: "sess-gone", error: "source transcript(s) no longer on disk: /t/x" }],
    };
    const reimportAll = vi.fn().mockReturnValue(summary);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram({ createStore: () => store, reimportAll });
    await program.parseAsync(["node", "retrace", "reimport", "--all"]);

    expect(output()).toMatch(/sess-good: re-imported 3 event\(s\)/i);
    expect(errorSpy.mock.calls.join("\n")).toMatch(/sess-gone: FAILED.*no longer on disk/i);
    expect(process.exitCode).toBe(1);

    errorSpy.mockRestore();
    process.exitCode = 0;
  });
});

describe("createProgram — verify", () => {
  it("verifies a single session and reports it as verified", async () => {
    const result: VerifyResult = { sessionId: "sess-1", eventCount: 4, verification: { ok: true } };
    const verifySession = vi.fn().mockReturnValue(result);

    const program = createProgram({ createStore: () => store, verifySession });
    await program.parseAsync(["node", "retrace", "verify", "sess-1"]);

    expect(verifySession).toHaveBeenCalledTimes(1);
    const [passedStore, idOrPrefix] = verifySession.mock.calls[0];
    expect(passedStore).toBe(store);
    expect(idOrPrefix).toBe("sess-1");
    expect(output()).toMatch(/✓ sess-1: verified \(4 event\(s\)\)/);
  });

  it("reports a tampered session and sets a non-zero exit code", async () => {
    const result: VerifyResult = {
      sessionId: "sess-1",
      eventCount: 4,
      verification: { ok: false, index: 2, reason: "event hash does not match contents (tampered)" },
    };
    const verifySession = vi.fn().mockReturnValue(result);

    const program = createProgram({ createStore: () => store, verifySession });
    await program.parseAsync(["node", "retrace", "verify", "sess-1"]);

    expect(output()).toMatch(/✗ sess-1: tampered at seq 2 — event hash does not match contents/);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("reports an unreadable events.jsonl without a nonsensical 'at seq -1'", async () => {
    const result: VerifyResult = {
      sessionId: "sess-1",
      eventCount: 0,
      verification: { ok: false, index: -1, reason: "events.jsonl could not be read: boom" },
    };
    const verifySession = vi.fn().mockReturnValue(result);

    const program = createProgram({ createStore: () => store, verifySession });
    await program.parseAsync(["node", "retrace", "verify", "sess-1"]);

    expect(output()).toMatch(/^✗ sess-1: tampered — events\.jsonl could not be read: boom$/m);
    expect(output()).not.toMatch(/at seq/);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("requires a sessionId when --all is not given", async () => {
    const verifySession = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram({ createStore: () => store, verifySession });
    await program.parseAsync(["node", "retrace", "verify"]);

    expect(verifySession).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
    process.exitCode = 0;
  });

  it("verifies every session with --all and sets a non-zero exit code if any failed", async () => {
    const summary: VerifyAllSummary = {
      results: [
        { sessionId: "sess-good", eventCount: 2, verification: { ok: true } },
        {
          sessionId: "sess-bad",
          eventCount: 3,
          verification: { ok: false, index: 1, reason: "seq is not contiguous" },
        },
      ],
      failed: [
        {
          sessionId: "sess-bad",
          eventCount: 3,
          verification: { ok: false, index: 1, reason: "seq is not contiguous" },
        },
      ],
    };
    const verifyAll = vi.fn().mockReturnValue(summary);

    const program = createProgram({ createStore: () => store, verifyAll });
    await program.parseAsync(["node", "retrace", "verify", "--all"]);

    expect(verifyAll).toHaveBeenCalledTimes(1);
    expect(output()).toMatch(/✓ sess-good: verified \(2 event\(s\)\)/);
    expect(output()).toMatch(/✗ sess-bad: tampered at seq 1 — seq is not contiguous/);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});

describe("createProgram — check", () => {
  function report(findings: CheckSessionResult["report"]["findings"] = []): CheckSessionResult["report"] {
    return {
      sessionId: "sess-1",
      eventCount: 10,
      findings,
      rulesRun: ["edit-without-read", "unaddressed-error"],
      rulesSkipped: [],
    };
  }

  it("prints the clean-session line and does not set an exit code", async () => {
    const checkSession = vi.fn().mockReturnValue({ sessionId: "sess-1", report: report([]) });

    const program = createProgram({ createStore: () => store, checkSession });
    await program.parseAsync(["node", "retrace", "check", "sess-1"]);

    expect(checkSession).toHaveBeenCalledTimes(1);
    const [passedStore, idOrPrefix] = checkSession.mock.calls[0];
    expect(passedStore).toBe(store);
    expect(idOrPrefix).toBe("sess-1");
    expect(output()).toMatch(/✓ sess-1 — no findings \(10 event\(s\), 2 rule\(s\) run\)/);
    expect(process.exitCode).toBeFalsy();
  });

  it("prints one line per finding and sets exit code 1 when the default (high) threshold is breached", async () => {
    const checkSession = vi.fn().mockReturnValue({
      sessionId: "sess-1",
      report: report([
        { ruleId: "unaddressed-error", severity: "high", title: "Bash failed with no follow-up", seq: 214 },
        { ruleId: "edit-without-read", severity: "medium", title: "src/auth.ts edited without being read", seq: 87 },
      ]),
    });

    const program = createProgram({ createStore: () => store, checkSession });
    await program.parseAsync(["node", "retrace", "check", "sess-1"]);

    expect(output()).toMatch(/✗ sess-1 — 2 finding\(s\)/);
    // Sorted worst-severity-first: high before medium.
    expect(output().indexOf("high")).toBeLessThan(output().indexOf("medium"));
    expect(output()).toMatch(/seq {2}214.*Bash failed with no follow-up/);
    expect(output()).toMatch(/retrace ui/);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("marks a sidechain finding with a (subagent) suffix", async () => {
    const checkSession = vi.fn().mockReturnValue({
      sessionId: "sess-1",
      report: report([
        { ruleId: "edit-without-read", severity: "medium", title: "a.ts edited blind", seq: 1, sidechain: true },
      ]),
    });

    const program = createProgram({ createStore: () => store, checkSession });
    await program.parseAsync(["node", "retrace", "check", "sess-1"]);

    expect(output()).toMatch(/a\.ts edited blind \(subagent\)/);
    process.exitCode = 0;
  });

  it("lists skipped rules under their own heading", async () => {
    const checkSession = vi.fn().mockReturnValue({
      sessionId: "sess-1",
      report: {
        ...report([]),
        rulesSkipped: [{ ruleId: "flaky-rule", reason: "boom" }],
      },
    });

    const program = createProgram({ createStore: () => store, checkSession });
    await program.parseAsync(["node", "retrace", "check", "sess-1"]);

    expect(output()).toMatch(/skipped:\s*\n\s*flaky-rule: boom/);
  });

  it("exits 0 with --fail-on never even when findings are present", async () => {
    const checkSession = vi.fn().mockReturnValue({
      sessionId: "sess-1",
      report: report([{ ruleId: "unaddressed-error", severity: "high", title: "x", seq: 1 }]),
    });

    const program = createProgram({ createStore: () => store, checkSession });
    await program.parseAsync(["node", "retrace", "check", "sess-1", "--fail-on", "never"]);

    expect(process.exitCode).toBeFalsy();
  });

  it("rejects an invalid --fail-on value with exit code 2", async () => {
    const checkSession = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram({ createStore: () => store, checkSession });
    await program.parseAsync(["node", "retrace", "check", "sess-1", "--fail-on", "catastrophic"]);

    expect(checkSession).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
    expect(errorSpy.mock.calls.join("\n")).toMatch(/invalid --fail-on/i);

    errorSpy.mockRestore();
    process.exitCode = 0;
  });

  it("exits 2 with a clear message, not a crash, when the session id can't be resolved", async () => {
    const checkSession = vi.fn().mockImplementation(() => {
      throw new Error('"amb" matches 2 sessions: amb-1, amb-2');
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram({ createStore: () => store, checkSession });
    await program.parseAsync(["node", "retrace", "check", "amb"]);

    expect(process.exitCode).toBe(2);
    expect(errorSpy.mock.calls.join("\n")).toMatch(/matches 2 sessions/);

    errorSpy.mockRestore();
    process.exitCode = 0;
  });

  it("requires a sessionId when --all is not given", async () => {
    const checkSession = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram({ createStore: () => store, checkSession });
    await program.parseAsync(["node", "retrace", "check"]);

    expect(checkSession).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);

    errorSpy.mockRestore();
    process.exitCode = 0;
  });

  it("emits the raw report as parseable JSON and nothing else, with no exit code on a clean report", async () => {
    const checkSession = vi.fn().mockReturnValue({ sessionId: "sess-1", report: report([]) });

    const program = createProgram({ createStore: () => store, checkSession });
    await program.parseAsync(["node", "retrace", "check", "sess-1", "--json"]);

    const calls = logSpy.mock.calls;
    expect(calls).toHaveLength(1);
    const parsed = JSON.parse(calls[0][0] as string);
    expect(parsed.findings).toEqual([]);
    expect(process.exitCode).toBeFalsy();
  });

  it("checks every session with --all, printing all results and exiting 1 if any breaches the threshold", async () => {
    const summary: CheckAllSummary = {
      results: [
        { sessionId: "sess-good", report: report([]) },
        {
          sessionId: "sess-bad",
          report: report([{ ruleId: "unaddressed-error", severity: "high", title: "boom", seq: 5 }]),
        },
      ],
      failed: [
        {
          sessionId: "sess-bad",
          report: report([{ ruleId: "unaddressed-error", severity: "high", title: "boom", seq: 5 }]),
        },
      ],
    };
    const checkAll = vi.fn().mockReturnValue(summary);

    const program = createProgram({ createStore: () => store, checkAll });
    await program.parseAsync(["node", "retrace", "check", "--all"]);

    expect(checkAll).toHaveBeenCalledTimes(1);
    expect(output()).toMatch(/✓ sess-good — no findings/);
    expect(output()).toMatch(/✗ sess-bad — 1 finding\(s\)/);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("passes --disable through as the disabled rule list", async () => {
    const checkSession = vi.fn().mockReturnValue({ sessionId: "sess-1", report: report([]) });

    const program = createProgram({ createStore: () => store, checkSession });
    await program.parseAsync([
      "node",
      "retrace",
      "check",
      "sess-1",
      "--disable",
      "edit-without-read",
      "unaddressed-error",
    ]);

    const [, , options] = checkSession.mock.calls[0];
    expect(options.disabled).toEqual(["edit-without-read", "unaddressed-error"]);
  });

  it("lists every registered rule with --list-rules and needs no store or session", async () => {
    const checkSession = vi.fn();
    const checkAll = vi.fn();

    const program = createProgram({ createStore: () => store, checkSession, checkAll });
    await program.parseAsync(["node", "retrace", "check", "--list-rules"]);

    expect(checkSession).not.toHaveBeenCalled();
    expect(checkAll).not.toHaveBeenCalled();
    expect(output()).toMatch(/edit-without-read\s+medium/);
    expect(output()).toMatch(/unaddressed-error\s+high/);
    expect(process.exitCode).toBeFalsy();
  });

  it("end-to-end against the real flagged-session fixture: no injected deps, real rules, real exit code", async () => {
    const { importFile } = await import("./commands/import.js");
    const path = fileURLToPath(new URL("../../core/fixtures/flagged-session.jsonl", import.meta.url));
    const imported = importFile(store, path);

    // No checkSession/checkAll injected — this exercises the real lazily-loaded implementation.
    const program = createProgram({ createStore: () => store });
    await program.parseAsync(["node", "retrace", "check", imported.sessionId, "--fail-on", "medium"]);

    expect(output()).toMatch(new RegExp(`✗ ${imported.sessionId} — 5 finding\\(s\\)`));
    expect(output()).toMatch(/edit-without-read/);
    expect(output()).toMatch(/unaddressed-error/);
    expect(output()).toMatch(/unverified-test-claim/);
    expect(output()).toMatch(/claimed-change-missing/);
    expect(output()).toMatch(/untracked-bash-mutation/);
    expect(process.exitCode).toBe(1);

    process.exitCode = 0;
  });
});

describe("createProgram — compare", () => {
  it("starts the compare view and registers a SIGINT handler to stop it", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const handle: UiHandle = { url: "http://localhost:1234", port: 1234, stop };
    const startCompare = vi.fn().mockResolvedValue(handle);

    const program = createProgram({ createStore: () => store, startCompare });
    await program.parseAsync(["node", "retrace", "compare", "sess-a", "sess-b"]);

    expect(startCompare).toHaveBeenCalledTimes(1);
    const [passedStore, idA, idB, options] = startCompare.mock.calls[0];
    expect(passedStore).toBe(store);
    expect(idA).toBe("sess-a");
    expect(idB).toBe("sess-b");
    expect(options.port).toBeUndefined();

    process.emit("SIGINT");
    await Promise.resolve();
    await Promise.resolve();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("parses --port and passes it through as a number", async () => {
    const handle: UiHandle = { url: "http://localhost:9", port: 9, stop: vi.fn() };
    const startCompare = vi.fn().mockResolvedValue(handle);

    const program = createProgram({ createStore: () => store, startCompare });
    await program.parseAsync(["node", "retrace", "compare", "sess-a", "sess-b", "--port", "4321"]);

    const [, , , options] = startCompare.mock.calls[0];
    expect(options.port).toBe(4321);
    process.emit("SIGINT");
  });

  it("passes openBrowser: false when --no-open is given", async () => {
    const handle: UiHandle = { url: "http://localhost:9", port: 9, stop: vi.fn() };
    const startCompare = vi.fn().mockResolvedValue(handle);

    const program = createProgram({ createStore: () => store, startCompare });
    await program.parseAsync(["node", "retrace", "compare", "sess-a", "sess-b", "--no-open"]);

    const [, , , options] = startCompare.mock.calls[0];
    expect(options.openBrowser).toBe(false);
    process.emit("SIGINT");
  });
});

describe("createProgram — delete", () => {
  it("deletes the given sessions without prompting when --yes is passed", async () => {
    const summary: DeleteSessionsSummary = { deleted: ["sess-1", "sess-2"], failed: [] };
    const deleteSessions = vi.fn().mockReturnValue(summary);
    const confirm = vi.fn();

    const program = createProgram({ createStore: () => store, deleteSessions, confirm });
    await program.parseAsync(["node", "retrace", "delete", "sess-1", "sess-2", "--yes"]);

    expect(confirm).not.toHaveBeenCalled();
    const [passedStore, ids] = deleteSessions.mock.calls[0];
    expect(passedStore).toBe(store);
    expect(ids).toEqual(["sess-1", "sess-2"]);
    expect(output()).toMatch(/sess-1: deleted/);
    expect(output()).toMatch(/sess-2: deleted/);
  });

  it("prompts for confirmation, and skips deletion when declined", async () => {
    const deleteSessions = vi.fn();
    const confirm = vi.fn().mockResolvedValue(false);

    const program = createProgram({ createStore: () => store, deleteSessions, confirm });
    await program.parseAsync(["node", "retrace", "delete", "sess-1"]);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatch(/permanently delete 1 session \(sess-1\)/i);
    expect(deleteSessions).not.toHaveBeenCalled();
    expect(output()).toMatch(/aborted/i);
  });

  it("deletes when the user confirms", async () => {
    const summary: DeleteSessionsSummary = { deleted: ["sess-1"], failed: [] };
    const deleteSessions = vi.fn().mockReturnValue(summary);
    const confirm = vi.fn().mockResolvedValue(true);

    const program = createProgram({ createStore: () => store, deleteSessions, confirm });
    await program.parseAsync(["node", "retrace", "delete", "sess-1"]);

    expect(deleteSessions).toHaveBeenCalledTimes(1);
    expect(output()).toMatch(/sess-1: deleted/);
  });

  it("reports unresolvable ids via console.error and sets a non-zero exit code, without stopping the rest", async () => {
    const summary: DeleteSessionsSummary = {
      deleted: ["sess-good"],
      failed: [{ input: "sess-gone", error: 'no session matches "sess-gone"' }],
    };
    const deleteSessions = vi.fn().mockReturnValue(summary);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram({ createStore: () => store, deleteSessions });
    await program.parseAsync(["node", "retrace", "delete", "sess-good", "sess-gone", "--yes"]);

    expect(output()).toMatch(/sess-good: deleted/);
    expect(errorSpy.mock.calls.join("\n")).toMatch(/sess-gone: FAILED — no session matches/);
    expect(process.exitCode).toBe(1);

    errorSpy.mockRestore();
    process.exitCode = 0;
  });
});

describe("createProgram — reset", () => {
  it("wipes the store without prompting when --yes is passed", async () => {
    const result: ResetResult = { homeDir: "/home/.retrace", sessionCount: 3 };
    const resetStore = vi.fn().mockReturnValue(result);
    const confirm = vi.fn();

    const program = createProgram({ createStore: () => store, resetStore, confirm });
    await program.parseAsync(["node", "retrace", "reset", "--yes"]);

    expect(confirm).not.toHaveBeenCalled();
    expect(resetStore).toHaveBeenCalledWith(store);
    expect(output()).toMatch(/deleted 3 session\(s\) and removed \/home\/\.retrace/i);
  });

  it("prompts for confirmation, naming the store's homeDir, and skips the wipe when declined", async () => {
    const resetStore = vi.fn();
    const confirm = vi.fn().mockResolvedValue(false);

    const program = createProgram({ createStore: () => store, resetStore, confirm });
    await program.parseAsync(["node", "retrace", "reset"]);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain(store.homeDir);
    expect(resetStore).not.toHaveBeenCalled();
    expect(output()).toMatch(/aborted/i);
  });

  it("wipes the store when the user confirms", async () => {
    const result: ResetResult = { homeDir: store.homeDir, sessionCount: 0 };
    const resetStore = vi.fn().mockReturnValue(result);
    const confirm = vi.fn().mockResolvedValue(true);

    const program = createProgram({ createStore: () => store, resetStore, confirm });
    await program.parseAsync(["node", "retrace", "reset"]);

    expect(resetStore).toHaveBeenCalledTimes(1);
    expect(output()).toMatch(/deleted 0 session\(s\)/i);
  });
});

describe("createProgram — report", () => {
  function report(
    findings: RetraceReport["findings"] = [],
    overrides: Partial<RetraceReport> = {},
  ): RetraceReport {
    return {
      version: 1,
      generatedAt: "2026-07-15T14:37:00.000Z",
      tool: { name: "retrace", version: "0.4.0" },
      range: { base: "main", head: "abc123" },
      sessions: findings.length > 0 ? [{ id: "sess-1", startedAt: null, endedAt: null, commits: ["abc123"], confidence: "exact" }] : [],
      findings,
      rulesRun: ["unaddressed-error"],
      rulesSkipped: [],
      ...overrides,
    };
  }

  function generateResult(r: RetraceReport): GenerateReportResult {
    return { report: r, repoRoot: "/repo", headSha: "abc123", baseRef: "main" };
  }

  it("writes a note and exits 0 for a clean report", async () => {
    const generateReport = vi.fn().mockReturnValue(generateResult(report([])));
    const writeReportNote = vi.fn();

    const program = createProgram({ createStore: () => store, generateReport, writeReportNote });
    await program.parseAsync(["node", "retrace", "report"]);

    expect(writeReportNote).toHaveBeenCalledWith("/repo", "abc123", report([]), undefined);
    expect(output()).toMatch(/wrote report note for abc123/i);
    expect(output()).toMatch(/no findings/i);
    expect(process.exitCode).toBeFalsy();
  });

  it("sets exit code 1 when a finding meets the default (high) threshold", async () => {
    const withHigh = report([
      { ruleId: "unaddressed-error", severity: "high", title: "x", seq: 1, sessionId: "sess-1" },
    ]);
    const generateReport = vi.fn().mockReturnValue(generateResult(withHigh));
    const writeReportNote = vi.fn();

    const program = createProgram({ createStore: () => store, generateReport, writeReportNote });
    await program.parseAsync(["node", "retrace", "report"]);

    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("does not breach for a medium finding against the default (high) threshold", async () => {
    const withMedium = report([
      { ruleId: "edit-without-read", severity: "medium", title: "x", seq: 1, sessionId: "sess-1" },
    ]);
    const generateReport = vi.fn().mockReturnValue(generateResult(withMedium));
    const writeReportNote = vi.fn();

    const program = createProgram({ createStore: () => store, generateReport, writeReportNote });
    await program.parseAsync(["node", "retrace", "report"]);

    expect(process.exitCode).toBeFalsy();
  });

  it("exits 0 with --fail-on never even when a high finding is present", async () => {
    const withHigh = report([
      { ruleId: "unaddressed-error", severity: "high", title: "x", seq: 1, sessionId: "sess-1" },
    ]);
    const generateReport = vi.fn().mockReturnValue(generateResult(withHigh));
    const writeReportNote = vi.fn();

    const program = createProgram({ createStore: () => store, generateReport, writeReportNote });
    await program.parseAsync(["node", "retrace", "report", "--fail-on", "never"]);

    expect(process.exitCode).toBeFalsy();
  });

  it("writes to --output instead of a note, with the same JSON a note would carry", async () => {
    const generateReport = vi.fn().mockReturnValue(generateResult(report([])));
    const writeReportNote = vi.fn();
    const outputPath = join(home, "out.json");

    const program = createProgram({ createStore: () => store, generateReport, writeReportNote });
    await program.parseAsync(["node", "retrace", "report", "--output", outputPath]);

    expect(writeReportNote).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(outputPath, "utf8"))).toEqual(report([]));
  });

  it("publishes the note when --publish is given", async () => {
    const generateReport = vi.fn().mockReturnValue(generateResult(report([])));
    const writeReportNote = vi.fn();
    const publishReportNote = vi.fn();

    const program = createProgram({ createStore: () => store, generateReport, writeReportNote, publishReportNote });
    await program.parseAsync(["node", "retrace", "report", "--publish", "--remote", "upstream"]);

    expect(publishReportNote).toHaveBeenCalledWith("/repo", "upstream", undefined);
  });

  it("threads --notes-ref through to writeReportNote, publishReportNote, and readReportNote", async () => {
    const generateReport = vi.fn().mockReturnValue(generateResult(report([])));
    const writeReportNote = vi.fn();
    const publishReportNote = vi.fn();

    const program = createProgram({ createStore: () => store, generateReport, writeReportNote, publishReportNote });
    await program.parseAsync(["node", "retrace", "report", "--publish", "--notes-ref", "custom-ref"]);

    expect(writeReportNote).toHaveBeenCalledWith("/repo", "abc123", report([]), "custom-ref");
    expect(publishReportNote).toHaveBeenCalledWith("/repo", "origin", "custom-ref");

    const resolveRepoRoot = vi.fn().mockReturnValue("/repo");
    const readReportNote = vi.fn().mockReturnValue(undefined);
    const readProgram = createProgram({ createStore: () => store, resolveRepoRoot, readReportNote });
    await readProgram.parseAsync(["node", "retrace", "report", "--read", "abc123", "--notes-ref", "custom-ref"]);

    expect(readReportNote).toHaveBeenCalledWith("/repo", "abc123", "custom-ref");
  });

  it("exits 2 with a clear message, not a crash, outside a git repository", async () => {
    const generateReport = vi.fn().mockImplementation(() => {
      throw new Error("/some/dir is not inside a git repository");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram({ createStore: () => store, generateReport });
    await program.parseAsync(["node", "retrace", "report"]);

    expect(process.exitCode).toBe(2);
    expect(errorSpy.mock.calls.join("\n")).toMatch(/not inside a git repository/);

    errorSpy.mockRestore();
    process.exitCode = 0;
  });

  it("rejects an invalid --fail-on value with exit code 2, without generating a report", async () => {
    const generateReport = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram({ createStore: () => store, generateReport });
    await program.parseAsync(["node", "retrace", "report", "--fail-on", "catastrophic"]);

    expect(generateReport).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
    expect(errorSpy.mock.calls.join("\n")).toMatch(/invalid --fail-on/i);

    errorSpy.mockRestore();
    process.exitCode = 0;
  });

  it("exits 2 with a clear message, not exit 1 from an uncaught exception, when the store can't be opened", async () => {
    const generateReport = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram({
      createStore: () => {
        throw new Error("unable to open database file");
      },
      generateReport,
    });
    await program.parseAsync(["node", "retrace", "report"]);

    expect(generateReport).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
    expect(errorSpy.mock.calls.join("\n")).toMatch(/unable to open database file/);

    errorSpy.mockRestore();
    process.exitCode = 0;
  });

  describe("--read", () => {
    it("prints a stored report and applies the same exit-code contract", async () => {
      const withHigh = report([
        { ruleId: "unaddressed-error", severity: "high", title: "x", seq: 1, sessionId: "sess-1" },
      ]);
      const resolveRepoRoot = vi.fn().mockReturnValue("/repo");
      const readReportNote = vi.fn().mockReturnValue(withHigh);

      const program = createProgram({ createStore: () => store, resolveRepoRoot, readReportNote });
      await program.parseAsync(["node", "retrace", "report", "--read", "abc123"]);

      expect(readReportNote).toHaveBeenCalledWith("/repo", "abc123", undefined);
      expect(process.exitCode).toBe(1);
      process.exitCode = 0;
    });

    it("exits 0 with a neutral message when no note is found for the sha", async () => {
      const resolveRepoRoot = vi.fn().mockReturnValue("/repo");
      const readReportNote = vi.fn().mockReturnValue(undefined);

      const program = createProgram({ createStore: () => store, resolveRepoRoot, readReportNote });
      await program.parseAsync(["node", "retrace", "report", "--read", "abc123"]);

      expect(output()).toMatch(/no retrace report for abc123 — nothing to check/i);
      expect(process.exitCode).toBeFalsy();
    });

    it("does not touch the store at all", async () => {
      const resolveRepoRoot = vi.fn().mockReturnValue("/repo");
      const readReportNote = vi.fn().mockReturnValue(undefined);
      const createStore = vi.fn().mockReturnValue(store);

      const program = createProgram({ createStore, resolveRepoRoot, readReportNote });
      await program.parseAsync(["node", "retrace", "report", "--read", "abc123"]);

      expect(createStore).not.toHaveBeenCalled();
    });

    it("--disable drops that rule's findings from both the printed report and the --fail-on breach check", async () => {
      const withMixed = report([
        { ruleId: "unaddressed-error", severity: "high", title: "keep me", seq: 1, sessionId: "sess-1" },
        { ruleId: "edit-without-read", severity: "high", title: "drop me", seq: 2, sessionId: "sess-1" },
      ]);
      const resolveRepoRoot = vi.fn().mockReturnValue("/repo");
      const readReportNote = vi.fn().mockReturnValue(withMixed);

      const program = createProgram({ createStore: () => store, resolveRepoRoot, readReportNote });
      await program.parseAsync([
        "node",
        "retrace",
        "report",
        "--read",
        "abc123",
        "--json",
        "--disable",
        "edit-without-read",
      ]);

      const printed = JSON.parse(output()) as RetraceReport;
      expect(printed.findings.map((f) => f.ruleId)).toEqual(["unaddressed-error"]);
      process.exitCode = 0;
    });

    it("--disable can bring a --read report below the --fail-on threshold entirely", async () => {
      const onlyDisabledRuleBreaches = report([
        { ruleId: "edit-without-read", severity: "high", title: "the only high finding", seq: 1, sessionId: "sess-1" },
      ]);
      const resolveRepoRoot = vi.fn().mockReturnValue("/repo");
      const readReportNote = vi.fn().mockReturnValue(onlyDisabledRuleBreaches);

      const program = createProgram({ createStore: () => store, resolveRepoRoot, readReportNote });
      await program.parseAsync(["node", "retrace", "report", "--read", "abc123", "--disable", "edit-without-read"]);

      expect(process.exitCode).toBeFalsy();
    });
  });

  describe("--format github", () => {
    afterEach(() => {
      delete process.env.GITHUB_STEP_SUMMARY;
    });

    it("prints only workflow-command annotation lines to stdout and writes the summary to $GITHUB_STEP_SUMMARY", async () => {
      const withFinding = report([
        { ruleId: "unaddressed-error", severity: "high", title: "boom", seq: 1, sessionId: "sess-1", repoPath: "src/a.ts" },
      ]);
      const generateReport = vi.fn().mockReturnValue(generateResult(withFinding));
      const changedFilesInRange = vi.fn().mockReturnValue(undefined);
      const summaryPath = join(home, "summary.md");
      process.env.GITHUB_STEP_SUMMARY = summaryPath;

      const program = createProgram({
        createStore: () => store,
        generateReport,
        writeReportNote: vi.fn(),
        changedFilesInRange,
      });
      await program.parseAsync(["node", "retrace", "report", "--format", "github", "--fail-on", "never"]);

      expect(output()).toBe("::error file=src/a.ts,line=1,title=boom::boom");
      const summary = readFileSync(summaryPath, "utf8");
      expect(summary).toContain("Retrace findings");
      expect(summary).toContain("boom");
    });

    it("falls back to printing the summary to stdout when $GITHUB_STEP_SUMMARY isn't set", async () => {
      const withFinding = report([
        { ruleId: "unaddressed-error", severity: "low", title: "note", seq: 1, sessionId: "sess-1", repoPath: "a.ts" },
      ]);
      const generateReport = vi.fn().mockReturnValue(generateResult(withFinding));
      const changedFilesInRange = vi.fn().mockReturnValue(undefined);

      const program = createProgram({
        createStore: () => store,
        generateReport,
        writeReportNote: vi.fn(),
        changedFilesInRange,
      });
      await program.parseAsync(["node", "retrace", "report", "--format", "github", "--fail-on", "never"]);

      expect(output()).toContain("::notice file=a.ts,line=1,title=note::note");
      expect(output()).toContain("Retrace findings");
    });

    it("filters annotations to the changed-files list returned by changedFilesInRange", async () => {
      const withFindings = report([
        { ruleId: "unaddressed-error", severity: "medium", title: "in diff", seq: 1, sessionId: "sess-1", repoPath: "src/in.ts" },
        { ruleId: "unaddressed-error", severity: "medium", title: "outside diff", seq: 2, sessionId: "sess-1", repoPath: "src/out.ts" },
      ]);
      const generateReport = vi.fn().mockReturnValue(generateResult(withFindings));
      const changedFilesInRange = vi.fn().mockReturnValue(["src/in.ts"]);

      const program = createProgram({
        createStore: () => store,
        generateReport,
        writeReportNote: vi.fn(),
        changedFilesInRange,
      });
      await program.parseAsync(["node", "retrace", "report", "--format", "github", "--fail-on", "never"]);

      expect(output()).toContain("title=in diff");
      expect(output()).not.toContain("title=outside diff");
      expect(changedFilesInRange).toHaveBeenCalledWith("/repo", withFindings.range);
    });

    it("respects --max-annotations", async () => {
      const findings = Array.from({ length: 5 }, (_, i) => ({
        ruleId: "unaddressed-error",
        severity: "low" as const,
        title: `finding ${i}`,
        seq: i,
        sessionId: "sess-1",
        repoPath: `f${i}.ts`,
      }));
      const generateReport = vi.fn().mockReturnValue(generateResult(report(findings)));
      const changedFilesInRange = vi.fn().mockReturnValue(undefined);

      const program = createProgram({
        createStore: () => store,
        generateReport,
        writeReportNote: vi.fn(),
        changedFilesInRange,
      });
      await program.parseAsync([
        "node",
        "retrace",
        "report",
        "--format",
        "github",
        "--max-annotations",
        "2",
        "--fail-on",
        "never",
      ]);

      const annotationLines = output().split("\n").filter((line) => line.startsWith("::"));
      expect(annotationLines).toHaveLength(2);
    });

    it("rejects an invalid --format value with exit code 2", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const generateReport = vi.fn();

      const program = createProgram({ createStore: () => store, generateReport });
      await program.parseAsync(["node", "retrace", "report", "--format", "yaml"]);

      expect(generateReport).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(2);
      expect(errorSpy.mock.calls.join("\n")).toMatch(/invalid --format/i);

      errorSpy.mockRestore();
      process.exitCode = 0;
    });

    it("rejects a non-numeric --max-annotations value with exit code 2", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const generateReport = vi.fn();

      const program = createProgram({ createStore: () => store, generateReport });
      await program.parseAsync(["node", "retrace", "report", "--max-annotations", "not-a-number"]);

      expect(generateReport).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(2);
      expect(errorSpy.mock.calls.join("\n")).toMatch(/invalid --max-annotations/i);

      errorSpy.mockRestore();
      process.exitCode = 0;
    });

    it("also formats as github for --read", async () => {
      const withFinding = report([
        { ruleId: "unaddressed-error", severity: "medium", title: "from a note", seq: 1, sessionId: "sess-1", repoPath: "a.ts" },
      ]);
      const resolveRepoRoot = vi.fn().mockReturnValue("/repo");
      const readReportNote = vi.fn().mockReturnValue(withFinding);
      const changedFilesInRange = vi.fn().mockReturnValue(undefined);

      const program = createProgram({
        createStore: () => store,
        resolveRepoRoot,
        readReportNote,
        changedFilesInRange,
      });
      await program.parseAsync(["node", "retrace", "report", "--read", "abc123", "--format", "github", "--fail-on", "never"]);

      expect(output()).toContain("::warning file=a.ts,line=1,title=from a note::from a note");
    });

    it("with --read, --base/--head override the stored report's own range for the changed-files diff", async () => {
      const withFinding = report(
        [{ ruleId: "unaddressed-error", severity: "medium", title: "x", seq: 1, sessionId: "sess-1", repoPath: "a.ts" }],
        { range: { base: "stale-local-base", head: "stale-local-head" } },
      );
      const resolveRepoRoot = vi.fn().mockReturnValue("/repo");
      const readReportNote = vi.fn().mockReturnValue(withFinding);
      const changedFilesInRange = vi.fn().mockReturnValue(undefined);

      const program = createProgram({
        createStore: () => store,
        resolveRepoRoot,
        readReportNote,
        changedFilesInRange,
      });
      await program.parseAsync([
        "node",
        "retrace",
        "report",
        "--read",
        "abc123",
        "--format",
        "github",
        "--fail-on",
        "never",
        "--base",
        "pr-base-sha",
        "--head",
        "pr-head-sha",
      ]);

      expect(changedFilesInRange).toHaveBeenCalledWith("/repo", { base: "pr-base-sha", head: "pr-head-sha" });
    });

    it("with --read and no --base/--head, falls back to the stored report's own range", async () => {
      const withFinding = report(
        [{ ruleId: "unaddressed-error", severity: "medium", title: "x", seq: 1, sessionId: "sess-1", repoPath: "a.ts" }],
        { range: { base: "main", head: "abc123" } },
      );
      const resolveRepoRoot = vi.fn().mockReturnValue("/repo");
      const readReportNote = vi.fn().mockReturnValue(withFinding);
      const changedFilesInRange = vi.fn().mockReturnValue(undefined);

      const program = createProgram({
        createStore: () => store,
        resolveRepoRoot,
        readReportNote,
        changedFilesInRange,
      });
      await program.parseAsync(["node", "retrace", "report", "--read", "abc123", "--format", "github", "--fail-on", "never"]);

      expect(changedFilesInRange).toHaveBeenCalledWith("/repo", { base: "main", head: "abc123" });
    });
  });
});
