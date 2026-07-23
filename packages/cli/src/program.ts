import { Command } from "commander";
import { RetraceStore } from "retrace-core";
import type {
  ImportOptions,
  ImportSummary,
  WatchHandle,
  WatchImportOptions,
} from "./commands/import.js";
import type { InitOptions, InitResult } from "./commands/init.js";
import type { UiHandle, UiOptions } from "./commands/ui.js";
import type { ExportOptions, ExportResult } from "./commands/export.js";
import type { ReimportAllSummary, ReimportResult } from "./commands/reimport.js";
import type { VerifyAllSummary, VerifyResult } from "./commands/verify.js";
import { CLI_VERSION } from "./version.js";

// Command implementations are pulled in only when their command actually runs.
// `retrace hook` is spawned by Claude Code once per tool call and sits on the
// critical path of every file edit, so it must not pay to load the HTTP server
// (hono, @hono/node-server) or the browser launcher (open) that only `ui` needs.
// Type-only imports above are erased at compile time and cost nothing.
const lazy = {
  import: () => import("./commands/import.js"),
  list: () => import("./commands/list.js"),
  init: () => import("./commands/init.js"),
  hook: () => import("./commands/hook.js"),
  ui: () => import("./commands/ui.js"),
  export: () => import("./commands/export.js"),
  reimport: () => import("./commands/reimport.js"),
  verify: () => import("./commands/verify.js"),
};

export interface ProgramDeps {
  createStore?: () => RetraceStore;
  importOnce?: (store: RetraceStore, options?: ImportOptions) => ImportSummary;
  watchImport?: (store: RetraceStore, options?: WatchImportOptions) => WatchHandle;
  initHooks?: (options: InitOptions) => InitResult;
  runHook?: (createStore: () => RetraceStore) => Promise<void>;
  startUi?: (store: RetraceStore, options?: UiOptions) => Promise<UiHandle>;
  exportSession?: (store: RetraceStore, sessionId: string, options: ExportOptions) => ExportResult;
  reimportSession?: (
    store: RetraceStore,
    idOrPrefix: string,
    log?: (message: string) => void,
  ) => ReimportResult;
  reimportAll?: (store: RetraceStore, log?: (message: string) => void) => ReimportAllSummary;
  verifySession?: (store: RetraceStore, idOrPrefix: string) => VerifyResult;
  verifyAll?: (store: RetraceStore) => VerifyAllSummary;
  /** Absolute path to the embedded viewer build; passed by cli.ts (see server/app.ts). */
  viewerDir?: string;
  /** Absolute path to the embedded single-file export template; passed by cli.ts. */
  viewerExportDir?: string;
}

interface ImportCommandOptions {
  watch?: boolean;
  projectsDir?: string;
}

interface InitCommandOptions {
  global?: boolean;
}

interface UiCommandOptions {
  port?: string;
  open?: boolean;
}

interface ExportCommandOptions {
  json?: boolean;
  output?: string;
}

interface ReimportCommandOptions {
  all?: boolean;
}

interface VerifyCommandOptions {
  all?: boolean;
}

/** "✓ id: verified (N event(s))" or "✗ id: tampered at seq S — <reason>". */
function formatVerifyResult(result: VerifyResult): string {
  if (result.verification.ok) {
    return `✓ ${result.sessionId}: verified (${result.eventCount} event(s))`;
  }
  return `✗ ${result.sessionId}: tampered at seq ${result.verification.index} — ${result.verification.reason}`;
}

/**
 * Build the `retrace` commander program. Dependencies (store construction,
 * import functions) are injectable so command wiring can be tested without
 * touching the real `~/.retrace` store or `~/.claude/projects`.
 */
export function createProgram(deps: ProgramDeps = {}): Command {
  const createStore = deps.createStore ?? (() => new RetraceStore());

  const program = new Command();
  program
    .name("retrace")
    .description("Retrace — a flight recorder for AI coding agents")
    .version(CLI_VERSION);

  program
    .command("import")
    .description("Import Claude Code transcripts into the local Retrace store")
    .option("--watch", "keep watching for new/changed transcripts")
    .option("--projects-dir <dir>", "override the Claude Code projects directory to scan")
    .action(async (opts: ImportCommandOptions) => {
      const store = createStore();
      const importOptions: ImportOptions = {
        projectsDir: opts.projectsDir,
        log: (message) => console.log(message),
      };

      if (opts.watch) {
        const { watchImport, defaultProjectsDir } = await lazy.import();
        console.log(
          `Watching ${importOptions.projectsDir ?? defaultProjectsDir()} for changes... (Ctrl+C to stop)`,
        );
        const handle = (deps.watchImport ?? watchImport)(store, importOptions);
        const stop = () => {
          handle.stop();
          store.close();
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
        // Intentionally does not await/return a pending promise: the watcher's
        // own fs.watch/timer handle keeps the event loop (and process) alive
        // until `stop` runs, exactly like a real long-running watch command.
        return;
      }

      const importOnce = deps.importOnce ?? (await lazy.import()).importOnce;
      try {
        const summary = importOnce(store, importOptions);
        console.log(
          `Scanned ${summary.filesScanned} file(s), imported ${summary.eventsImported} event(s) from ${summary.filesChanged} changed file(s).`,
        );
      } finally {
        store.close();
      }
    });

  program
    .command("list")
    .description("List recorded sessions, most recently started first")
    .action(async () => {
      const { formatSessionsTable } = await lazy.list();
      const store = createStore();
      try {
        console.log(formatSessionsTable(store.listSessions()));
      } finally {
        store.close();
      }
    });

  program
    .command("init")
    .description("Install Retrace hooks into Claude Code settings")
    .option(
      "--global",
      "write to user settings (~/.claude/settings.json) instead of the project",
    )
    .action(async (opts: InitCommandOptions) => {
      const { initHooks, resolveSettingsPath } = await lazy.init();
      const settingsPath = resolveSettingsPath({ global: opts.global });
      const result = (deps.initHooks ?? initHooks)({ settingsPath });
      if (!result.changed) {
        console.log(`Retrace hooks already present in ${result.settingsPath}`);
        return;
      }
      console.log(`${result.created ? "Created" : "Updated"} ${result.settingsPath}`);
      if (result.backupPath) console.log(`Backed up previous settings to ${result.backupPath}`);
      console.log("Retrace will now capture file snapshots and session boundaries.");
    });

  program
    .command("hook")
    .description("Handle a Claude Code hook event from stdin (invoked by installed hooks)")
    .action(async () => {
      const runHook = deps.runHook ?? (await lazy.hook()).runHook;
      await runHook(createStore);
    });

  program
    .command("ui")
    .description("Serve the Retrace session viewer")
    .option("--port <port>", "port to listen on (default: an OS-assigned free port)")
    .option("--no-open", "don't launch the system browser")
    .action(async (opts: UiCommandOptions) => {
      const startUi = deps.startUi ?? (await lazy.ui()).startUi;
      const store = createStore();
      const port = opts.port !== undefined ? Number(opts.port) : undefined;
      const handle = await startUi(store, {
        port,
        openBrowser: opts.open,
        viewerDir: deps.viewerDir,
      });
      const stop = async () => {
        await handle.stop();
        store.close();
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      // As with `import --watch`, the server's own listening socket keeps the
      // process alive until `stop` runs — nothing to await here.
    });

  program
    .command("export <sessionId>")
    .description("Export a session as JSON or a self-contained HTML file (default: HTML)")
    .option("--json", "export as a plain JSON file instead of HTML")
    .option("--output <path>", "output file path (default: <sessionId>.json or .html)")
    .action(async (sessionId: string, opts: ExportCommandOptions) => {
      const exportSession = deps.exportSession ?? (await lazy.export()).exportSession;
      const store = createStore();
      try {
        const result = exportSession(store, sessionId, {
          format: opts.json ? "json" : "html",
          output: opts.output,
          viewerExportDir: deps.viewerExportDir,
        });
        console.log(`Exported ${result.eventCount} event(s) to ${result.path}`);
      } finally {
        store.close();
      }
    });

  program
    .command("reimport [sessionId]")
    .description(
      "Delete a session's stored data and re-import it from its source transcript " +
        "(use after fixing a parser bug that already wrote bad data)",
    )
    .option("--all", "reimport every session that has a known source transcript")
    .action(async (sessionId: string | undefined, opts: ReimportCommandOptions) => {
      const mod = await lazy.reimport();
      const reimportSession = deps.reimportSession ?? mod.reimportSession;
      const reimportAll = deps.reimportAll ?? mod.reimportAll;
      const store = createStore();
      const log = (message: string) => console.log(message);
      try {
        if (opts.all) {
          const { results, skipped, failed } = reimportAll(store, log);
          for (const r of results) {
            console.log(
              `${r.sessionId}: re-imported ${r.eventsImported} event(s) from ${r.importPaths.length} file(s)`,
            );
          }
          if (failed.length > 0) {
            for (const f of failed) console.error(`${f.sessionId}: FAILED — ${f.error}`);
            process.exitCode = 1;
          }
          if (skipped.length > 0) {
            console.log(
              `Skipped ${skipped.length} session(s) with no known source transcript: ${skipped.join(", ")}`,
            );
          }
          return;
        }

        if (!sessionId) {
          console.error("Provide a sessionId, or use --all to reimport every session.");
          process.exitCode = 1;
          return;
        }

        const result = reimportSession(store, sessionId, log);
        if (result.importPaths.length === 0) {
          console.log(`${result.sessionId}: deleted (no known source transcript to re-import from)`);
        } else {
          console.log(
            `${result.sessionId}: re-imported ${result.eventsImported} event(s) from ${result.importPaths.length} file(s)`,
          );
        }
      } finally {
        store.close();
      }
    });

  program
    .command("verify [sessionId]")
    .description("Verify a session's tamper-evident hash chain")
    .option("--all", "verify every recorded session")
    .action(async (sessionId: string | undefined, opts: VerifyCommandOptions) => {
      const mod = await lazy.verify();
      const verifySession = deps.verifySession ?? mod.verifySession;
      const verifyAll = deps.verifyAll ?? mod.verifyAll;
      const store = createStore();
      try {
        if (opts.all) {
          const { results, failed } = verifyAll(store);
          for (const result of results) console.log(formatVerifyResult(result));
          if (failed.length > 0) process.exitCode = 1;
          return;
        }

        if (!sessionId) {
          console.error("Provide a sessionId, or use --all to verify every session.");
          process.exitCode = 1;
          return;
        }

        const result = verifySession(store, sessionId);
        console.log(formatVerifyResult(result));
        if (!result.verification.ok) process.exitCode = 1;
      } finally {
        store.close();
      }
    });

  return program;
}
