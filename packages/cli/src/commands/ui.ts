import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import type { RetraceStore } from "retrace-core";
import open from "open";
import { createApp } from "../server/app.js";

export interface UiOptions {
  /** Port to listen on. Defaults to an OS-assigned free port (0). */
  port?: number;
  /** Whether to launch the system browser once the server is listening. */
  openBrowser?: boolean;
  /** Injectable for tests, so no real browser window is launched. */
  launch?: (url: string) => void;
  log?: (message: string) => void;
  /** Absolute path to the embedded viewer build; see server/app.ts. */
  viewerDir?: string;
  /**
   * Run a one-shot import from the default Claude Code projects directory
   * before serving, when the store has no sessions yet. Default `true` —
   * an empty session list on a fresh install reads as "this tool doesn't
   * work", not "I should run import first". Suppress with `--no-import`.
   */
  autoImport?: boolean;
}

export interface UiHandle {
  url: string;
  port: number;
  stop(): Promise<void>;
}

/**
 * `commands/import.js` is only ever loaded here, dynamically, and only when
 * actually needed (store empty and auto-import not suppressed) — not because
 * `ui.ts` itself sits on `retrace hook`'s hot path (it doesn't; `program.ts`
 * already lazy-loads `ui.ts` as a whole), but so that running `ui` against a
 * store that already has sessions — the common case — never pays for
 * `import.js`'s module graph at all.
 */
async function maybeAutoImport(
  store: RetraceStore,
  log: (message: string) => void,
  autoImport: boolean,
): Promise<void> {
  if (!autoImport) return;
  if (store.listSessions().length > 0) return;

  const { importOnce, defaultProjectsDir } = await import("./import.js");
  const projectsDir = defaultProjectsDir();

  if (!existsSync(projectsDir)) {
    log(
      `No sessions recorded yet, and ~/.claude/projects (${projectsDir}) was not found — nothing to ` +
        `import. Starting with an empty session list.`,
    );
    return;
  }

  log("No sessions recorded yet — importing from ~/.claude/projects…");
  const summary = importOnce(store, { log });
  log(`Imported ${summary.eventsImported} event(s) from ${summary.filesChanged} session(s).`);
}

/** Start the Retrace viewer's HTTP server, resolving once it is listening. */
export async function startUi(store: RetraceStore, options: UiOptions = {}): Promise<UiHandle> {
  const log = options.log ?? ((message: string) => console.log(message));
  await maybeAutoImport(store, log, options.autoImport ?? true);

  const app = createApp(store, { viewerDir: options.viewerDir });
  const launch = options.launch ?? ((url: string) => void open(url));

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: options.port ?? 0 }, (info) => {
      const url = `http://localhost:${info.port}`;
      log(`Retrace viewer listening at ${url}`);
      if (options.openBrowser ?? true) launch(url);

      resolve({
        url,
        port: info.port,
        stop: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}
