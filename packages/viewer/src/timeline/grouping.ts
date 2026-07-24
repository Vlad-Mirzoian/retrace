import type { RetraceEvent } from "retrace-core/browser";

export type ToolCallEvent = Extract<RetraceEvent, { kind: "tool_call" }>;
export type ToolResultEvent = Extract<RetraceEvent, { kind: "tool_result" }>;

/** A single row of the timeline that isn't itself a group. */
export type LeafItem =
  | { kind: "event"; event: RetraceEvent }
  | { kind: "tool"; call: ToolCallEvent; result?: ToolResultEvent };

export type TimelineItem = LeafItem | { kind: "subagent"; items: LeafItem[] };

/**
 * Fold each tool_call together with the tool_result it produced. The transcript
 * records them as two separate events linked by `toolUseId`; showing them as
 * one row is far more readable. A result whose call is missing (e.g. a sliced
 * session) is kept as its own row rather than dropped.
 */
function pairTools(events: RetraceEvent[]): LeafItem[] {
  const resultFor = new Map<string, ToolResultEvent>();
  for (const event of events) {
    if (event.kind === "tool_result" && event.payload.toolUseId) {
      // First result wins if ids somehow repeat.
      if (!resultFor.has(event.payload.toolUseId)) {
        resultFor.set(event.payload.toolUseId, event);
      }
    }
  }

  // Resolve every pairing up front so the walk below is order-independent.
  const claimed = new Set<ToolResultEvent>();
  for (const event of events) {
    if (event.kind === "tool_call" && event.payload.toolUseId) {
      const result = resultFor.get(event.payload.toolUseId);
      if (result) claimed.add(result);
    }
  }

  const items: LeafItem[] = [];
  for (const event of events) {
    if (event.kind === "tool_call") {
      const result = event.payload.toolUseId
        ? resultFor.get(event.payload.toolUseId)
        : undefined;
      items.push({ kind: "tool", call: event, result });
    } else if (!(event.kind === "tool_result" && claimed.has(event))) {
      items.push({ kind: "event", event });
    }
  }
  return items;
}

/**
 * Turn a flat event stream into timeline rows: tool calls folded with their
 * results, and each contiguous run of subagent (sidechain) events collapsed
 * into one group so a subagent's work doesn't flood the main narrative.
 */
export function groupEvents(events: RetraceEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let index = 0;

  while (index < events.length) {
    const isSidechain = events[index].sidechain === true;
    let end = index;
    while (end < events.length && (events[end].sidechain === true) === isSidechain) {
      end += 1;
    }

    const run = pairTools(events.slice(index, end));
    if (isSidechain) items.push({ kind: "subagent", items: run });
    else items.push(...run);

    index = end;
  }

  return items;
}

/** Stable React key for a row: the seq of the event that starts it. */
export function itemKey(item: TimelineItem): number {
  switch (item.kind) {
    case "event":
      return item.event.seq;
    case "tool":
      return item.call.seq;
    case "subagent":
      return item.items.length > 0 ? itemKey(item.items[0]) : -1;
  }
}

/** The inclusive [start, end] seq range of underlying events a row represents. */
export function itemRange(item: TimelineItem): [number, number] {
  switch (item.kind) {
    case "event":
      return [item.event.seq, item.event.seq];
    case "tool":
      return [item.call.seq, item.result?.seq ?? item.call.seq];
    case "subagent":
      if (item.items.length === 0) return [-1, -1];
      return [itemRange(item.items[0])[0], itemRange(item.items[item.items.length - 1])[1]];
  }
}

/**
 * Map a raw event `seq` (the replay cursor) to its row's index in a
 * (filtered + grouped) item list. If `seq` doesn't fall inside any row's
 * range — e.g. it belongs to an event the active filter hid — this snaps
 * forward to the next visible row at or after it, or the last row if the
 * cursor is past everything currently visible. The cursor itself always
 * stays on the raw seq; this only resolves where to scroll/highlight for it.
 */
export function indexForSeq(items: TimelineItem[], seq: number): number {
  for (let i = 0; i < items.length; i++) {
    if (itemRange(items[i])[1] >= seq) return i;
  }
  return items.length > 0 ? items.length - 1 : -1;
}

/**
 * Find the leaf row whose range contains `seq`, descending into subagent
 * groups — unlike {@link indexForSeq}, this never snaps to a neighboring row.
 * Meant to be run over the *ungrouped-by-filter* item list (i.e. before
 * `filterItems`), so a caller can ask "what row does this seq actually belong
 * to, regardless of what's currently hidden" — e.g. to reveal it when a
 * cursor jump (a failure-panel click, a next-error button) lands somewhere
 * the active filter is hiding.
 */
export function leafAt(items: TimelineItem[], seq: number): LeafItem | null {
  for (const item of items) {
    if (item.kind === "subagent") {
      for (const leaf of item.items) {
        const [start, end] = itemRange(leaf);
        if (seq >= start && seq <= end) return leaf;
      }
    } else {
      const [start, end] = itemRange(item);
      if (seq >= start && seq <= end) return item;
    }
  }
  return null;
}
