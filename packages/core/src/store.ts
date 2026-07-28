import type { DatabaseSync as DatabaseSyncType, StatementSync } from "node:sqlite";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ContentStore } from "./cas.js";
import { sealEvent } from "./chain.js";
import { deflatePayload, inflateEvent } from "./offload.js";
import {
  RETRACE_SCHEMA_VERSION,
  RetraceEvent,
  type RetraceEventDraft,
  type SessionInfo,
  type SessionRow,
} from "./schema.js";
import { summarize } from "./summarize.js";

// `node:sqlite` is new enough that some bundlers' builtin-module detection
// (e.g. vite-node, which vitest uses) doesn't yet recognize it and tries to
// resolve "sqlite" as an npm package. Fetching it via `getBuiltinModule`
// instead of a static `import` sidesteps module resolution entirely.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

/** Resolve the Retrace data directory: `$RETRACE_HOME` if set, else `~/.retrace`. */
export function retraceHome(): string {
  return process.env.RETRACE_HOME ?? join(homedir(), ".retrace");
}

export interface ImportState {
  sessionId: string;
  size: number;
  mtimeMs: number;
  lastLine: number;
}

export interface DeletedSessionInfo {
  /** Source transcript paths previously tied to this session via `import_state`, so the caller can re-import from them. */
  importPaths: string[];
}

/** node:sqlite rejects `undefined` bindings; normalize to `null`. */
function bind(value: string | number | null | undefined): string | number | null {
  return value === undefined ? null : value;
}

/**
 * node:sqlite's row type (`Record<string, SQLOutputValue>`) doesn't
 * structurally overlap with our concrete row shapes, so every read needs an
 * `unknown`-mediated cast. Centralized here rather than repeated per call site.
 */
function asRow<T>(row: unknown): T {
  return row as T;
}

/**
 * On-disk store for Retrace sessions: `events.jsonl` holds the sealed hash
 * chain (source of truth), SQLite holds a queryable index over it (byte
 * offsets into the JSONL, not a copy of the payloads), and CAS holds file
 * snapshots / offloaded large payloads.
 */
export class RetraceStore {
  readonly homeDir: string;
  private readonly db: DatabaseSyncType;
  private readonly cas: ContentStore;
  private readonly chainState = new Map<
    string,
    { seq: number; lastHash: string | null }
  >();

  private readonly insertEvent: StatementSync;
  private readonly upsertSession: StatementSync;
  private readonly touchSession: StatementSync;
  private readonly selectSession: StatementSync;
  private readonly selectSessions: StatementSync;
  private readonly selectChainState: StatementSync;
  private readonly selectEventPage: StatementSync;
  private readonly upsertImportState: StatementSync;
  private readonly selectImportState: StatementSync;
  private readonly deleteSessionRow: StatementSync;
  private readonly deleteSessionEvents: StatementSync;
  private readonly selectImportPathsBySession: StatementSync;
  private readonly deleteImportStateBySession: StatementSync;
  private readonly selectSessionIdsByPrefix: StatementSync;
  private readonly selectAllImportedSessionIds: StatementSync;

  constructor(homeDir: string = retraceHome()) {
    this.homeDir = homeDir;
    mkdirSync(join(this.homeDir, "sessions"), { recursive: true });
    this.db = new DatabaseSync(join(this.homeDir, "store.db"));
    this.migrate();
    this.cas = new ContentStore(join(this.homeDir, "objects"));

    this.insertEvent = this.db.prepare(
      `INSERT INTO events (session_id, seq, ts, kind, tool_name, summary, jsonl_offset, byte_length)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.upsertSession = this.db.prepare(
      `INSERT INTO sessions (id, project, cwd, git_branch, cc_version, permission_mode, title)
       VALUES (@id, @project, @cwd, @gitBranch, @ccVersion, @permissionMode, @title)
       ON CONFLICT(id) DO UPDATE SET
         project = COALESCE(excluded.project, sessions.project),
         cwd = COALESCE(excluded.cwd, sessions.cwd),
         git_branch = COALESCE(excluded.git_branch, sessions.git_branch),
         cc_version = COALESCE(excluded.cc_version, sessions.cc_version),
         permission_mode = COALESCE(excluded.permission_mode, sessions.permission_mode),
         title = COALESCE(excluded.title, sessions.title)`,
    );
    this.touchSession = this.db.prepare(
      `UPDATE sessions
       SET event_count = event_count + 1,
           started_at = COALESCE(started_at, ?),
           ended_at = ?,
           last_seq = ?,
           last_hash = ?
       WHERE id = ?`,
    );
    // Tool-call counts are derived from the event index rather than kept as a
    // counter column, so they can never drift out of sync with the events
    // actually stored.
    const sessionColumns = `s.*, (
      SELECT COUNT(*) FROM events e
      WHERE e.session_id = s.id AND e.kind = 'tool_call'
    ) AS tool_call_count`;
    this.selectSession = this.db.prepare(
      `SELECT ${sessionColumns} FROM sessions s WHERE s.id = ?`,
    );
    this.selectSessions = this.db.prepare(
      `SELECT ${sessionColumns} FROM sessions s ORDER BY s.started_at DESC`,
    );
    this.selectChainState = this.db.prepare(
      `SELECT last_seq, last_hash FROM sessions WHERE id = ?`,
    );
    this.selectEventPage = this.db.prepare(
      `SELECT jsonl_offset, byte_length FROM events
       WHERE session_id = ? ORDER BY seq LIMIT ? OFFSET ?`,
    );
    this.upsertImportState = this.db.prepare(
      `INSERT INTO import_state (path, session_id, size, mtime_ms, last_line)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         session_id = excluded.session_id,
         size = excluded.size,
         mtime_ms = excluded.mtime_ms,
         last_line = excluded.last_line`,
    );
    this.selectImportState = this.db.prepare(
      `SELECT session_id, size, mtime_ms, last_line FROM import_state WHERE path = ?`,
    );
    this.deleteSessionRow = this.db.prepare(`DELETE FROM sessions WHERE id = ?`);
    this.deleteSessionEvents = this.db.prepare(`DELETE FROM events WHERE session_id = ?`);
    this.selectImportPathsBySession = this.db.prepare(
      `SELECT path FROM import_state WHERE session_id = ?`,
    );
    this.deleteImportStateBySession = this.db.prepare(
      `DELETE FROM import_state WHERE session_id = ?`,
    );
    this.selectSessionIdsByPrefix = this.db.prepare(
      `SELECT id FROM sessions WHERE id LIKE ? ESCAPE '\\'`,
    );
    this.selectAllImportedSessionIds = this.db.prepare(
      `SELECT DISTINCT session_id FROM import_state WHERE session_id IS NOT NULL`,
    );
  }

  private migrate(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS sessions (
        id              TEXT PRIMARY KEY,
        project         TEXT,
        cwd             TEXT,
        git_branch      TEXT,
        cc_version      TEXT,
        permission_mode TEXT,
        title           TEXT,
        started_at      TEXT,
        ended_at        TEXT,
        event_count     INTEGER NOT NULL DEFAULT 0,
        last_seq        INTEGER,
        last_hash       TEXT
      );

      CREATE TABLE IF NOT EXISTS events (
        session_id   TEXT NOT NULL,
        seq          INTEGER NOT NULL,
        ts           TEXT NOT NULL,
        kind         TEXT NOT NULL,
        tool_name    TEXT,
        summary      TEXT,
        jsonl_offset INTEGER NOT NULL,
        byte_length  INTEGER NOT NULL,
        PRIMARY KEY (session_id, seq)
      );

      -- Serves the per-session tool-call count and any kind-based filtering.
      CREATE INDEX IF NOT EXISTS events_session_kind ON events (session_id, kind);

      CREATE TABLE IF NOT EXISTS import_state (
        path       TEXT PRIMARY KEY,
        session_id TEXT,
        size       INTEGER NOT NULL,
        mtime_ms   REAL NOT NULL,
        last_line  INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  get objects(): ContentStore {
    return this.cas;
  }

  /** Idempotent: safe to call more than once (e.g. a shared store closed by
   * both a command handler and a test's cleanup). */
  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  private eventsPath(sessionId: string): string {
    return join(this.homeDir, "sessions", sessionId, "events.jsonl");
  }

  rawPath(sessionId: string): string {
    return join(this.homeDir, "sessions", sessionId, "raw.jsonl");
  }

  /** Create a session row if absent, or fill in any fields not yet known. */
  ensureSession(info: SessionInfo): void {
    this.upsertSession.run({
      id: info.id,
      project: bind(info.project),
      cwd: bind(info.cwd),
      gitBranch: bind(info.gitBranch),
      ccVersion: bind(info.ccVersion),
      permissionMode: bind(info.permissionMode),
      title: bind(info.title),
    });
  }

  private loadChainState(sessionId: string): { seq: number; lastHash: string | null } {
    const cached = this.chainState.get(sessionId);
    if (cached) return cached;

    const row = asRow<{ last_seq: number | null; last_hash: string | null } | undefined>(
      this.selectChainState.get(sessionId),
    );
    const state =
      row && row.last_seq !== null
        ? { seq: row.last_seq + 1, lastHash: row.last_hash }
        : { seq: 0, lastHash: null };
    this.chainState.set(sessionId, state);
    return state;
  }

  /**
   * Seal a draft event into the session's hash chain, append it to
   * `events.jsonl`, and index it in SQLite. Creates the session row if this
   * is its first event.
   *
   * Returns the event in full; what lands on disk has any oversized payload
   * strings swapped out for CAS references (see offload.ts), which
   * {@link readEvents} transparently restores.
   */
  appendEvent(draft: RetraceEventDraft): RetraceEvent {
    this.ensureSession({ id: draft.sessionId });

    // Offload first, so the refs it produces are sealed into the hash along
    // with the payload they stand in for.
    const { payload: deflatedPayload, refs } = deflatePayload(draft.payload, this.cas);
    const sealable =
      refs.length === 0
        ? draft
        : ({
            ...draft,
            artifactRefs: [...(draft.artifactRefs ?? []), ...refs],
          } as RetraceEventDraft);

    const state = this.loadChainState(draft.sessionId);
    const event = sealEvent(sealable, state.seq, state.lastHash);

    const filePath = this.eventsPath(draft.sessionId);
    mkdirSync(dirname(filePath), { recursive: true });
    const offset = existsSync(filePath) ? statSync(filePath).size : 0;
    const stored = { v: RETRACE_SCHEMA_VERSION, ...event, payload: deflatedPayload };
    const line = `${JSON.stringify(stored)}\n`;
    appendFileSync(filePath, line, "utf8");
    const byteLength = Buffer.byteLength(line, "utf8");

    const toolName = draft.kind === "tool_call" ? draft.payload.toolName : null;
    this.insertEvent.run(
      draft.sessionId,
      event.seq,
      event.ts,
      event.kind,
      toolName,
      summarize(draft),
      offset,
      byteLength,
    );
    this.touchSession.run(event.ts, event.ts, event.seq, event.hash, draft.sessionId);

    this.chainState.set(draft.sessionId, { seq: event.seq + 1, lastHash: event.hash });
    return event;
  }

  listSessions(): SessionRow[] {
    return asRow<SessionRowSql[]>(this.selectSessions.all()).map(toSessionRow);
  }

  getSession(id: string): SessionRow | undefined {
    const row = asRow<SessionRowSql | undefined>(this.selectSession.get(id));
    return row ? toSessionRow(row) : undefined;
  }

  /** Read a page of sealed events for a session, ordered by seq. */
  readEvents(sessionId: string, offset = 0, limit = 100): RetraceEvent[] {
    const rows = asRow<{ jsonl_offset: number; byte_length: number }[]>(
      this.selectEventPage.all(sessionId, limit, offset),
    );
    if (rows.length === 0) return [];

    const filePath = this.eventsPath(sessionId);
    const fd = openSync(filePath, "r");
    try {
      return rows.map((row) => {
        const buffer = Buffer.alloc(row.byte_length);
        readSync(fd, buffer, 0, row.byte_length, row.jsonl_offset);
        const stored = JSON.parse(buffer.toString("utf8")) as Record<string, unknown>;
        // parse() also drops the stored `v` stamp, which is metadata about the
        // record rather than part of the hashed event.
        return RetraceEvent.parse(inflateEvent(stored, this.cas));
      });
    } finally {
      closeSync(fd);
    }
  }

  getImportState(path: string): ImportState | undefined {
    const row = asRow<
      { session_id: string; size: number; mtime_ms: number; last_line: number } | undefined
    >(this.selectImportState.get(path));
    if (!row) return undefined;
    return {
      sessionId: row.session_id,
      size: row.size,
      mtimeMs: row.mtime_ms,
      lastLine: row.last_line,
    };
  }

  setImportState(path: string, state: ImportState): void {
    this.upsertImportState.run(
      path,
      state.sessionId,
      state.size,
      state.mtimeMs,
      state.lastLine,
    );
  }

  /**
   * Resolve a full session id or a unique prefix of one — e.g. the 10 chars
   * `list` truncates its SESSION column to — into its full id. Throws if
   * nothing matches or if the prefix is ambiguous, rather than guessing.
   */
  resolveSessionId(idOrPrefix: string): string {
    if (this.getSession(idOrPrefix)) return idOrPrefix;

    const escaped = idOrPrefix.replace(/[\\%_]/g, (c) => `\\${c}`);
    const rows = asRow<{ id: string }[]>(this.selectSessionIdsByPrefix.all(`${escaped}%`));
    if (rows.length === 0) throw new Error(`no session matches "${idOrPrefix}"`);
    if (rows.length > 1) {
      throw new Error(
        `"${idOrPrefix}" matches ${rows.length} sessions: ${rows.map((r) => r.id).join(", ")}`,
      );
    }
    return rows[0].id;
  }

  /** Source transcript paths tied to this session via `import_state`, without deleting anything. */
  getImportPathsForSession(sessionId: string): string[] {
    return asRow<{ path: string }[]>(this.selectImportPathsBySession.all(sessionId)).map(
      (row) => row.path,
    );
  }

  /**
   * Permanently remove a session's row, events, and import-tracking state,
   * plus its on-disk `events.jsonl`/`raw.jsonl`. Returns the source transcript
   * paths (if any) previously tied to this session via `import_state`, so the
   * caller can re-import from them with the current parser — the mechanism
   * behind `retrace reimport`, for undoing a parser bug's effect on data
   * that's already been stored.
   *
   * This is destructive and unconditional: it does not check whether those
   * source paths still exist on disk. Callers that intend to re-import from
   * the returned paths must verify with {@link getImportPathsForSession}
   * *first* — deleting the store's only copy of a session and then finding
   * out its source transcript is gone loses that session's data for good.
   *
   * CAS objects the session referenced are left in place (no reference
   * counting/GC yet) — harmless orphaned bytes, not a correctness issue.
   */
  deleteSession(sessionId: string): DeletedSessionInfo {
    const importPaths = this.getImportPathsForSession(sessionId);

    this.deleteSessionEvents.run(sessionId);
    this.deleteImportStateBySession.run(sessionId);
    this.deleteSessionRow.run(sessionId);
    this.chainState.delete(sessionId);

    // maxRetries/retryDelay: a transient Windows file lock (antivirus, the
    // search indexer, another retrace process momentarily touching this
    // session's files) surfaces as EBUSY/EPERM on unlink — worth a few
    // retries before giving up, rather than leaving the dir half-deleted.
    rmSync(join(this.homeDir, "sessions", sessionId), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });

    return { importPaths };
  }

  /** Ids of sessions that have at least one known source transcript — i.e. came in via `import`, as opposed to existing purely from live `retrace hook` events. */
  listImportedSessionIds(): string[] {
    return asRow<{ session_id: string }[]>(this.selectAllImportedSessionIds.all()).map(
      (row) => row.session_id,
    );
  }

  /**
   * Permanently delete the entire store: every session, the SQLite index,
   * and every CAS object — the whole of {@link homeDir}, not just its known
   * sessions. Closes the db handle first; on Windows a still-open handle
   * blocks deletion of the file it points at. The instance is unusable after
   * this — there is nothing left on disk for it to talk to.
   *
   * maxRetries/retryDelay: `store.db` in particular is a magnet for
   * transient Windows locks (antivirus, the search indexer, a stray retrace
   * process that didn't exit) — worth a few retries before giving up, rather
   * than throwing partway through and leaving `sessions/`/`objects/` already
   * gone but `store.db` still sitting there.
   */
  reset(): void {
    this.close();
    rmSync(this.homeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

interface SessionRowSql {
  id: string;
  project: string | null;
  cwd: string | null;
  git_branch: string | null;
  cc_version: string | null;
  permission_mode: string | null;
  title: string | null;
  started_at: string | null;
  ended_at: string | null;
  event_count: number;
  tool_call_count: number;
}

function toSessionRow(row: SessionRowSql): SessionRow {
  return {
    id: row.id,
    project: row.project,
    cwd: row.cwd,
    gitBranch: row.git_branch,
    ccVersion: row.cc_version,
    permissionMode: row.permission_mode,
    title: row.title,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    eventCount: row.event_count,
    toolCallCount: row.tool_call_count,
  };
}
