import type { RetraceEventDraft } from "./schema.js";

/**
 * Pure formatting logic with zero Node dependencies — deliberately kept out
 * of store.ts so it can be imported from browser code (via the `./browser`
 * entry point) without pulling in node:sqlite/fs/crypto.
 */

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
