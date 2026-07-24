import { useEffect, useState, type ReactNode } from "react";

/** Text longer than this is hidden behind a toggle rather than shown inline. */
const INLINE_LIMIT = 600;

export function Collapsible({
  label,
  children,
  defaultOpen = false,
  forceOpen,
}: {
  label: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /**
   * When this becomes true, opens the section (e.g. the replay cursor
   * entering a subagent's range) without overriding a manual close — it only
   * ever pushes `open` to true, never back to false.
   */
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  return (
    <div className="collapsible">
      <button
        type="button"
        className="collapsible-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="chevron">{open ? "▾" : "▸"}</span> {label}
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}

function formatSize(chars: number): string {
  return chars < 1024 ? `${chars} chars` : `${(chars / 1024).toFixed(1)} KB`;
}

/**
 * Render text, collapsing anything long behind a toggle. Sessions routinely
 * carry multi-KB tool outputs; inlining them all would bury the narrative.
 */
export function CodeBlock({ text, label = "output" }: { text: string; label?: string }) {
  if (!text) return <p className="muted small">(empty)</p>;
  if (text.length <= INLINE_LIMIT) return <pre className="code">{text}</pre>;

  return (
    <Collapsible label={`${label} · ${formatSize(text.length)}`}>
      <pre className="code">{text}</pre>
    </Collapsible>
  );
}

/** Same as CodeBlock, but pretty-prints arbitrary JSON values. */
export function JsonBlock({ value, label = "input" }: { value: unknown; label?: string }) {
  if (value === undefined || value === null) return <p className="muted small">(none)</p>;
  return <CodeBlock text={JSON.stringify(value, null, 2)} label={label} />;
}
