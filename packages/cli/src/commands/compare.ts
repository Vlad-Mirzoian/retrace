import type { RetraceStore } from "retrace-core";
import open from "open";
import { startUi, type UiHandle } from "./ui.js";

export interface CompareOptions {
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
 * Start the viewer server and open it directly at the two-run comparison
 * view for `idAOrPrefix`/`idBOrPrefix` — resolved to full ids first, so a
 * unique prefix works the same as `export`/`verify`/`reimport`. Reuses
 * startUi's server; only the URL it opens differs.
 */
export function startCompare(
  store: RetraceStore,
  idAOrPrefix: string,
  idBOrPrefix: string,
  options: CompareOptions = {},
): Promise<UiHandle> {
  const idA = store.resolveSessionId(idAOrPrefix);
  const idB = store.resolveSessionId(idBOrPrefix);
  const baseLaunch = options.launch ?? ((url: string) => void open(url));

  return startUi(store, {
    port: options.port,
    openBrowser: options.openBrowser,
    log: options.log,
    viewerDir: options.viewerDir,
    launch: (url) => baseLaunch(`${url}/compare?a=${encodeURIComponent(idA)}&b=${encodeURIComponent(idB)}`),
  });
}
