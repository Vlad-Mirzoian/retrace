import { existsSync } from "node:fs";
import type { RetraceStore } from "retrace-core";
import { importFile, type ImportLogger } from "./import.js";

export interface ReimportResult {
  sessionId: string;
  importPaths: string[];
  eventsImported: number;
}

/**
 * Delete a session's stored data and re-import it from its source
 * transcript(s) using the current parser — the fix for data that a
 * since-corrected parser bug already wrote to the store. Sessions with no
 * known source (recorded purely via live `retrace hook` calls, never
 * `import`ed) have nothing to rebuild from; they're simply deleted.
 *
 * Source transcripts are checked for existence *before* anything is deleted.
 * Claude Code itself prunes old transcripts, so a session's on-disk copy in
 * `~/.retrace` can outlive its source — deleting first and discovering the
 * source is gone only when the re-import fails would destroy the last
 * remaining copy of that session for good.
 */
export function reimportSession(
  store: RetraceStore,
  idOrPrefix: string,
  log?: ImportLogger,
): ReimportResult {
  const sessionId = store.resolveSessionId(idOrPrefix);
  const importPaths = store.getImportPathsForSession(sessionId);

  const missing = importPaths.filter((path) => !existsSync(path));
  if (missing.length > 0) {
    throw new Error(
      `refusing to reimport ${sessionId}: source transcript(s) no longer on disk: ${missing.join(", ")}`,
    );
  }

  store.deleteSession(sessionId);

  let eventsImported = 0;
  for (const path of importPaths) {
    const result = importFile(store, path, log);
    eventsImported += result.imported;
  }
  return { sessionId, importPaths, eventsImported };
}

export interface ReimportAllSummary {
  results: ReimportResult[];
  /** Sessions that exist but have no known source transcript — left untouched, since deleting them would be permanent. */
  skipped: string[];
  /** Sessions whose reimport was attempted and failed (e.g. a missing source transcript) — also left untouched. */
  failed: { sessionId: string; error: string }[];
}

/**
 * Re-import every session that has a known source transcript. Sessions
 * recorded purely via live hooks (no `import_state` entry) are left alone.
 * A failure on one session (e.g. its source transcript vanished since it was
 * first imported) is recorded in `failed` and does not stop the rest of the
 * batch from being processed.
 */
export function reimportAll(store: RetraceStore, log?: ImportLogger): ReimportAllSummary {
  const importableIds = store.listImportedSessionIds();
  const allIds = store.listSessions().map((s) => s.id);
  const importable = new Set(importableIds);

  const results: ReimportResult[] = [];
  const failed: { sessionId: string; error: string }[] = [];
  for (const id of importableIds) {
    try {
      results.push(reimportSession(store, id, log));
    } catch (err) {
      failed.push({ sessionId: id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const skipped = allIds.filter((id) => !importable.has(id));
  return { results, skipped, failed };
}
