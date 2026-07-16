import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getAllEvents, getSession } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { ALL_FILTER_KINDS, countEvents, filterItems, type FilterKind } from "../timeline/filter.js";
import { FilterBar } from "../timeline/FilterBar.js";
import { groupEvents } from "../timeline/grouping.js";
import { Timeline } from "../timeline/Timeline.js";

export function SessionDetailPage() {
  const { id = "" } = useParams();
  const session = useAsync(() => getSession(id), [id]);
  const events = useAsync(() => getAllEvents(id), [id]);

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

  const groupedItems = useMemo(
    () => (events.status === "ready" ? groupEvents(events.data) : []),
    [events],
  );
  const filteredItems = useMemo(
    () => filterItems(groupedItems, activeKinds, search),
    [groupedItems, activeKinds, search],
  );

  return (
    <div className="page">
      <p>
        <Link to="/">← Sessions</Link>
      </p>

      {session.status === "loading" && <p className="muted">Loading…</p>}
      {session.status === "error" && (
        <p className="error">Failed to load session: {session.error.message}</p>
      )}
      {session.status === "ready" && (
        <>
          <h1>{session.data.title ?? session.data.id}</h1>
          <p className="muted">
            {session.data.project ?? "—"} · {session.data.gitBranch ?? "—"} ·{" "}
            {session.data.eventCount} events
          </p>
        </>
      )}

      {events.status === "loading" && <p className="muted">Loading events…</p>}
      {events.status === "error" && (
        <p className="error">Failed to load events: {events.error.message}</p>
      )}
      {events.status === "ready" && (
        <>
          <FilterBar
            activeKinds={activeKinds}
            onToggle={toggleKind}
            search={search}
            onSearchChange={setSearch}
            shown={countEvents(filteredItems)}
            total={events.data.length}
          />
          <Timeline items={filteredItems} />
        </>
      )}
    </div>
  );
}
