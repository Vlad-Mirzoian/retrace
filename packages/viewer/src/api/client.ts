import type { RetraceEvent, SessionRow } from "retrace-core/browser";
// `ChainVerification` isn't re-exported from `retrace-core/browser`: chain.ts
// (where it's defined) imports node:crypto as a *value* import for
// verifyChain, so browser.ts deliberately excludes it. An `import type` is
// erased entirely at build time, so pulling just the type from the main
// entry never reaches the bundle — safe even though the value-level module
// isn't browser-safe.
import type { ChainVerification } from "retrace-core";

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

/**
 * Objects shipped inside an export bundle rather than served by an API. Lets
 * the same cards render in a standalone HTML file, where there is no server
 * to fetch from.
 */
const embeddedObjects = new Map<string, string>();

export function registerEmbeddedObjects(objects: Record<string, string>): void {
  for (const [hash, text] of Object.entries(objects)) embeddedObjects.set(hash, text);
}

/** Fetch a content-addressed object (a file snapshot) as text. */
export async function getObjectText(hash: string): Promise<string> {
  const embedded = embeddedObjects.get(hash);
  if (embedded !== undefined) return embedded;

  const path = `/api/objects/${encodeURIComponent(hash)}`;
  const res = await fetch(path);
  if (!res.ok) throw new ApiError(res.status, `object ${hash.slice(0, 8)} not found`);
  return res.text();
}

/**
 * The verification verdict embedded in an export bundle, if any — mirrors
 * `embeddedObjects`'s role for `getObjectText`, so a standalone export shows
 * the same integrity badge without a server to ask.
 */
let embeddedVerification: ChainVerification | undefined;

export function registerEmbeddedVerification(verification: ChainVerification): void {
  embeddedVerification = verification;
}

/** Fetch (or read the bundle-embedded) tamper-evidence verdict for a session. */
export function getVerification(id: string): Promise<ChainVerification> {
  if (embeddedVerification) return Promise.resolve(embeddedVerification);
  return getJson(`/api/sessions/${encodeURIComponent(id)}/verify`);
}
