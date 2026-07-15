/**
 * Loose, tolerant types for raw Claude Code transcript records. The on-disk
 * JSONL format is undocumented and shifts between Claude Code versions, so
 * every field is optional and nothing here is trusted — the parser narrows
 * defensively and falls back to `meta` events for anything unexpected.
 */

export interface RawBlock {
  type?: string;
  // text / assistant_text
  text?: string;
  // thinking
  thinking?: string;
  signature?: string;
  // tool_use
  id?: string;
  name?: string;
  input?: unknown;
  // tool_result
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

export interface RawMessage {
  role?: string;
  model?: string;
  content?: unknown; // string | RawBlock[] | something new
}

export interface RawRecord {
  type?: string;
  message?: RawMessage;
  isSidechain?: boolean;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  permissionMode?: string;
  promptId?: string;
  aiTitle?: string;
  uuid?: string;
  parentUuid?: string;
  [key: string]: unknown;
}

/**
 * Known service/noise record types that carry no timeline signal on their own.
 * They are intentionally skipped by the normalizer (the raw transcript is kept
 * verbatim elsewhere, so nothing is actually lost). Anything NOT in this set
 * and not a `user`/`assistant` record becomes a `meta` event, so genuinely new
 * record types introduced by future Claude Code versions are never dropped
 * silently.
 */
export const KNOWN_SERVICE_TYPES = new Set<string>([
  "ai-title",
  "queue-operation",
  "mode",
  "last-prompt",
  "attachment",
  "system",
  "summary",
  "file-history-snapshot",
]);
