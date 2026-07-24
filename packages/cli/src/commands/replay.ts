import type { RetraceStore } from "retrace-core";
import open from "open";
import { startUi, type UiHandle } from "./ui.js";

export interface ReplayOptions {
  /** Port to listen on. Defaults to an OS-assigned free port (0). */
  port?: number;
  /** Whether to launch the system browser once the server is listening. */
  openBrowser?: boolean;
  /** Injectable for tests, so no real browser window is launched. */
  launch?: (url: string) => void;
  log?: (message: string) => void;
  /** Absolute path to the embedded viewer build; see server/app.ts. */
  viewerDir?: string;
}

/**
 * Start the viewer server and open it directly at a session's replay view
 * (/sessions/:id) — resolved to a full id first, so a unique prefix works
 * the same as export/verify/reimport/compare. Reuses startUi's server; only
 * the URL it opens differs.
 */
export function startReplay(
  store: RetraceStore,
  idOrPrefix: string,
  options: ReplayOptions = {},
): Promise<UiHandle> {
  const sessionId = store.resolveSessionId(idOrPrefix);
  const baseLaunch = options.launch ?? ((url: string) => void open(url));

  return startUi(store, {
    port: options.port,
    openBrowser: options.openBrowser,
    log: options.log,
    viewerDir: options.viewerDir,
    launch: (url) => baseLaunch(`${url}/sessions/${encodeURIComponent(sessionId)}`),
  });
}
