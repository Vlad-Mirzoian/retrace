import { Virtuoso } from "react-virtuoso";
import { AssistantCard, GenericCard, PromptCard, ThinkingCard } from "./cards.js";
import { FileChangeCard } from "./FileChangeCard.js";
import { itemKey, type LeafItem, type TimelineItem } from "./grouping.js";
import { Collapsible } from "./primitives.js";
import { ToolCallCard } from "./ToolCallCard.js";

function LeafRow({ item }: { item: LeafItem }) {
  if (item.kind === "tool") {
    return <ToolCallCard call={item.call} result={item.result} />;
  }

  const { event } = item;
  switch (event.kind) {
    case "user_prompt":
      return <PromptCard event={event} />;
    case "assistant_text":
      return <AssistantCard event={event} />;
    case "thinking":
      return <ThinkingCard event={event} />;
    case "file_change":
      return <FileChangeCard event={event} />;
    default:
      return <GenericCard event={event} />;
  }
}

function SubagentGroup({ items }: { items: LeafItem[] }) {
  return (
    <div className="subagent">
      <Collapsible label={`Subagent · ${items.length} event(s)`}>
        <div className="subagent-body">
          {items.map((item) => (
            <LeafRow key={itemKey(item)} item={item} />
          ))}
        </div>
      </Collapsible>
    </div>
  );
}

export function TimelineRow({ item }: { item: TimelineItem }) {
  if (item.kind === "subagent") return <SubagentGroup items={item.items} />;
  return <LeafRow item={item} />;
}

export function Timeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) return <p className="muted">No events recorded for this session.</p>;

  return (
    <Virtuoso
      useWindowScroll
      data={items}
      computeItemKey={(_, item) => itemKey(item)}
      itemContent={(_, item) => <TimelineRow item={item} />}
      // Render a first screenful without measuring, so the timeline paints
      // immediately (and renders in non-layout environments such as tests).
      initialItemCount={Math.min(items.length, 15)}
    />
  );
}
