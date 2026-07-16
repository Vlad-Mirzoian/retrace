import type { RetraceEvent, SessionRow } from "retrace-core/browser";

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

/**
 * Page through the events API until the whole session is loaded — a session
 * runs to hundreds of events and the timeline shows all of them.
 */
export async function getAllEvents(id: string, pageSize = 500): Promise<RetraceEvent[]> {
  const all: RetraceEvent[] = [];
  for (;;) {
    const page = await getEvents(id, { offset: all.length, limit: pageSize });
    all.push(...page);
    if (page.length < pageSize) return all;
  }
}

/** Fetch a content-addressed object (a file snapshot) as text. */
export async function getObjectText(hash: string): Promise<string> {
  const path = `/api/objects/${encodeURIComponent(hash)}`;
  const res = await fetch(path);
  if (!res.ok) throw new ApiError(res.status, `object ${hash.slice(0, 8)} not found`);
  return res.text();
}
