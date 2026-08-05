import type { RetraceEvent } from "retrace-core/browser";
import { useEffect, useMemo, useState } from "react";
import { useReplay } from "../replay/ReplayContext.js";
import { useClearSelectionOnScroll } from "../replay/useClearSelectionOnScroll.js";
import { usePauseOnScroll } from "../replay/usePauseOnScroll.js";
import { usePlayback } from "../replay/usePlayback.js";
import {
  ALL_FILTER_KINDS,
  countEvents,
  filterItems,
  itemFilterKind,
  type FilterKind,
} from "../timeline/filter.js";
import { FilterBar } from "../timeline/FilterBar.js";
import { groupEvents, leafAt } from "../timeline/grouping.js";
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

  const { currentSeq, setCurrentSeq, setPlaying } = useReplay();
  usePlayback(filteredItems);
  usePauseOnScroll();
  useClearSelectionOnScroll();

  // Clicking a specific row is a manual navigation, same as a replay-control
  // seek or a Findings/Failures click — it should stop auto-play rather than
  // have the next tick immediately override where the user just jumped to.
  function selectSeq(seq: number) {
    setPlaying(false);
    setCurrentSeq(seq);
  }

  // A jump to a specific seq (a failure-panel click, a next-error/next-file
  // button — anything that navigates by seq rather than by visible row) can
  // land on an event the active kind filter is currently hiding. Without
  // this, the cursor would move there while the row itself stays invisible —
  // the side panel shows the right thing, but the timeline can't point at
  // it. Reveal whatever kind the target actually is, leaving every other
  // active chip alone. Deliberately keyed on `currentSeq` alone (not
  // `activeKinds`): this must run because the cursor moved, not because the
  // filter did — the functional updater form reads the latest activeKinds
  // without needing it as a dependency.
  useEffect(() => {
    const leaf = leafAt(groupedItems, currentSeq);
    if (!leaf) return;
    const kind = itemFilterKind(leaf);
    setActiveKinds((prev) => (prev.has(kind) ? prev : new Set(prev).add(kind)));
  }, [currentSeq, groupedItems]);

  return (
    <>
      <FilterBar
        activeKinds={activeKinds}
        onToggle={toggleKind}
        onSetActiveKinds={(kinds) => setActiveKinds(new Set(kinds))}
        search={search}
        onSearchChange={setSearch}
        shown={countEvents(filteredItems)}
        total={events.length}
      />
      <Timeline items={filteredItems} currentSeq={currentSeq} onSelect={selectSeq} />
    </>
  );
}
