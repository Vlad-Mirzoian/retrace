import type { RetraceEvent } from "retrace-core/browser";
import { useMemo, useState } from "react";
import { useReplay } from "../replay/ReplayContext.js";
import { usePlayback } from "../replay/usePlayback.js";
import { ALL_FILTER_KINDS, countEvents, filterItems, type FilterKind } from "../timeline/filter.js";
import { FilterBar } from "../timeline/FilterBar.js";
import { groupEvents } from "../timeline/grouping.js";
import { Timeline } from "../timeline/Timeline.js";

/**
 * Filter/search state plus the grouped, filtered timeline for one session's
 * events. Shared between the live SessionDetailPage (fetched over the API)
 * and the standalone export bundle (events embedded at export time). Both
 * callers wrap this in a ReplayProvider — the replay cursor and playback
 * live there, driven here against the *filtered* (currently visible) rows.
 */
export function SessionTimelinePanel({ events }: { events: RetraceEvent[] }) {
  const [activeKinds, setActiveKinds] = useState<Set<FilterKind>>(
    () => new Set(ALL_FILTER_KINDS),
  );
  const [search, setSearch] = useState("");

  function toggleKind(kind: FilterKind) {
    setActiveKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  const groupedItems = useMemo(() => groupEvents(events), [events]);
  const filteredItems = useMemo(
    () => filterItems(groupedItems, activeKinds, search),
    [groupedItems, activeKinds, search],
  );

  const { currentSeq, setCurrentSeq } = useReplay();
  usePlayback(filteredItems);

  return (
    <>
      <FilterBar
        activeKinds={activeKinds}
        onToggle={toggleKind}
        search={search}
        onSearchChange={setSearch}
        shown={countEvents(filteredItems)}
        total={events.length}
      />
      <Timeline items={filteredItems} currentSeq={currentSeq} onSelect={setCurrentSeq} />
    </>
  );
}
