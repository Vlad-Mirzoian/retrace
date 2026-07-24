import { ALL_FILTER_KINDS, FILTER_KINDS, type FilterKind } from "./filter.js";

export function FilterBar({
  activeKinds,
  onToggle,
  onSetActiveKinds,
  search,
  onSearchChange,
  shown,
  total,
}: {
  activeKinds: ReadonlySet<FilterKind>;
  onToggle: (kind: FilterKind) => void;
  /** Replaces the whole active-kinds set — used by the "Failures only" quick toggle. */
  onSetActiveKinds: (kinds: ReadonlySet<FilterKind>) => void;
  search: string;
  onSearchChange: (value: string) => void;
  shown: number;
  total: number;
}) {
  const failuresOnly = activeKinds.size === 1 && activeKinds.has("error");

  function toggleFailuresOnly() {
    onSetActiveKinds(failuresOnly ? ALL_FILTER_KINDS : new Set(["error"]));
  }

  return (
    <div className="filter-bar">
      <input
        type="search"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search this session…"
        aria-label="Search this session"
        className="filter-search"
      />
      <button
        type="button"
        className={`filter-chip failures-only${failuresOnly ? " active" : ""}`}
        aria-pressed={failuresOnly}
        onClick={toggleFailuresOnly}
      >
        Failures only
      </button>
      <div className="filter-kinds" role="group" aria-label="Filter by event kind">
        {FILTER_KINDS.map(({ value, label }) => {
          const active = activeKinds.has(value);
          return (
            <button
              key={value}
              type="button"
              className={`filter-chip${active ? " active" : ""}`}
              aria-pressed={active}
              onClick={() => onToggle(value)}
            >
              {label}
            </button>
          );
        })}
      </div>
      <span className="filter-count muted small">
        {shown} / {total} events
      </span>
    </div>
  );
}
