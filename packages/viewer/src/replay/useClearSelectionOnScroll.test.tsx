import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReplayProvider, useReplay } from "./ReplayContext.js";
import { useClearSelectionOnScroll } from "./useClearSelectionOnScroll.js";

function Harness() {
  const { selectionSuppressed, setCurrentSeq } = useReplay();
  useClearSelectionOnScroll();
  return (
    <div>
      <span data-testid="suppressed">{String(selectionSuppressed)}</span>
      <button onClick={() => setCurrentSeq(1)}>seek</button>
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

describe("useClearSelectionOnScroll", () => {
  it("suppresses selection on a wheel event", () => {
    renderHarness();
    expect(screen.getByTestId("suppressed")).toHaveTextContent("false");

    fireEvent.wheel(window);
    expect(screen.getByTestId("suppressed")).toHaveTextContent("true");
  });

  it("suppresses selection on a touchstart event", () => {
    renderHarness();

    fireEvent.touchStart(window);
    expect(screen.getByTestId("suppressed")).toHaveTextContent("true");
  });

  it("un-suppresses on the next seek", () => {
    renderHarness();
    fireEvent.wheel(window);
    expect(screen.getByTestId("suppressed")).toHaveTextContent("true");

    fireEvent.click(screen.getByText("seek"));
    expect(screen.getByTestId("suppressed")).toHaveTextContent("false");
  });
});
