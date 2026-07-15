import { Command } from "commander";
import { RetraceStore } from "@retrace/core";
import {
  defaultProjectsDir,
  importOnce as realImportOnce,
  watchImport as realWatchImport,
  type ImportOptions,
  type ImportSummary,
  type WatchHandle,
  type WatchImportOptions,
} from "./commands/import.js";
import { formatSessionsTable } from "./commands/list.js";
import {
  initHooks as realInitHooks,
  resolveSettingsPath,
  type InitOptions,
  type InitResult,
} from "./commands/init.js";
import { runHook as realRunHook } from "./commands/hook.js";
import { startUi as realStartUi, type UiHandle, type UiOptions } from "./commands/ui.js";
import { CLI_VERSION } from "./version.js";

export interface ProgramDeps {
  createStore?: () => RetraceStore;
  importOnce?: (store: RetraceStore, options?: ImportOptions) => ImportSummary;
  watchImport?: (store: RetraceStore, options?: WatchImportOptions) => WatchHandle;
  initHooks?: (options: InitOptions) => InitResult;
  runHook?: (createStore: () => RetraceStore) => Promise<void>;
  startUi?: (store: RetraceStore, options?: UiOptions) => Promise<UiHandle>;
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
}

/**
 * Build the `retrace` commander program. Dependencies (store construction,
 * import functions) are injectable so command wiring can be tested without
 * touching the real `~/.retrace` store or `~/.claude/projects`.
 */
export function createProgram(deps: ProgramDeps = {}): Command {
  const createStore = deps.createStore ?? (() => new RetraceStore());
  const doImportOnce = deps.importOnce ?? realImportOnce;
  const doWatchImport = deps.watchImport ?? realWatchImport;
  const doInitHooks = deps.initHooks ?? realInitHooks;
  const doRunHook = deps.runHook ?? realRunHook;
  const doStartUi = deps.startUi ?? realStartUi;

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
    .action((opts: ImportCommandOptions) => {
      const store = createStore();
      const importOptions: ImportOptions = {
        projectsDir: opts.projectsDir,
        log: (message) => console.log(message),
      };

      if (opts.watch) {
        console.log(
          `Watching ${importOptions.projectsDir ?? defaultProjectsDir()} for changes... (Ctrl+C to stop)`,
        );
        const handle = doWatchImport(store, importOptions);
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

      try {
        const summary = doImportOnce(store, importOptions);
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
    .action(() => {
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
    .action((opts: InitCommandOptions) => {
      const settingsPath = resolveSettingsPath({ global: opts.global });
      const result = doInitHooks({ settingsPath });
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
      await doRunHook(createStore);
    });

  program
    .command("ui")
    .description("Serve the Retrace session viewer")
    .option("--port <port>", "port to listen on (default: an OS-assigned free port)")
    .action(async (opts: UiCommandOptions) => {
      const store = createStore();
      const port = opts.port !== undefined ? Number(opts.port) : undefined;
      const handle = await doStartUi(store, { port });
      const stop = async () => {
        await handle.stop();
        store.close();
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      // As with `import --watch`, the server's own listening socket keeps the
      // process alive until `stop` runs — nothing to await here.
    });

  return program;
}
