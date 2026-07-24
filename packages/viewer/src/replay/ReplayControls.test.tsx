import { buildNavIndex, type RetraceEvent } from "retrace-core/browser";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReplayControls } from "./ReplayControls.js";
import { ReplayProvider, useReplay } from "./ReplayContext.js";

function base(seq: number) {
  return {
    seq,
    ts: "2026-07-15T14:37:00.000Z",
    sessionId: "s",
    prevHash: null,
    hash: `h${seq}`,
  };
}

const events: RetraceEvent[] = [
  { ...base(0), kind: "user_prompt", payload: { text: "go" } } as RetraceEvent,
  {
    ...base(1),
    kind: "tool_result",
    payload: { toolUseId: "t1", output: "boom", isError: true },
  } as RetraceEvent,
  {
    ...base(2),
    kind: "file_change",
    payload: { path: "a.txt", operation: "create", afterRef: "h1" },
  } as RetraceEvent,
  { ...base(3), kind: "assistant_text", payload: { text: "done" } } as RetraceEvent,
];

function CurrentSeq() {
  const { currentSeq, playing } = useReplay();
  return (
    <span data-testid="state">
      {currentSeq}/{String(playing)}
    </span>
  );
}

function renderControls() {
  const navIndex = buildNavIndex(events);
  const maxSeq = events[events.length - 1].seq;
  render(
    <ReplayProvider maxSeq={maxSeq}>
      <ReplayControls navIndex={navIndex} />
      <CurrentSeq />
    </ReplayProvider>,
  );
}

describe("ReplayControls", () => {
  it("starts at seq 0 with back/first controls disabled", () => {
    renderControls();
    expect(screen.getByTestId("state")).toHaveTextContent("0/false");
    expect(screen.getByLabelText("First step")).toBeDisabled();
    expect(screen.getByLabelText("Step back")).toBeDisabled();
    expect(screen.getByLabelText("Last step")).not.toBeDisabled();
  });

  it("steps forward and back by one raw seq", () => {
    renderControls();
    fireEvent.click(screen.getByLabelText("Step forward"));
    expect(screen.getByTestId("state")).toHaveTextContent("1/false");
    fireEvent.click(screen.getByLabelText("Step back"));
    expect(screen.getByTestId("state")).toHaveTextContent("0/false");
  });

  it("jumps to the last step and disables forward controls there", () => {
    renderControls();
    fireEvent.click(screen.getByLabelText("Last step"));
    expect(screen.getByTestId("state")).toHaveTextContent("3/false");
    expect(screen.getByLabelText("Step forward")).toBeDisabled();
    expect(screen.getByLabelText("Last step")).toBeDisabled();
  });

  it("jumps to the next/previous error", () => {
    renderControls();
    fireEvent.click(screen.getByLabelText("Next error"));
    expect(screen.getByTestId("state")).toHaveTextContent("1/false");
    fireEvent.click(screen.getByLabelText("Last step"));
    fireEvent.click(screen.getByLabelText("Previous error"));
    expect(screen.getByTestId("state")).toHaveTextContent("1/false");
  });

  it("jumps to the next file change", () => {
    renderControls();
    fireEvent.click(screen.getByLabelText("Next file change"));
    expect(screen.getByTestId("state")).toHaveTextContent("2/false");
  });

  it("moves the scrubber directly to a position", () => {
    renderControls();
    fireEvent.change(screen.getByLabelText("Replay position"), { target: { value: "3" } });
    expect(screen.getByTestId("state")).toHaveTextContent("3/false");
  });

  it("toggles play/pause", () => {
    renderControls();
    fireEvent.click(screen.getByLabelText("Play"));
    expect(screen.getByTestId("state")).toHaveTextContent("0/true");
    fireEvent.click(screen.getByLabelText("Pause"));
    expect(screen.getByTestId("state")).toHaveTextContent("0/false");
  });

  it("stops playback when a manual step is taken mid-playback", () => {
    renderControls();
    fireEvent.click(screen.getByLabelText("Play"));
    expect(screen.getByTestId("state")).toHaveTextContent("0/true");
    fireEvent.click(screen.getByLabelText("Step forward"));
    expect(screen.getByTestId("state")).toHaveTextContent("1/false");
  });

  it("changes the playback speed", () => {
    renderControls();
    fireEvent.change(screen.getByLabelText("Playback speed"), { target: { value: "4" } });
    expect(screen.getByLabelText("Playback speed")).toHaveValue("4");
  });
});
