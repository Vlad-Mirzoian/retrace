import type { SessionRow } from "retrace-core/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getEvents, getSession, listSessions } from "./client.js";

const session: SessionRow = {
  id: "sess-1",
  project: "demo",
  cwd: "/repo",
  gitBranch: "main",
  ccVersion: "2.1.181",
  permissionMode: "default",
  title: "Fix the bug",
  startedAt: "2026-07-15T14:37:00.000Z",
  endedAt: null,
  eventCount: 3,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listSessions", () => {
  it("fetches /api/sessions and returns the parsed array", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([session]));
    const result = await listSessions();
    expect(fetch).toHaveBeenCalledWith("/api/sessions");
    expect(result).toEqual([session]);
  });
});

describe("getSession", () => {
  it("URL-encodes the session id", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(session));
    await getSession("weird id/slash");
    expect(fetch).toHaveBeenCalledWith("/api/sessions/weird%20id%2Fslash");
  });

  it("throws an ApiError with the server's message on a non-OK response", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: "session not found" }, 404));
    await expect(getSession("nope")).rejects.toMatchObject({
      status: 404,
      message: "session not found",
    });
    await expect(getSession("nope")).rejects.toBeInstanceOf(ApiError);
  });

  it("falls back to a generic message when the error body isn't JSON", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("not json", { status: 500 }),
    );
    await expect(getSession("x")).rejects.toMatchObject({ status: 500 });
  });
});

describe("getEvents", () => {
  it("requests without query params by default", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([]));
    await getEvents("sess-1");
    expect(fetch).toHaveBeenCalledWith("/api/sessions/sess-1/events");
  });

  it("includes offset and limit when given", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([]));
    await getEvents("sess-1", { offset: 10, limit: 5 });
    expect(fetch).toHaveBeenCalledWith("/api/sessions/sess-1/events?offset=10&limit=5");
  });
});
