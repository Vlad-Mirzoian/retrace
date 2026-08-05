import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { runChecks, type RetraceStore } from "retrace-core";
import { Hono } from "hono";
import { verifySession } from "../commands/verify.js";
import { collectAllEvents } from "../events.js";

/** A readable message for a route whose data read genuinely failed (e.g. a corrupted events.jsonl), instead of an opaque 500 with no body. */
function readFailureMessage(err: unknown): string {
  return `events.jsonl could not be read: ${err instanceof Error ? err.message : String(err)}`;
}

function parsePositiveInt(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return null;
  return Number(value);
}

export interface CreateAppOptions {
  /**
   * Absolute path to the built viewer SPA (index.html + assets), embedded
   * into the CLI package's own dist at build time (see
   * scripts/copy-viewer-dist.mjs). Omitted in tests and in dev, where the
   * viewer is served separately by its own Vite dev server.
   */
  viewerDir?: string;
}

/**
 * Build the Retrace HTTP API over a store. Framework-agnostic in the sense
 * that it never touches the network itself — `retrace ui` (commands/ui.ts) is
 * what binds this to a port; tests can exercise it directly via
 * `app.request(...)` with no listening socket at all.
 */
export function createApp(store: RetraceStore, options: CreateAppOptions = {}): Hono {
  const app = new Hono();

  app.get("/api/sessions", (c) => c.json(store.listSessions()));

  app.get("/api/sessions/:id", (c) => {
    const session = store.getSession(c.req.param("id"));
    if (!session) return c.json({ error: "session not found" }, 404);
    return c.json(session);
  });

  app.get("/api/sessions/:id/events", (c) => {
    const id = c.req.param("id");
    if (!store.getSession(id)) return c.json({ error: "session not found" }, 404);

    const offset = parsePositiveInt(c.req.query("offset"), 0);
    const limit = parsePositiveInt(c.req.query("limit"), 100);
    if (offset === null || limit === null || limit === 0) {
      return c.json({ error: "offset and limit must be non-negative integers" }, 400);
    }

    try {
      // `readEvents` already reports a corrupted row as `truncatedAt` rather
      // than throwing — the client gets a normal 200 with whatever prefix
      // was recoverable, plus enough to explain why the session stops there.
      return c.json(store.readEvents(id, offset, limit));
    } catch (err) {
      // Only a harder failure reaches here — e.g. events.jsonl is missing
      // entirely, not just desynced.
      return c.json({ error: readFailureMessage(err) }, 500);
    }
  });

  app.get("/api/objects/:hash", async (c) => {
    try {
      const data = await store.objects.get(c.req.param("hash"));
      // Buffer's `.buffer` is typed as ArrayBufferLike (could be a
      // SharedArrayBuffer), which Hono's stricter Uint8Array<ArrayBuffer>
      // param rejects; copy into a plain Uint8Array to satisfy it.
      return c.body(Uint8Array.from(data), 200, { "Content-Type": "application/octet-stream" });
    } catch {
      return c.json({ error: "object not found" }, 404);
    }
  });

  app.get("/api/sessions/:id/verify", (c) => {
    const id = c.req.param("id");
    if (!store.getSession(id)) return c.json({ error: "session not found" }, 404);
    // verifySession (the same function `retrace verify` uses) already treats
    // an unreadable events.jsonl as tamper evidence in its own right, rather
    // than letting the read failure escape as an uncaught exception here.
    return c.json(verifySession(store, id).verification);
  });

  app.get("/api/sessions/:id/check", (c) => {
    const id = c.req.param("id");
    if (!store.getSession(id)) return c.json({ error: "session not found" }, 404);

    const disableParam = c.req.query("disable");
    const disabled = disableParam
      ? disableParam
          .split(",")
          .map((ruleId) => ruleId.trim())
          .filter(Boolean)
      : undefined;

    try {
      const { events, truncatedAt } = collectAllEvents(store, id);
      return c.json({ ...runChecks(id, events, disabled ? { disabled } : undefined), truncatedAt });
    } catch (err) {
      return c.json({ error: readFailureMessage(err) }, 500);
    }
  });

  if (options.viewerDir && existsSync(options.viewerDir)) {
    const viewerDir = options.viewerDir;
    app.get(
      "*",
      // /api/* paths are handled by the routes above; anything that reaches
      // here unmatched is a bad API path, not a client-side route — 404 it
      // rather than falling through to the SPA shell below.
      async (c, next) => {
        if (c.req.path.startsWith("/api/")) return c.notFound();
        return next();
      },
      serveStatic({ root: viewerDir }),
      // Anything left over is a client-side route (e.g. /sessions/:id loaded
      // directly): serve the SPA shell and let React Router take over.
      async (c) => c.html(await readFile(join(viewerDir, "index.html"), "utf8")),
    );
  }

  return app;
}
