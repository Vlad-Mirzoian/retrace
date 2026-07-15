import type { DatabaseSync as DatabaseSyncType, StatementSync } from "node:sqlite";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ContentStore } from "./cas.js";
import { sealEvent } from "./chain.js";
import { RetraceEvent, type RetraceEventDraft } from "./schema.js";

// `node:sqlite` is new enough that some bundlers' builtin-module detection
// (e.g. vite-node, which vitest uses) doesn't yet recognize it and tries to
// resolve "sqlite" as an npm package. Fetching it via `getBuiltinModule`
// instead of a static `import` sidesteps module resolution entirely.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

/** Resolve the Retrace data directory: `$RETRACE_HOME` if set, else `~/.retrace`. */
export function retraceHome(): string {
  return process.env.RETRACE_HOME ?? join(homedir(), ".retrace");
}

export interface SessionInfo {
  id: string;
  project?: string | null;
  cwd?: string | null;
  gitBranch?: string | null;
  ccVersion?: string | null;
  permissionMode?: string | null;
  title?: string | null;
}

export interface SessionRow {
  id: string;
  project: string | null;
  cwd: string | null;
  gitBranch: string | null;
  ccVersion: string | null;
  permissionMode: string | null;
  title: string | null;
  startedAt: string | null;
  endedAt: string | null;
  eventCount: number;
}

export interface ImportState {
  sessionId: string;
  size: number;
  mtimeMs: number;
  lastLine: number;
}

const MAX_SUMMARY_LENGTH = 120;

function truncate(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_SUMMARY_LENGTH
    ? `${oneLine.slice(0, MAX_SUMMARY_LENGTH - 1)}…`
    : oneLine;
}

/** A short human-readable label for an event, used in CLI/viewer lists. */
export function summarize(draft: RetraceEventDraft): string {
  switch (draft.kind) {
    case "user_prompt":
    case "assistant_text":
    case "thinking":
      return truncate(draft.payload.text);
    case "tool_call":
      return draft.payload.toolName;
    case "tool_result":
      return draft.payload.isError ? "error" : "result";
    case "file_change":
      return `${draft.payload.operation} ${draft.payload.path}`;
    case "session_start":
      return draft.payload.title ?? "";
    case "subagent_start":
    case "subagent_stop":
      return draft.payload.description ?? "";
    case "session_end":
      return draft.payload.reason ?? "";
    case "error":
      return truncate(draft.payload.message);
    case "meta":
      return draft.payload.note ?? draft.payload.originalType ?? "";
  }
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
    this.selectSession = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`);
    this.selectSessions = this.db.prepare(
      `SELECT * FROM sessions ORDER BY started_at DESC`,
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
   */
  appendEvent(draft: RetraceEventDraft): RetraceEvent {
    this.ensureSession({ id: draft.sessionId });

    const state = this.loadChainState(draft.sessionId);
    const event = sealEvent(draft, state.seq, state.lastHash);

    const filePath = this.eventsPath(draft.sessionId);
    mkdirSync(dirname(filePath), { recursive: true });
    const offset = existsSync(filePath) ? statSync(filePath).size : 0;
    const line = `${JSON.stringify(event)}\n`;
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
        return RetraceEvent.parse(JSON.parse(buffer.toString("utf8")));
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
  };
}
