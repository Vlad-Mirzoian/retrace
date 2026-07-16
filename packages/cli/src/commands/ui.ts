import { serve } from "@hono/node-server";
import type { RetraceStore } from "@retrace/core";
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
}

export interface UiHandle {
  url: string;
  port: number;
  stop(): Promise<void>;
}

/** Start the Retrace viewer's HTTP server, resolving once it is listening. */
export function startUi(store: RetraceStore, options: UiOptions = {}): Promise<UiHandle> {
  const app = createApp(store, { viewerDir: options.viewerDir });
  const log = options.log ?? ((message: string) => console.log(message));
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
