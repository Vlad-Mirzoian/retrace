import type { EventsTruncation, RetraceEvent, RetraceStore } from "retrace-core";

export interface CollectedEvents {
  /** Every event recovered across all pages — a strict prefix when `truncatedAt` is set. */
  events: RetraceEvent[];
  /** Set when a page reported a read failure — pagination stops there rather than requesting more. */
  truncatedAt?: EventsTruncation;
}

/**
 * Page through the store until the whole session's events are collected (or
 * a page reports it couldn't read further — see `RetraceStore.readEvents`).
 * Shared by check, export, link, and verify — anywhere that needs a
 * session's full ordered event stream rather than one page.
 */
export function collectAllEvents(
  store: RetraceStore,
  sessionId: string,
  pageSize = 500,
): CollectedEvents {
  const all: RetraceEvent[] = [];
  for (;;) {
    const page = store.readEvents(sessionId, all.length, pageSize);
    all.push(...page.events);
    if (page.truncatedAt) return { events: all, truncatedAt: page.truncatedAt };
    if (page.events.length < pageSize) return { events: all };
  }
}
