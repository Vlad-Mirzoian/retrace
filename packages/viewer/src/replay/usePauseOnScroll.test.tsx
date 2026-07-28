import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReplayProvider, useReplay } from "./ReplayContext.js";
import { usePauseOnScroll } from "./usePauseOnScroll.js";

function Harness() {
  const { playing, setPlaying } = useReplay();
  usePauseOnScroll();
  return (
    <div>
      <span data-testid="playing">{String(playing)}</span>
      <button onClick={() => setPlaying(true)}>play</button>
    </div>
  );
}

function renderHarness() {
  render(
    <ReplayProvider maxSeq={10}>
      <Harness />
    </ReplayProvider>,
  );
}

describe("usePauseOnScroll", () => {
  it("pauses playback on a wheel event", () => {
    renderHarness();
    fireEvent.click(screen.getByText("play"));
    expect(screen.getByTestId("playing")).toHaveTextContent("true");

    fireEvent.wheel(window);
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
  });

  it("pauses playback on a touchstart event", () => {
    renderHarness();
    fireEvent.click(screen.getByText("play"));

    fireEvent.touchStart(window);
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
  });

  it("does nothing while already paused", () => {
    renderHarness();
    expect(screen.getByTestId("playing")).toHaveTextContent("false");

    fireEvent.wheel(window);
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
  });

  it("stops listening once paused — a later wheel event is a no-op, not an error", () => {
    renderHarness();
    fireEvent.click(screen.getByText("play"));
    fireEvent.wheel(window);
    expect(screen.getByTestId("playing")).toHaveTextContent("false");

    // No crash, no unexpected state change from a second, redundant event.
    fireEvent.wheel(window);
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
  });
});
