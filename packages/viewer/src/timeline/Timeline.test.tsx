import type { RetraceEvent } from "retrace-core/browser";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { groupEvents } from "./grouping.js";
import { Timeline } from "./Timeline.js";

let seq = 0;
function base() {
  return {
    seq: seq++,
    ts: "2026-07-15T14:37:00.000Z",
    sessionId: "s",
    prevHash: null,
    hash: `h${seq}`,
  };
}

const prompt = (text: string, sidechain?: true): RetraceEvent =>
  ({ ...base(), sidechain, kind: "user_prompt", payload: { text } }) as RetraceEvent;

const assistant = (text: string): RetraceEvent =>
  ({ ...base(), kind: "assistant_text", payload: { text, model: "claude-sonnet-4-6" } }) as RetraceEvent;

const thinking = (text: string): RetraceEvent =>
  ({ ...base(), kind: "thinking", payload: { text } }) as RetraceEvent;

function renderTimeline(events: RetraceEvent[]) {
  return render(<Timeline items={groupEvents(events)} />);
}

describe("Timeline", () => {
  it("shows an empty state when there is nothing to render", () => {
    render(<Timeline items={[]} />);
    expect(screen.getByText(/no events recorded/i)).toBeInTheDocument();
  });

  it("renders prompts and assistant replies as cards", () => {
    renderTimeline([prompt("fix the bug"), assistant("on it")]);
    expect(screen.getByText("fix the bug")).toBeInTheDocument();
    expect(screen.getByText("on it")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument();
  });

  it("keeps reasoning collapsed until it is asked for", async () => {
    const reasoning = "the user wants X, so I should do Y";
    renderTimeline([thinking(reasoning)]);

    const toggle = screen.getByRole("button", { name: new RegExp(reasoning.slice(0, 20), "i") });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("collapses a subagent branch into one group, expandable on click", async () => {
    renderTimeline([
      prompt("main branch work"),
      prompt("subagent work", true),
      prompt("more subagent work", true),
    ]);

    // The subagent's events are hidden behind the group toggle.
    expect(screen.getByText("main branch work")).toBeInTheDocument();
    expect(screen.queryByText("subagent work")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /subagent · 2 event/i });
    await userEvent.click(toggle);

    expect(screen.getByText("subagent work")).toBeInTheDocument();
    expect(screen.getByText("more subagent work")).toBeInTheDocument();
  });

  describe("replay cursor", () => {
    it("highlights the row matching currentSeq and calls onSelect on click", async () => {
      const first = prompt("first");
      const second = prompt("second");
      const items = groupEvents([first, second]);
      const onSelect = vi.fn();

      render(<Timeline items={items} currentSeq={second.seq} onSelect={onSelect} />);

      const secondRow = screen.getByText("second").closest(".timeline-row");
      const firstRow = screen.getByText("first").closest(".timeline-row");
      expect(secondRow).toHaveClass("active");
      expect(firstRow).not.toHaveClass("active");

      await userEvent.click(screen.getByText("first"));
      expect(onSelect).toHaveBeenCalledWith(first.seq);
    });

    it("marks a tool row active for any seq within its call..result span", () => {
      const call = { ...base(), kind: "tool_call", payload: { toolName: "Bash", toolUseId: "t1", input: {} } } as RetraceEvent;
      const result = { ...base(), kind: "tool_result", payload: { toolUseId: "t1", output: "ok" } } as RetraceEvent;
      const items = groupEvents([call, result]);

      render(<Timeline items={items} currentSeq={result.seq} onSelect={() => {}} />);

      expect(screen.getByText("Bash").closest(".timeline-row")).toHaveClass("active");
    });

    it("auto-expands a subagent group when the cursor lands inside its range", () => {
      const sub1 = prompt("sub work", true);
      const sub2 = prompt("more sub work", true);
      const items = groupEvents([prompt("main"), sub1, sub2]);

      render(<Timeline items={items} currentSeq={sub2.seq} onSelect={() => {}} />);

      // No click on the group toggle — it opened itself because the cursor
      // (sub2's seq) falls inside this subagent's [sub1..sub2] range.
      expect(screen.getByText("more sub work")).toBeInTheDocument();
    });

    it("does not highlight or expand anything when no cursor is provided", () => {
      const items = groupEvents([prompt("main"), prompt("sub work", true)]);
      render(<Timeline items={items} />);
      expect(screen.queryByText("sub work")).not.toBeInTheDocument();
      expect(document.querySelector(".timeline-row.active")).toBeNull();
    });
  });
});
