import type { RetraceEventDraft } from "./schema.js";

/**
 * Pure formatting logic with zero Node dependencies — deliberately kept out
 * of store.ts so it can be imported from browser code (via the `./browser`
 * entry point) without pulling in node:sqlite/fs/crypto.
 */

const MAX_SUMMARY_LENGTH = 120;

/**
 * How long a session ran, as a compact label ("4m 12s"). Returns null when
 * either end is missing or the timestamps don't parse — sessions are stamped
 * from transcript data, which isn't guaranteed well-formed.
 */
export function formatDuration(
  startedAt: string | null,
  endedAt: string | null,
): string | null {
  if (!startedAt || !endedAt) return null;
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;

  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

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
