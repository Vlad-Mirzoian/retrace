import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  watch as fsWatch,
  type FSWatcher,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  parseTranscriptLines,
  splitTranscriptLines,
  RetraceStore,
} from "retrace-core";

export type ImportLogger = (message: string) => void;

export interface ImportOptions {
  /** Directory to scan for Claude Code transcripts. Defaults to `~/.claude/projects`. */
  projectsDir?: string;
  log?: ImportLogger;
}

export interface ImportFileResult {
  path: string;
  sessionId: string;
  /** Number of new events appended by this pass (0 if unchanged). */
  imported: number;
  skipped: boolean;
}

export interface ImportSummary {
  filesScanned: number;
  filesChanged: number;
  eventsImported: number;
  results: ImportFileResult[];
}

export function defaultProjectsDir(): string {
  return join(homedir(), ".claude", "projects");
}

/** Recursively find every `*.jsonl` transcript file under `dir`. */
export function findTranscripts(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      const parent = entry.parentPath ?? dir;
      out.push(join(parent, entry.name));
    }
  }
  return out;
}

/**
 * Import (or incrementally re-import) a single transcript file. Uses the
 * store's `import_state` table to skip unchanged files and to resume from
 * the last imported line, so re-running this on a growing transcript only
 * parses and appends the newly written lines.
 */
export function importFile(
  store: RetraceStore,
  filePath: string,
  log?: ImportLogger,
): ImportFileResult {
  const sessionId = basename(filePath, ".jsonl");
  const project = basename(dirname(filePath));
  const stat = statSync(filePath);
  const prev = store.getImportState(filePath);

  if (prev && prev.size === stat.size && prev.mtimeMs === stat.mtimeMs) {
    return { path: filePath, sessionId, imported: 0, skipped: true };
  }

  const text = readFileSync(filePath, "utf8");
  const lines = splitTranscriptLines(text);
  const startLine = prev && prev.sessionId === sessionId ? Math.min(prev.lastLine, lines.length) : 0;
  const newLines = lines.slice(startLine);

  if (newLines.length === 0) {
    store.setImportState(filePath, {
      sessionId,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      lastLine: lines.length,
    });
    return { path: filePath, sessionId, imported: 0, skipped: true };
  }

  const fallbackTs = store.getSession(sessionId)?.endedAt ?? undefined;
  const parsed = parseTranscriptLines(newLines, sessionId, fallbackTs);

  store.ensureSession({ ...parsed.session, id: sessionId, project });
  for (const draft of parsed.events) store.appendEvent(draft);

  const rawPath = store.rawPath(sessionId);
  mkdirSync(dirname(rawPath), { recursive: true });
  appendFileSync(rawPath, newLines.map((line) => `${line}\n`).join(""), "utf8");

  store.setImportState(filePath, {
    sessionId,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    lastLine: lines.length,
  });

  log?.(
    `${sessionId}: imported ${parsed.events.length} event(s) from ${newLines.length} new line(s)`,
  );
  return { path: filePath, sessionId, imported: parsed.events.length, skipped: false };
}

/** Scan the projects directory once and import every changed transcript. */
export function importOnce(store: RetraceStore, options: ImportOptions = {}): ImportSummary {
  const dir = options.projectsDir ?? defaultProjectsDir();
  const files = findTranscripts(dir);
  const results = files.map((file) => importFile(store, file, options.log));

  return {
    filesScanned: files.length,
    filesChanged: results.filter((r) => !r.skipped).length,
    eventsImported: results.reduce((sum, r) => sum + r.imported, 0),
    results,
  };
}

export interface WatchHandle {
  stop(): void;
}

export interface WatchImportOptions extends ImportOptions {
  /** Quiet time after the last filesystem event before re-scanning. */
  debounceMs?: number;
  /** Polling interval used as a fallback where recursive fs.watch is unsupported. */
  pollIntervalMs?: number;
}

/**
 * Run an initial import pass, then keep importing as transcripts change.
 * Prefers a recursive `fs.watch` (debounced); falls back to polling on
 * platforms where Node's `recursive` watch option isn't supported (e.g. Linux).
 */
export function watchImport(store: RetraceStore, options: WatchImportOptions = {}): WatchHandle {
  const dir = options.projectsDir ?? defaultProjectsDir();
  const debounceMs = options.debounceMs ?? 300;
  const pollIntervalMs = options.pollIntervalMs ?? 2000;

  let debounceTimer: NodeJS.Timeout | null = null;
  const scheduleImport = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      try {
        importOnce(store, options);
      } catch (err) {
        options.log?.(`watch import error: ${(err as Error).message}`);
      }
    }, debounceMs);
  };

  // Catch pre-existing sessions immediately, before the first filesystem event.
  importOnce(store, options);

  let watcher: FSWatcher | null = null;
  let pollTimer: NodeJS.Timeout | null = null;

  mkdirSync(dir, { recursive: true });
  try {
    watcher = fsWatch(dir, { recursive: true }, () => scheduleImport());
  } catch {
    // `recursive` isn't supported on this platform (e.g. Linux) — poll instead.
    pollTimer = setInterval(() => importOnce(store, options), pollIntervalMs);
  }

  return {
    stop() {
      if (debounceTimer) clearTimeout(debounceTimer);
      watcher?.close();
      if (pollTimer) clearInterval(pollTimer);
    },
  };
}
