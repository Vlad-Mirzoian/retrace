import type { RetraceEvent } from "@retrace/core/browser";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
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
});
