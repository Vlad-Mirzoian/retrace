import type { RetraceEvent, SessionRow } from "@retrace/core/browser";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? `request to ${path} failed with ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function listSessions(): Promise<SessionRow[]> {
  return getJson("/api/sessions");
}

export function getSession(id: string): Promise<SessionRow> {
  return getJson(`/api/sessions/${encodeURIComponent(id)}`);
}

export interface GetEventsOptions {
  offset?: number;
  limit?: number;
}

export function getEvents(id: string, options: GetEventsOptions = {}): Promise<RetraceEvent[]> {
  const params = new URLSearchParams();
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  const qs = params.toString();
  return getJson(`/api/sessions/${encodeURIComponent(id)}/events${qs ? `?${qs}` : ""}`);
}
