import { mkdtemp, rm } from "node:fs/promises";
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
