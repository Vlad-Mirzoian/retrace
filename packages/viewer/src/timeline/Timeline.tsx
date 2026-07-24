import type { RetraceEvent } from "retrace-core/browser";
import { useEffect, useRef, type ReactNode } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { AssistantCard, GenericCard, PromptCard, ThinkingCard } from "./cards.js";
import { FileChangeCard } from "./FileChangeCard.js";
import { indexForSeq, itemKey, itemRange, type LeafItem, type TimelineItem } from "./grouping.js";
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

function LeafRow({ item, currentSeq, onSelect }: RowProps & { item: LeafItem }) {
  const active = currentSeq !== undefined && contains(item, currentSeq);
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

  return (
    <div className="subagent">
      <Collapsible label={`Subagent · ${items.length} event(s)`} forceOpen={cursorInside}>
        <div className="subagent-body">
          {items.map((item) => (
            <LeafRow key={itemKey(item)} item={item} currentSeq={currentSeq} onSelect={onSelect} />
          ))}
        </div>
      </Collapsible>
    </div>
  );
}

export function TimelineRow({ item, currentSeq, onSelect }: RowProps & { item: TimelineItem }) {
  if (item.kind === "subagent") {
    return <SubagentGroup items={item.items} currentSeq={currentSeq} onSelect={onSelect} />;
  }
  return <LeafRow item={item} currentSeq={currentSeq} onSelect={onSelect} />;
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

  useEffect(() => {
    if (currentSeq === undefined) return;
    const index = indexForSeq(items, currentSeq);
    if (index >= 0) {
      virtuosoRef.current?.scrollToIndex({ index, align: "center", behavior: "smooth" });
    }
    // Re-runs after the `key={items.length}` remount below (a new Virtuoso
    // instance re-attaches the ref) — that's intentional: the cursor's index
    // needs re-resolving against whatever set of rows is now visible.
  }, [currentSeq, items]);

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
      itemContent={(_, item) => <TimelineRow item={item} currentSeq={currentSeq} onSelect={onSelect} />}
      initialItemCount={Math.min(items.length, 15)}
    />
  );
}
