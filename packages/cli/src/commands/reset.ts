import type { RetraceStore } from "retrace-core";

export interface ResetResult {
  homeDir: string;
  sessionCount: number;
}

/**
 * Wipe the entire store: every session, every CAS object, the SQLite index
 * — the whole of {@link RetraceStore.homeDir}. Unlike `retrace delete`, this
 * also reclaims CAS storage, since nothing is left to reference it.
 */
export function resetStore(store: RetraceStore): ResetResult {
  const sessionCount = store.listSessions().length;
  const homeDir = store.homeDir;
  store.reset();
  return { homeDir, sessionCount };
}
