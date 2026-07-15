import type { RetraceStore } from "@retrace/core";
import { Hono } from "hono";

function parsePositiveInt(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return null;
  return Number(value);
}

/**
 * Build the Retrace HTTP API over a store. Framework-agnostic in the sense
 * that it never touches the network itself — `retrace ui` (server/serve.ts)
 * is what binds this to a port; tests can exercise it directly via
 * `app.request(...)` with no listening socket at all.
 */
export function createApp(store: RetraceStore): Hono {
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

    return c.json(store.readEvents(id, offset, limit));
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

  return app;
}
