import type { RetraceEvent } from "retrace-core/browser";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { AssistantCard, GenericCard, PromptCard, ThinkingCard } from "./cards.js";
import { FileChangeCard } from "./FileChangeCard.js";
import {
  exactIndexForSeq,
  indexForSeq,
  itemKey,
  itemRange,
  type LeafItem,
  type TimelineItem,
} from "./grouping.js";
import { Collapsible } from "./primitives.js";
import { ToolCallCard } from "./ToolCallCard.js";

interface RowProps {
  currentSeq?: number;
  onSelect?: (seq: number) => void;
}

function contains(item: TimelineItem, seq: number): boolean {
  const [start, end] = itemRange(item);
  return seq >= start && seq <= end;
}

/**
 * Render the card for a single raw event (a tool_call renders without its
 * result — there's no pairing at this level). Shared by the main timeline's
 * leaf rows (which handle pairing separately, above this) and the compare
 * view, which shows two runs' raw event streams side by side with no pairing
 * at all.
 */
export function renderEventCard(event: RetraceEvent): ReactNode {
  switch (event.kind) {
    case "user_prompt":
      return <PromptCard event={event} />;
    case "assistant_text":
      return <AssistantCard event={event} />;
    case "thinking":
      return <ThinkingCard event={event} />;
    case "file_change":
      return <FileChangeCard event={event} />;
    case "tool_call":
      return <ToolCallCard call={event} />;
    default:
      return <GenericCard event={event} />;
  }
}

function LeafRow({
  item,
  active,
  onSelect,
}: {
  item: LeafItem;
  active: boolean;
  onSelect?: (seq: number) => void;
}) {
  const handleClick = onSelect ? () => onSelect(itemKey(item)) : undefined;
  const content =
    item.kind === "tool" ? (
      <ToolCallCard call={item.call} result={item.result} />
    ) : (
      renderEventCard(item.event)
    );

  return (
    <div className={`timeline-row${active ? " active" : ""}`} onClick={handleClick}>
      {content}
    </div>
  );
}

function SubagentGroup({ items, currentSeq, onSelect }: RowProps & { items: LeafItem[] }) {
  const cursorInside = currentSeq !== undefined && contains({ kind: "subagent", items }, currentSeq);
  // A subagent can fire its own parallel tool calls, with the same
  // overlapping-range hazard as the main timeline — resolved the same way,
  // scoped to just this group's own rows.
  const activeIndex = useMemo(
    () => (currentSeq !== undefined ? exactIndexForSeq(items, currentSeq) : -1),
    [items, currentSeq],
  );

  return (
    <div className="subagent">
      <Collapsible label={`Subagent · ${items.length} event(s)`} forceOpen={cursorInside}>
        <div className="subagent-body">
          {items.map((item, index) => (
            <LeafRow key={itemKey(item)} item={item} active={index === activeIndex} onSelect={onSelect} />
          ))}
        </div>
      </Collapsible>
    </div>
  );
}

export function TimelineRow({
  item,
  index,
  activeIndex,
  currentSeq,
  onSelect,
}: RowProps & { item: TimelineItem; index: number; activeIndex: number }) {
  if (item.kind === "subagent") {
    return <SubagentGroup items={item.items} currentSeq={currentSeq} onSelect={onSelect} />;
  }
  return <LeafRow item={item} active={index === activeIndex} onSelect={onSelect} />;
}

export function Timeline({
  items,
  currentSeq,
  onSelect,
}: {
  items: TimelineItem[];
  /** The replay cursor (a raw event seq), if a ReplayProvider is driving this timeline. */
  currentSeq?: number;
  onSelect?: (seq: number) => void;
}) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  // Read inside the effect without making `items` a dependency — filtering
  // must never trigger a scroll (see below), but the index still has to
  // resolve against whatever's currently visible.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const mounted = useRef(false);

  useEffect(() => {
    // Skip the mount run: currentSeq starts at 0 on every page load, and
    // immediately centering row 0 would yank the viewport away from the top
    // the instant someone lands on the page. Only scroll in response to an
    // actual navigation from here on.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (currentSeq === undefined) return;
    const index = indexForSeq(itemsRef.current, currentSeq);
    if (index >= 0) {
      virtuosoRef.current?.scrollToIndex({ index, align: "center", behavior: "smooth" });
    }
    // Deliberately just `[currentSeq]`: toggling a filter changes `items`
    // (and remounts Virtuoso below) without moving the cursor, and that must
    // not trigger a scroll — the whole point of a filter chip is to reshape
    // what's on screen without also hijacking where the user is looking.
  }, [currentSeq]);

  // Resolved once here rather than per-row: rows can have overlapping ranges
  // (parallel tool calls), so each row deciding "am I active" independently
  // off its own range can make several of them true at once. Exactly one
  // index — or none — is ever active.
  const activeIndex = useMemo(
    () => (currentSeq !== undefined ? exactIndexForSeq(items, currentSeq) : -1),
    [items, currentSeq],
  );

  if (items.length === 0) return <p className="muted">No events recorded for this session.</p>;

  return (
    <Virtuoso
      // Filtering can shrink `items` between renders. Virtuoso's internal
      // range tracking doesn't reliably re-clamp to a shorter list on its own
      // (most visible without a real ResizeObserver, e.g. under jsdom in
      // tests) and ends up indexing past the new end. Keying on the count
      // forces a clean remount whenever the visible set changes size, so
      // there's never stale range state to index out of bounds against.
      key={items.length}
      ref={virtuosoRef}
      useWindowScroll
      data={items}
      computeItemKey={(_, item) => itemKey(item)}
      itemContent={(index, item) => (
        <TimelineRow item={item} index={index} activeIndex={activeIndex} currentSeq={currentSeq} onSelect={onSelect} />
      )}
      initialItemCount={Math.min(items.length, 15)}
    />
  );
}
