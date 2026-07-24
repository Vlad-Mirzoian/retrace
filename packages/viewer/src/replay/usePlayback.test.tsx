import type { RetraceEvent } from "retrace-core/browser";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groupEvents, itemKey, type TimelineItem } from "../timeline/grouping.js";
import { ReplayProvider, useReplay } from "./ReplayContext.js";
import { BASE_INTERVAL_MS, usePlayback } from "./usePlayback.js";

let seq = 0;
function prompt(text: string): RetraceEvent {
  return {
    seq: seq++,
    ts: "2026-07-15T14:37:00.000Z",
    sessionId: "s",
    prevHash: null,
    hash: `h${seq}`,
    kind: "user_prompt",
    payload: { text },
  } as RetraceEvent;
}

function Harness({ items }: { items: TimelineItem[] }) {
  const { currentSeq, playing, setPlaying } = useReplay();
  usePlayback(items);
  return (
    <div>
      <span data-testid="seq">{currentSeq}</span>
      <span data-testid="playing">{String(playing)}</span>
      <button onClick={() => setPlaying(true)}>play</button>
      <button onClick={() => setPlaying(false)}>pause</button>
    </div>
  );
}

function renderHarness(events: RetraceEvent[]) {
  const items = groupEvents(events);
  const maxSeq = items.length > 0 ? itemKey(items[items.length - 1]) : 0;
  render(
    <ReplayProvider maxSeq={maxSeq}>
      <Harness items={items} />
    </ReplayProvider>,
  );
}

beforeEach(() => {
  seq = 0; // events start at seq 0 in every test, matching a real session's invariant
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("usePlayback", () => {
  it("advances the cursor one row per tick while playing", () => {
    const events = [prompt("a"), prompt("b"), prompt("c")];
    renderHarness(events);

    fireEvent.click(screen.getByText("play"));
    expect(screen.getByTestId("seq")).toHaveTextContent("0");

    act(() => vi.advanceTimersByTime(BASE_INTERVAL_MS));
    expect(screen.getByTestId("seq")).toHaveTextContent(String(events[1].seq));

    act(() => vi.advanceTimersByTime(BASE_INTERVAL_MS));
    expect(screen.getByTestId("seq")).toHaveTextContent(String(events[2].seq));
  });

  it("pauses automatically once the last row is reached", () => {
    const events = [prompt("a"), prompt("b")];
    renderHarness(events);

    fireEvent.click(screen.getByText("play"));
    act(() => vi.advanceTimersByTime(BASE_INTERVAL_MS)); // -> last row
    expect(screen.getByTestId("seq")).toHaveTextContent(String(events[1].seq));
    expect(screen.getByTestId("playing")).toHaveTextContent("true");

    act(() => vi.advanceTimersByTime(BASE_INTERVAL_MS)); // nothing left to advance to
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
    expect(screen.getByTestId("seq")).toHaveTextContent(String(events[1].seq));
  });

  it("steps onto the next visible row when the cursor sits in a filtered-out gap", () => {
    // What SessionTimelinePanel hands usePlayback is the *filtered* list, so
    // the cursor can legitimately point at an event no row covers. The first
    // tick has to land on the next visible row, not skip over it.
    const events = [prompt("a"), prompt("b"), prompt("c")];
    const visible = groupEvents([events[2]]); // events 0 and 1 filtered out
    render(
      <ReplayProvider maxSeq={events[2].seq}>
        <Harness items={visible} />
      </ReplayProvider>,
    );

    fireEvent.click(screen.getByText("play"));
    act(() => vi.advanceTimersByTime(BASE_INTERVAL_MS));
    expect(screen.getByTestId("seq")).toHaveTextContent(String(events[2].seq));

    act(() => vi.advanceTimersByTime(BASE_INTERVAL_MS));
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
  });

  it("does nothing while paused", () => {
    const events = [prompt("a"), prompt("b")];
    renderHarness(events);

    act(() => vi.advanceTimersByTime(BASE_INTERVAL_MS * 3));
    expect(screen.getByTestId("seq")).toHaveTextContent("0");
  });

  it("stops ticking once paused mid-flight", () => {
    const events = [prompt("a"), prompt("b"), prompt("c")];
    renderHarness(events);

    fireEvent.click(screen.getByText("play"));
    act(() => vi.advanceTimersByTime(BASE_INTERVAL_MS));
    expect(screen.getByTestId("seq")).toHaveTextContent(String(events[1].seq));

    fireEvent.click(screen.getByText("pause"));
    act(() => vi.advanceTimersByTime(BASE_INTERVAL_MS * 5));
    expect(screen.getByTestId("seq")).toHaveTextContent(String(events[1].seq));
  });
});
