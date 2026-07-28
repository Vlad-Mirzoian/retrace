import type { RetraceEvent } from "retrace-core/browser";
import { summarize } from "retrace-core/browser";
import type { ReactNode } from "react";
import { Collapsible, JsonBlock } from "./primitives.js";

export function formatTime(ts: string): string {
  return ts.replace(/^.*T/, "").replace(/\.\d+Z?$/, "");
}

export function Card({
  kind,
  ts,
  title,
  children,
  tone,
}: {
  kind: string;
  ts: string;
  title?: ReactNode;
  children?: ReactNode;
  tone?: "error";
}) {
  return (
    <article className={`card card-kind-${kind}${tone ? ` card-${tone}` : ""}`}>
      <header className="card-head">
        <span className={`kind kind-${kind}`}>{kind}</span>
        {title && <span className="card-title">{title}</span>}
        <time className="card-time">{formatTime(ts)}</time>
      </header>
      {children && <div className="card-body">{children}</div>}
    </article>
  );
}

export function PromptCard({ event }: { event: Extract<RetraceEvent, { kind: "user_prompt" }> }) {
  return (
    <Card kind="user" ts={event.ts}>
      <p className="prompt-text">{event.payload.text}</p>
    </Card>
  );
}

export function AssistantCard({
  event,
}: {
  event: Extract<RetraceEvent, { kind: "assistant_text" }>;
}) {
  return (
    <Card kind="assistant" ts={event.ts} title={event.payload.model}>
      <p className="assistant-text">{event.payload.text}</p>
    </Card>
  );
}

/**
 * Reasoning is by far the highest-volume event kind, so it stays collapsed
 * until asked for — with a one-line preview to keep the timeline scannable.
 */
export function ThinkingCard({ event }: { event: Extract<RetraceEvent, { kind: "thinking" }> }) {
  return (
    <Card kind="thinking" ts={event.ts}>
      <Collapsible label={<span className="thinking-preview">{summarize(event)}</span>}>
        <p className="thinking-text">{event.payload.text}</p>
      </Collapsible>
    </Card>
  );
}

/** Fallback for kinds without a bespoke card (session boundaries, meta, errors). */
export function GenericCard({ event }: { event: RetraceEvent }) {
  const isError = event.kind === "error";
  const summary = summarize(event);
  return (
    <Card
      kind={event.kind}
      ts={event.ts}
      title={summary || undefined}
      tone={isError ? "error" : undefined}
    >
      {"payload" in event && Object.keys(event.payload).length > 0 && (
        <JsonBlock value={event.payload} label="details" />
      )}
    </Card>
  );
}
