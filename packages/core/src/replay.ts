import type { FileChangePayload, RetraceEvent } from "./schema.js";

/**
 * Pure replay/forensic-analysis primitives over an already-sealed event
 * stream. Kept dependency-free (only `schema.js` types) so this module is
 * re-exported from the browser-safe subset (`browser.ts`) — the same logic
 * drives both the live viewer and the server-less HTML export.
 *
 * Every function here assumes `events` is already ordered by ascending `seq`,
 * the same invariant the viewer's `groupEvents` (packages/viewer/src/timeline/grouping.ts)
 * relies on — events come from `RetraceStore.readEvents`/the HTTP API in that order.
 */

export type FileChangeEvent = Extract<RetraceEvent, { kind: "file_change" }>;
export type ToolCallEvent = Extract<RetraceEvent, { kind: "tool_call" }>;
export type ToolResultEvent = Extract<RetraceEvent, { kind: "tool_result" }>;

/** A file's reconstructed state in the working tree at a given replay cursor. */
export interface FileStateEntry {
  path: string;
  /** CAS hash of the file's content at the cursor, if this change captured one. */
  ref?: string;
  /**
   * CAS hash of the file's content the first time this session touched it
   * (its pre-edit snapshot), if captured — a baseline for diffing the whole
   * session's effect on this file, independent of the cursor.
   */
  originalRef?: string;
  /** The operation of the file_change that produced this state. */
  operation: FileChangePayload["operation"];
  /** seq of the file_change that produced this state. */
  atSeq: number;
  /** False when the change happened but no content snapshot was captured (e.g. an Edit with only oldString/newString). */
  hadSnapshot: boolean;
}

/**
 * Reconstruct the working tree at a replay cursor: for each path touched by a
 * `file_change` with `seq <= cursor`, its most recent content ref. A path
 * whose most recent change at or before the cursor was a delete is *not*
 * included — it no longer exists in the working tree at that point. Callers
 * that need to show a "deleted" status can cross-reference `changesForPath`.
 */
export function fileStateAt(
  events: RetraceEvent[],
  cursor: number,
): Map<string, FileStateEntry> {
  const state = new Map<string, FileStateEntry>();
  const originalRefs = new Map<string, string>();

  for (const event of events) {
    if (event.kind !== "file_change" || event.seq > cursor) continue;
    const { path, operation, afterRef, beforeRef } = event.payload;

    if (beforeRef && !originalRefs.has(path)) {
      originalRefs.set(path, beforeRef);
    }

    if (operation === "delete") {
      state.delete(path);
      continue;
    }

    state.set(path, {
      path,
      ref: afterRef,
      originalRef: originalRefs.get(path),
      operation,
      atSeq: event.seq,
      hadSnapshot: afterRef !== undefined,
    });
  }

  return state;
}

/** Every distinct file path touched by a file_change in this session, in first-touched order. */
export function filePathsTouched(events: RetraceEvent[]): string[] {
  const seen = new Set<string>();
  for (const event of events) {
    if (event.kind === "file_change") seen.add(event.payload.path);
  }
  return [...seen];
}

/** All file_change events for one path, in session-stream (seq) order. */
export function changesForPath(
  events: RetraceEvent[],
  path: string,
): FileChangeEvent[] {
  return events.filter(
    (event): event is FileChangeEvent =>
      event.kind === "file_change" && event.payload.path === path,
  );
}

export interface SubagentRange {
  startSeq: number;
  endSeq: number;
  parentToolUseId?: string;
}

export interface NavIndex {
  errors: number[];
  fileChanges: number[];
  prompts: number[];
  toolCalls: number[];
  subagentRanges: SubagentRange[];
}

/**
 * Precompute cursor-navigation targets over a session's event stream: seqs of
 * errors (both `error` events and failed tool results), file changes,
 * prompts, and tool calls, plus the seq ranges of contiguous subagent
 * (sidechain) runs — mirroring how the viewer's `groupEvents` partitions
 * sidechain runs by contiguous `sidechain === true`.
 */
export function buildNavIndex(events: RetraceEvent[]): NavIndex {
  const errors: number[] = [];
  const fileChanges: number[] = [];
  const prompts: number[] = [];
  const toolCalls: number[] = [];
  const subagentRanges: SubagentRange[] = [];

  let rangeStart: number | null = null;
  let rangeParent: string | undefined;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    switch (event.kind) {
      case "error":
        errors.push(event.seq);
        break;
      case "tool_result":
        if (event.payload.isError) errors.push(event.seq);
        break;
      case "file_change":
        fileChanges.push(event.seq);
        break;
      case "user_prompt":
        prompts.push(event.seq);
        break;
      case "tool_call":
        toolCalls.push(event.seq);
        break;
      case "subagent_start":
        rangeParent = event.payload.parentToolUseId;
        break;
    }

    if (event.sidechain === true) {
      rangeStart ??= event.seq;
    } else if (rangeStart !== null) {
      subagentRanges.push({
        startSeq: rangeStart,
        endSeq: events[i - 1].seq,
        parentToolUseId: rangeParent,
      });
      rangeStart = null;
      rangeParent = undefined;
    }
  }
  if (rangeStart !== null) {
    subagentRanges.push({
      startSeq: rangeStart,
      endSeq: events[events.length - 1].seq,
      parentToolUseId: rangeParent,
    });
  }

  return { errors, fileChanges, prompts, toolCalls, subagentRanges };
}

export type NavKind = "errors" | "fileChanges" | "prompts" | "toolCalls";

/**
 * Find the next (`dir` = 1) or previous (`dir` = -1) seq of a given kind
 * strictly beyond `fromSeq`. Returns null when there is none.
 */
export function nextOfKind(
  index: NavIndex,
  fromSeq: number,
  kind: NavKind,
  dir: 1 | -1,
): number | null {
  const seqs = index[kind];
  if (dir === 1) {
    for (const seq of seqs) {
      if (seq > fromSeq) return seq;
    }
    return null;
  }
  for (let i = seqs.length - 1; i >= 0; i--) {
    if (seqs[i] < fromSeq) return seqs[i];
  }
  return null;
}

export interface CausalChain {
  toolCall?: ToolCallEvent;
  toolResult?: ToolResultEvent;
  fileChanges: FileChangeEvent[];
}

/**
 * From any event's seq, resolve the tool call/result pair and the file
 * changes it produced — a compact "why did this happen" trace for a selected
 * failure. If the anchor event is a `tool_call` or `tool_result`, its
 * `toolUseId` drives the lookup; other kinds (e.g. a standalone `error`
 * event, which the schema doesn't link to a tool) yield an empty chain.
 */
export function causalChainFor(events: RetraceEvent[], seq: number): CausalChain {
  const anchor = events.find((event) => event.seq === seq);
  const toolUseId =
    anchor?.kind === "tool_call" || anchor?.kind === "tool_result"
      ? anchor.payload.toolUseId
      : undefined;

  if (!toolUseId) return { fileChanges: [] };

  let toolCall: ToolCallEvent | undefined;
  let toolResult: ToolResultEvent | undefined;
  const fileChanges: FileChangeEvent[] = [];

  for (const event of events) {
    if (event.kind === "tool_call" && event.payload.toolUseId === toolUseId) {
      toolCall = event;
    } else if (event.kind === "tool_result" && event.payload.toolUseId === toolUseId) {
      toolResult = event;
    } else if (event.kind === "file_change" && event.payload.toolUseId === toolUseId) {
      fileChanges.push(event);
    }
  }

  return { toolCall, toolResult, fileChanges };
}
