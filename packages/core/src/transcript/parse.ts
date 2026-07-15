import type { RetraceEventDraft } from "../schema.js";
import type { SessionInfo } from "../store.js";
import { KNOWN_SERVICE_TYPES, type RawBlock, type RawRecord } from "./records.js";

/** Common envelope fields shared by every draft produced from one record. */
interface DraftBase {
  ts: string;
  sessionId: string;
  sidechain?: true;
}

export interface NormalizeContext {
  /** Session id, taken from the transcript filename (records may omit it). */
  sessionId: string;
  /** Timestamp to use when a record carries none (e.g. the last seen ts). */
  fallbackTs: string;
}

function baseFor(record: RawRecord, ctx: NormalizeContext): DraftBase {
  const ts = typeof record.timestamp === "string" ? record.timestamp : ctx.fallbackTs;
  const base: DraftBase = { ts, sessionId: ctx.sessionId };
  if (record.isSidechain === true) base.sidechain = true;
  return base;
}

function normalizeUser(record: RawRecord, base: DraftBase): RetraceEventDraft[] {
  const content = record.message?.content;

  if (typeof content === "string") {
    const text = content.trim();
    if (!text) return [];
    const payload =
      typeof record.promptId === "string"
        ? { text: content, promptId: record.promptId }
        : { text: content };
    return [{ ...base, kind: "user_prompt", payload }];
  }

  if (!Array.isArray(content)) return [];

  const out: RetraceEventDraft[] = [];
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as RawBlock;
    if (b.type === "tool_result") {
      out.push({
        ...base,
        kind: "tool_result",
        payload: {
          toolUseId: typeof b.tool_use_id === "string" ? b.tool_use_id : "",
          output: b.content,
          ...(b.is_error ? { isError: true } : {}),
        },
      });
    } else if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
      // Real user-typed text carried as a block (e.g. alongside attachments).
      out.push({ ...base, kind: "user_prompt", payload: { text: b.text } });
    }
    // Other user block types are skipped; the raw record is retained elsewhere.
  }
  return out;
}

function normalizeAssistant(record: RawRecord, base: DraftBase): RetraceEventDraft[] {
  const message = record.message;
  const model = typeof message?.model === "string" ? message.model : undefined;
  const content = message?.content;

  if (typeof content === "string") {
    if (!content.trim()) return [];
    return [
      { ...base, kind: "assistant_text", payload: { text: content, ...(model ? { model } : {}) } },
    ];
  }

  if (!Array.isArray(content)) return [];

  const out: RetraceEventDraft[] = [];
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as RawBlock;
    if (b.type === "text" && typeof b.text === "string") {
      if (b.text.trim()) {
        out.push({
          ...base,
          kind: "assistant_text",
          payload: { text: b.text, ...(model ? { model } : {}) },
        });
      }
    } else if (b.type === "thinking" && typeof b.thinking === "string") {
      out.push({
        ...base,
        kind: "thinking",
        payload: {
          text: b.thinking,
          ...(typeof b.signature === "string" ? { signature: b.signature } : {}),
        },
      });
    } else if (b.type === "tool_use") {
      out.push({
        ...base,
        kind: "tool_call",
        payload: {
          toolName: typeof b.name === "string" ? b.name : "unknown",
          toolUseId: typeof b.id === "string" ? b.id : "",
          input: b.input,
        },
      });
    } else {
      // Unknown assistant content block → meta, never dropped silently.
      out.push({
        ...base,
        kind: "meta",
        payload: { originalType: `assistant_block:${b.type ?? "unknown"}`, raw: b },
      });
    }
  }
  return out;
}

/**
 * Normalize a single raw transcript record into zero or more event drafts.
 * `user`/`assistant` records map to signal events; known service records are
 * skipped; anything else becomes a `meta` event.
 */
export function normalizeRecord(
  record: RawRecord,
  ctx: NormalizeContext,
): RetraceEventDraft[] {
  const base = baseFor(record, ctx);
  const type = record.type;

  if (type === "user") return normalizeUser(record, base);
  if (type === "assistant") return normalizeAssistant(record, base);
  if (typeof type === "string" && KNOWN_SERVICE_TYPES.has(type)) return [];

  return [
    {
      ...base,
      kind: "meta",
      payload: { originalType: type ?? "unknown", raw: record },
    },
  ];
}

/** Session metadata contributed by a single record (accumulated over the file). */
export function sessionInfoFromRecord(record: RawRecord): Partial<SessionInfo> {
  const info: Partial<SessionInfo> = {};
  if (typeof record.sessionId === "string") info.id = record.sessionId;
  if (typeof record.cwd === "string") info.cwd = record.cwd;
  if (typeof record.gitBranch === "string") info.gitBranch = record.gitBranch;
  if (typeof record.version === "string") info.ccVersion = record.version;
  if (typeof record.permissionMode === "string") info.permissionMode = record.permissionMode;
  // The AI-generated title is emitted repeatedly as it is refined; the last one wins.
  if (record.type === "ai-title" && typeof record.aiTitle === "string") {
    info.title = record.aiTitle;
  }
  return info;
}

export interface ParsedTranscript {
  sessionId: string;
  session: Partial<SessionInfo>;
  events: RetraceEventDraft[];
}

function* iterateLines(text: string): Iterable<string> {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) yield trimmed;
  }
}

/**
 * Parse a whole transcript's text into event drafts plus accumulated session
 * metadata. Tolerant by design: unparseable lines become `meta` events rather
 * than aborting the parse.
 */
export function parseTranscript(text: string, sessionId: string): ParsedTranscript {
  const events: RetraceEventDraft[] = [];
  const session: Partial<SessionInfo> = { id: sessionId };
  let lastTs = new Date(0).toISOString();

  for (const line of iterateLines(text)) {
    let record: RawRecord | null;
    try {
      record = JSON.parse(line) as RawRecord;
    } catch {
      events.push({
        ts: lastTs,
        sessionId,
        kind: "meta",
        payload: { originalType: "parse-error", note: "unparseable JSONL line" },
      });
      continue;
    }

    Object.assign(session, sessionInfoFromRecord(record));
    if (typeof record.timestamp === "string") lastTs = record.timestamp;
    events.push(...normalizeRecord(record, { sessionId, fallbackTs: lastTs }));
  }

  return { sessionId, session, events };
}
