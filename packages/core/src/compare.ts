import { diffArrays } from "diff";
import type { RetraceEvent } from "./schema.js";

/**
 * Cross-run comparison: aligns two independently recorded event streams so a
 * UI can show them side by side. Distinct from replay.ts's single-run
 * primitives — this module compares *two* runs (e.g. the same task attempted
 * twice) and answers "what differed between them".
 */

/**
 * A fast, non-cryptographic string hash (djb2) — keeps alignment signatures
 * compact. Never used for anything security-sensitive (unlike chain.ts's
 * sha256, which is the actual tamper-evidence guarantee).
 */
function hashText(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/**
 * A coarse, deliberately loose fingerprint used only to decide whether two
 * events from different runs occupy "the same slot" for alignment purposes.
 *
 * Tool calls/results and file changes align on tool name / path+operation
 * alone — *not* their actual input/output/content — so two runs of the same
 * task still line up even when their exact arguments or outputs differ,
 * which is the normal case (an LLM rarely reproduces byte-identical output
 * across runs). Prompts, assistant text, thinking, and errors require an
 * exact text match to align at all — a real v1 limitation (paraphrased-but-
 * equivalent text won't align, and will show as an only-a/only-b pair
 * instead of a changed one) that a smarter fuzzy match could improve later.
 */
function alignmentSignature(event: RetraceEvent): string {
  switch (event.kind) {
    case "tool_call":
      return `tool_call:${event.payload.toolName}`;
    case "tool_result":
      return "tool_result";
    case "file_change":
      return `file_change:${event.payload.operation}:${event.payload.path}`;
    case "user_prompt":
      return `user_prompt:${hashText(event.payload.text)}`;
    case "assistant_text":
      return `assistant_text:${hashText(event.payload.text)}`;
    case "thinking":
      return `thinking:${hashText(event.payload.text)}`;
    case "error":
      return `error:${hashText(event.payload.message)}`;
    default:
      // session_start/end, subagent_start/stop, meta: kind alone. Coarse,
      // but these are low-volume boundary/housekeeping records.
      return event.kind;
  }
}

/** Whether two events aligned to the same slot are actually identical in content, not just structurally similar. */
function contentEquals(a: RetraceEvent, b: RetraceEvent): boolean {
  switch (a.kind) {
    case "tool_call":
      return (
        b.kind === "tool_call" &&
        a.payload.toolName === b.payload.toolName &&
        JSON.stringify(a.payload.input) === JSON.stringify(b.payload.input)
      );
    case "tool_result":
      return (
        b.kind === "tool_result" &&
        a.payload.isError === b.payload.isError &&
        JSON.stringify(a.payload.output) === JSON.stringify(b.payload.output)
      );
    case "file_change":
      return (
        b.kind === "file_change" &&
        a.payload.afterRef === b.payload.afterRef &&
        a.payload.oldString === b.payload.oldString &&
        a.payload.newString === b.payload.newString
      );
    default:
      // Every other kind's alignment signature already requires an exact
      // text/kind match to align at all, so an aligned pair is always identical.
      return true;
  }
}

export type AlignedRowStatus = "match" | "changed" | "only-a" | "only-b";

export interface AlignedRow {
  a?: RetraceEvent;
  b?: RetraceEvent;
  status: AlignedRowStatus;
}

/**
 * Align two runs' event streams for side-by-side comparison. Computes an LCS
 * alignment (via the `diff` package's array diff) over `alignmentSignature`,
 * then classifies each aligned pair as "match" (identical content) or
 * "changed" (same slot, different content) via `contentEquals`.
 */
export function alignRuns(eventsA: RetraceEvent[], eventsB: RetraceEvent[]): AlignedRow[] {
  const parts = diffArrays(eventsA, eventsB, {
    comparator: (a, b) => alignmentSignature(a) === alignmentSignature(b),
  });

  const rows: AlignedRow[] = [];
  let ai = 0;

  for (const part of parts) {
    if (part.removed) {
      for (const event of part.value) rows.push({ a: event, status: "only-a" });
      ai += part.count;
    } else if (part.added) {
      for (const event of part.value) rows.push({ b: event, status: "only-b" });
    } else {
      // An unchanged (matched) run: diffArrays reports the *new* (B) side's
      // slice here; the paired A-side items are the next `count` events in
      // eventsA, consumed in lockstep since a common subsequence aligns 1:1.
      for (let k = 0; k < part.count; k++) {
        const a = eventsA[ai + k];
        const b = part.value[k];
        rows.push({ a, b, status: contentEquals(a, b) ? "match" : "changed" });
      }
      ai += part.count;
    }
  }

  return rows;
}
