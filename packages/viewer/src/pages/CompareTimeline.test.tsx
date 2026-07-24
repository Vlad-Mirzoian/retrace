import type { RetraceEvent } from "retrace-core/browser";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CompareTimeline } from "./CompareTimeline.js";

function base(seq: number) {
  return { seq, ts: "2026-07-15T14:37:00.000Z", sessionId: "s", prevHash: null, hash: `h${seq}` };
}

describe("CompareTimeline", () => {
  it("shows a friendly message when both runs are empty", () => {
    render(<CompareTimeline eventsA={[]} eventsB={[]} />);
    expect(screen.getByText(/nothing to compare/i)).toBeInTheDocument();
  });

  it("renders a matched row for identical prompts in both columns", () => {
    const a: RetraceEvent[] = [
      { ...base(0), kind: "user_prompt", payload: { text: "fix the bug" } } as RetraceEvent,
    ];
    const b: RetraceEvent[] = [
      { ...base(0), kind: "user_prompt", payload: { text: "fix the bug" } } as RetraceEvent,
    ];
    render(<CompareTimeline eventsA={a} eventsB={b} />);
    const texts = screen.getAllByText("fix the bug");
    expect(texts).toHaveLength(2);
    expect(document.querySelector(".compare-row-match")).not.toBeNull();
  });

  it("marks a tool_call with different input as changed, in both columns", () => {
    const a: RetraceEvent[] = [
      {
        ...base(0),
        kind: "tool_call",
        payload: { toolName: "Bash", toolUseId: "t1", input: { command: "ls" } },
      } as RetraceEvent,
    ];
    const b: RetraceEvent[] = [
      {
        ...base(0),
        kind: "tool_call",
        payload: { toolName: "Bash", toolUseId: "t2", input: { command: "pwd" } },
      } as RetraceEvent,
    ];
    render(<CompareTimeline eventsA={a} eventsB={b} />);
    expect(document.querySelector(".compare-row-changed")).not.toBeNull();
    expect(screen.getAllByText("Bash")).toHaveLength(2);
  });

  it("leaves the opposite column blank for an only-a / only-b row", () => {
    const a: RetraceEvent[] = [
      { ...base(0), kind: "user_prompt", payload: { text: "only in a" } } as RetraceEvent,
    ];
    const b: RetraceEvent[] = [];
    render(<CompareTimeline eventsA={a} eventsB={b} />);
    expect(screen.getByText("only in a")).toBeInTheDocument();
    expect(document.querySelector(".compare-row-only-a")).not.toBeNull();
    expect(document.querySelector(".compare-cell-empty")).not.toBeNull();
  });
});
