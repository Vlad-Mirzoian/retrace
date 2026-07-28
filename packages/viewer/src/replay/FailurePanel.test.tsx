import type { RetraceEvent } from "retrace-core/browser";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { FailurePanel } from "./FailurePanel.js";
import { ReplayProvider, useReplay } from "./ReplayContext.js";

function base(seq: number) {
  return { seq, ts: "2026-07-15T14:37:00.000Z", sessionId: "s", prevHash: null, hash: `h${seq}` };
}

const events: RetraceEvent[] = [
  {
    ...base(0),
    kind: "tool_call",
    payload: { toolName: "Bash", toolUseId: "t1", input: { command: "false" } },
  } as RetraceEvent,
  {
    ...base(1),
    kind: "tool_result",
    payload: { toolUseId: "t1", output: "boom", isError: true },
  } as RetraceEvent,
  { ...base(2), kind: "assistant_text", payload: { text: "trying again" } } as RetraceEvent,
  { ...base(3), kind: "error", payload: { message: "top-level failure" } } as RetraceEvent,
];

function CurrentSeq() {
  const { currentSeq } = useReplay();
  return <span data-testid="seq">{currentSeq}</span>;
}

/** Simulates something *other* than this panel moving the shared replay cursor — a click elsewhere in the sidebar, a timeline row, a replay-control step. */
function JumpElsewhere({ seq }: { seq: number }) {
  const { setCurrentSeq } = useReplay();
  return (
    <button type="button" onClick={() => setCurrentSeq(seq)}>
      jump elsewhere
    </button>
  );
}

function renderPanel(fixture: RetraceEvent[] = events, extra?: ReactNode) {
  render(
    <ReplayProvider maxSeq={3}>
      <CurrentSeq />
      {extra}
      <FailurePanel events={fixture} />
    </ReplayProvider>,
  );
}

describe("FailurePanel", () => {
  it("shows a friendly message when there are no failures", () => {
    renderPanel([{ ...base(0), kind: "user_prompt", payload: { text: "hi" } } as RetraceEvent]);
    expect(screen.getByText(/no failures recorded/i)).toBeInTheDocument();
  });

  it("lists every failure (error events and failed tool results) with seq and summary", () => {
    renderPanel();
    expect(screen.getByText("seq 1")).toBeInTheDocument();
    expect(screen.getByText("seq 3")).toBeInTheDocument();
    expect(screen.getByText("top-level failure")).toBeInTheDocument();
  });

  it("jumps the replay cursor to the first failure", () => {
    renderPanel();
    fireEvent.click(screen.getByText(/jump to first failure/i));
    expect(screen.getByTestId("seq")).toHaveTextContent("1");
  });

  it("reports the total failure count on the jump-to-first button", () => {
    renderPanel();
    expect(screen.getByText(/jump to first failure \(2 total\)/i)).toBeInTheDocument();
  });

  it("jumps to whichever specific failure is clicked", () => {
    renderPanel();
    fireEvent.click(screen.getByText("top-level failure"));
    expect(screen.getByTestId("seq")).toHaveTextContent("3");
  });

  it("shows the causal trace (originating tool call) for a selected tool failure", () => {
    renderPanel();
    fireEvent.click(screen.getByText("seq 1"));
    expect(screen.getByText(/why did this happen/i)).toBeInTheDocument();
    expect(screen.getByText("Bash")).toBeInTheDocument();
  });

  it("shows a fallback message for a failure the schema can't link to a tool call", () => {
    renderPanel();
    fireEvent.click(screen.getByText("top-level failure"));
    expect(screen.getByText(/no originating tool call recorded/i)).toBeInTheDocument();
  });

  it("does not show a causal trace before any failure is selected", () => {
    renderPanel();
    expect(screen.queryByText(/why did this happen/i)).not.toBeInTheDocument();
  });

  it("clears the selection when the replay cursor moves elsewhere", () => {
    renderPanel(events, <JumpElsewhere seq={2} />);

    const button = screen.getByText("top-level failure").closest("button")!;
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/no originating tool call recorded/i)).toBeInTheDocument();

    // Something else (a Finding, a timeline row, a replay-control step) —
    // anything that moves the shared cursor away from this failure's own
    // seq — must clear this panel's highlight and causal trace along with it.
    fireEvent.click(screen.getByText("jump elsewhere"));
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText(/no originating tool call recorded/i)).not.toBeInTheDocument();
  });
});
