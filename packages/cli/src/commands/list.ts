import type { SessionRow } from "@retrace/core";

const MAX_TITLE_LENGTH = 60;

function shortId(id: string): string {
  return id.length > 10 ? id.slice(0, 10) : id;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return "—";
  return ts.replace("T", " ").replace(/\.\d+Z$/, "");
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

interface Column {
  header: string;
  value: (session: SessionRow) => string;
}

const COLUMNS: Column[] = [
  { header: "SESSION", value: (s) => shortId(s.id) },
  { header: "PROJECT", value: (s) => s.project ?? "—" },
  { header: "BRANCH", value: (s) => s.gitBranch ?? "—" },
  { header: "TITLE", value: (s) => truncate(s.title ?? "—", MAX_TITLE_LENGTH) },
  { header: "STARTED", value: (s) => formatTimestamp(s.startedAt) },
  { header: "EVENTS", value: (s) => String(s.eventCount) },
];

/** Render sessions as a simple fixed-width table, in the order given. */
export function formatSessionsTable(sessions: SessionRow[]): string {
  if (sessions.length === 0) {
    return "No sessions recorded yet. Run `retrace import` first.";
  }

  const rows = sessions.map((session) => COLUMNS.map((col) => col.value(session)));
  const widths = COLUMNS.map((col, i) =>
    Math.max(col.header.length, ...rows.map((row) => row[i].length)),
  );
  const formatRow = (cells: string[]) =>
    cells.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd();

  return [formatRow(COLUMNS.map((col) => col.header)), ...rows.map(formatRow)].join("\n");
}
