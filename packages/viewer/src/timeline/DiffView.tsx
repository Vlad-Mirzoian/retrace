import { diffLines } from "diff";
import { useMemo } from "react";

type RowType = "add" | "del" | "ctx";

interface Row {
  type: RowType;
  text: string;
}

const MARKERS: Record<RowType, string> = { add: "+", del: "-", ctx: " " };

/** Flatten jsdiff's change chunks into individual, renderable lines. */
export function toDiffRows(oldText: string, newText: string): Row[] {
  const rows: Row[] = [];
  for (const change of diffLines(oldText, newText)) {
    const type: RowType = change.added ? "add" : change.removed ? "del" : "ctx";
    const lines = change.value.split("\n");
    // A trailing newline yields a final empty element that isn't a real line.
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    for (const text of lines) rows.push({ type, text });
  }
  return rows;
}

export function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const rows = useMemo(() => toDiffRows(oldText, newText), [oldText, newText]);

  if (rows.length === 0) return <p className="muted small">(no changes)</p>;

  return (
    <pre className="diff" data-testid="diff">
      {rows.map((row, index) => (
        // Diff rows have no stable identity of their own; index is the identity.
        <div key={index} className={`diff-line diff-${row.type}`}>
          <span className="diff-marker">{MARKERS[row.type]}</span>
          {row.text}
        </div>
      ))}
    </pre>
  );
}
