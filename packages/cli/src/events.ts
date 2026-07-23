import type { RetraceEvent, RetraceStore } from "retrace-core";

/**
 * Page through the store until the whole session's events are collected.
 * Shared by export, the HTTP verify route, and the verify command — anywhere
 * that needs a session's full ordered event stream rather than one page.
 */
export function collectAllEvents(
  store: RetraceStore,
  sessionId: string,
  pageSize = 500,
): RetraceEvent[] {
  const all: RetraceEvent[] = [];
  for (;;) {
    const page = store.readEvents(sessionId, all.length, pageSize);
    all.push(...page);
    if (page.length < pageSize) return all;
  }
}
