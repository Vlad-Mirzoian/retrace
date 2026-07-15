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
import { CLI_VERSION } from "./version.js";

export interface ProgramDeps {
  createStore?: () => RetraceStore;
  importOnce?: (store: RetraceStore, options?: ImportOptions) => ImportSummary;
  watchImport?: (store: RetraceStore, options?: WatchImportOptions) => WatchHandle;
}

interface ImportCommandOptions {
  watch?: boolean;
  projectsDir?: string;
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

  return program;
}
