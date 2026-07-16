import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RetraceStore } from "@retrace/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

let home: string;
let store: RetraceStore;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "retrace-app-"));
  store = new RetraceStore(home);
});

afterEach(async () => {
  store.close();
  await rm(home, { recursive: true, force: true });
});

describe("GET /api/sessions", () => {
  it("returns an empty array when there are no sessions", async () => {
    const app = createApp(store);
    const res = await app.request("/api/sessions");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("lists known sessions", async () => {
    store.appendEvent({
      ts: "2026-07-15T14:37:00.000Z",
      sessionId: "sess-1",
      kind: "user_prompt",
      payload: { text: "hi" },
    });
    store.ensureSession({ id: "sess-1", project: "demo" });

    const app = createApp(store);
    const res = await app.request("/api/sessions");
    const body = (await res.json()) as { id: string; project: string | null }[];
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("sess-1");
    expect(body[0].project).toBe("demo");
  });
});

describe("GET /api/sessions/:id", () => {
  it("404s for an unknown session", async () => {
    const app = createApp(store);
    const res = await app.request("/api/sessions/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "session not found" });
  });

  it("returns the session's metadata", async () => {
    store.ensureSession({ id: "sess-1", title: "Fix the bug" });
    const app = createApp(store);
    const res = await app.request("/api/sessions/sess-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string };
    expect(body.title).toBe("Fix the bug");
  });
});

describe("GET /api/sessions/:id/events", () => {
  function seed() {
    for (const text of ["one", "two", "three"]) {
      store.appendEvent({
        ts: "2026-07-15T14:37:00.000Z",
        sessionId: "sess-1",
        kind: "user_prompt",
        payload: { text },
      });
    }
  }

  it("404s for an unknown session", async () => {
    const app = createApp(store);
    const res = await app.request("/api/sessions/nope/events");
    expect(res.status).toBe(404);
  });

  it("returns events with default pagination", async () => {
    seed();
    const app = createApp(store);
    const res = await app.request("/api/sessions/sess-1/events");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { seq: number }[];
    expect(body.map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it("respects offset and limit", async () => {
    seed();
    const app = createApp(store);
    const res = await app.request("/api/sessions/sess-1/events?offset=1&limit=1");
    const body = (await res.json()) as { seq: number }[];
    expect(body.map((e) => e.seq)).toEqual([1]);
  });

  it("400s on a non-numeric offset/limit", async () => {
    seed();
    const app = createApp(store);
    const res = await app.request("/api/sessions/sess-1/events?offset=abc");
    expect(res.status).toBe(400);
  });

  it("400s on a zero limit", async () => {
    seed();
    const app = createApp(store);
    const res = await app.request("/api/sessions/sess-1/events?limit=0");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/objects/:hash", () => {
  it("404s for a missing object", async () => {
    const app = createApp(store);
    const res = await app.request(`/api/objects/${"0".repeat(64)}`);
    expect(res.status).toBe(404);
  });

  it("serves stored bytes with an octet-stream content type", async () => {
    const hash = await store.objects.put("hello from CAS");
    const app = createApp(store);
    const res = await app.request(`/api/objects/${hash}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(await res.text()).toBe("hello from CAS");
  });
});

describe("embedded viewer static serving", () => {
  let viewerDir: string;

  beforeEach(async () => {
    viewerDir = await mkdtemp(join(tmpdir(), "retrace-viewer-dist-"));
    await writeFile(join(viewerDir, "index.html"), "<html>SPA SHELL</html>", "utf8");
    await mkdir(join(viewerDir, "assets"), { recursive: true });
    await writeFile(join(viewerDir, "assets", "app.js"), "console.log('hi')", "utf8");
  });

  afterEach(async () => {
    await rm(viewerDir, { recursive: true, force: true });
  });

  it("is disabled when no viewerDir is given (existing API-only behavior)", async () => {
    const app = createApp(store);
    const res = await app.request("/");
    expect(res.status).toBe(404);
  });

  it("is disabled when viewerDir doesn't exist on disk", async () => {
    const app = createApp(store, { viewerDir: join(viewerDir, "does-not-exist") });
    const res = await app.request("/");
    expect(res.status).toBe(404);
  });

  it("serves index.html at the root", async () => {
    const app = createApp(store, { viewerDir });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>SPA SHELL</html>");
  });

  it("serves a real static asset by path", async () => {
    const app = createApp(store, { viewerDir });
    const res = await app.request("/assets/app.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("console.log('hi')");
  });

  it("falls back to index.html for a client-side route (SPA deep link)", async () => {
    const app = createApp(store, { viewerDir });
    const res = await app.request("/sessions/some-session-id");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>SPA SHELL</html>");
  });

  it("still 404s an unmatched /api/* path instead of falling back to the SPA shell", async () => {
    const app = createApp(store, { viewerDir });
    const res = await app.request("/api/totally-not-a-real-route");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("SPA SHELL");
  });

  it("still serves real /api/* routes correctly alongside static serving", async () => {
    store.ensureSession({ id: "sess-1", title: "Still works" });
    const app = createApp(store, { viewerDir });
    const res = await app.request("/api/sessions/sess-1");
    expect(res.status).toBe(200);
    expect((await res.json()) as { title: string }).toMatchObject({ title: "Still works" });
  });
});
