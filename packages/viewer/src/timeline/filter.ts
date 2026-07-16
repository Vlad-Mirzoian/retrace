import { summarize } from "retrace-core/browser";
import type { LeafItem, TimelineItem } from "./grouping.js";
import { outputToText } from "./ToolCallCard.js";

export type FilterKind =
  | "user_prompt"
  | "assistant_text"
  | "thinking"
  | "tool"
  | "file_change"
  | "error"
  | "other";

export const FILTER_KINDS: { value: FilterKind; label: string }[] = [
  { value: "user_prompt", label: "Prompts" },
  { value: "assistant_text", label: "Assistant" },
  { value: "thinking", label: "Thinking" },
  { value: "tool", label: "Tools" },
  { value: "file_change", label: "Files" },
  { value: "error", label: "Errors" },
  { value: "other", label: "Other" },
];

export const ALL_FILTER_KINDS: ReadonlySet<FilterKind> = new Set(
  FILTER_KINDS.map((f) => f.value),
);

/** Which filter bucket a row falls into. A failed tool call counts as an error. */
export function itemFilterKind(item: LeafItem): FilterKind {
  if (item.kind === "tool") return item.result?.payload.isError ? "error" : "tool";

  switch (item.event.kind) {
    case "user_prompt":
    case "assistant_text":
    case "thinking":
    case "file_change":
      return item.event.kind;
    case "error":
      return "error";
    default:
      // session_start, session_end, subagent_start, subagent_stop, meta —
      // low-volume boundary/housekeeping records.
      return "other";
  }
}

function leafSearchText(item: LeafItem): string {
  if (item.kind === "tool") {
    const parts = [item.call.payload.toolName];
    if (item.result) parts.push(outputToText(item.result.payload.output));
    return parts.join(" ");
  }
  const { event } = item;
  if (event.kind === "user_prompt" || event.kind === "assistant_text" || event.kind === "thinking") {
    return event.payload.text;
  }
  if (event.kind === "file_change") return event.payload.path;
  return summarize(event);
}

function leafMatches(item: LeafItem, activeKinds: ReadonlySet<FilterKind>, query: string): boolean {
  if (!activeKinds.has(itemFilterKind(item))) return false;
  if (!query) return true;
  return leafSearchText(item).toLowerCase().includes(query);
}

/**
 * Apply the kind filter and text search to a grouped timeline. A subagent
 * group survives if any of its inner rows still match, shown with only that
 * matching subset — so a search still surfaces work buried inside a subagent
 * run instead of hiding the whole group.
 */
export function filterItems(
  items: TimelineItem[],
  activeKinds: ReadonlySet<FilterKind>,
  search: string,
): TimelineItem[] {
  const query = search.trim().toLowerCase();
  const out: TimelineItem[] = [];

  for (const item of items) {
    if (item.kind === "subagent") {
      const inner = item.items.filter((leaf) => leafMatches(leaf, activeKinds, query));
      if (inner.length > 0) out.push({ kind: "subagent", items: inner });
    } else if (leafMatches(item, activeKinds, query)) {
      out.push(item);
    }
  }
  return out;
}

function leafEventCount(leaf: LeafItem): number {
  return leaf.kind === "tool" ? (leaf.result ? 2 : 1) : 1;
}

/** Count underlying (pre-grouping) events represented by a set of rows. */
export function countEvents(items: TimelineItem[]): number {
  let total = 0;
  for (const item of items) {
    total +=
      item.kind === "subagent"
        ? item.items.reduce((sum, leaf) => sum + leafEventCount(leaf), 0)
        : leafEventCount(item);
  }
  return total;
}
