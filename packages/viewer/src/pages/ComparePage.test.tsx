import type { RetraceEvent, SessionRow } from "retrace-core/browser";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../api/client.js";
import { ComparePage } from "./ComparePage.js";

vi.mock("../api/client.js");

beforeEach(() => {
  vi.mocked(client.getSession).mockReset();
  vi.mocked(client.getAllEvents).mockReset();
});

function session(id: string, title: string): SessionRow {
  return {
    id,
    project: "demo",
    cwd: "/repo",
    gitBranch: "main",
    ccVersion: "2.1.181",
    permissionMode: "default",
    title,
    startedAt: "2026-07-15T14:37:00.000Z",
    endedAt: null,
    eventCount: 1,
    toolCallCount: 0,
  };
}

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/compare${search}`]}>
      <Routes>
        <Route path="/compare" element={<ComparePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ComparePage", () => {
  it("asks for both session ids when they're missing", () => {
    renderAt("");
    expect(screen.getByText(/provide both sessions to compare/i)).toBeInTheDocument();
    expect(client.getSession).not.toHaveBeenCalled();
    expect(client.getAllEvents).not.toHaveBeenCalled();
  });

  it("asks for both session ids when only one is given", () => {
    renderAt("?a=sess-1");
    expect(screen.getByText(/provide both sessions to compare/i)).toBeInTheDocument();
    expect(client.getSession).not.toHaveBeenCalled();
    expect(client.getAllEvents).not.toHaveBeenCalled();
  });

  it("loads and renders both runs' headers and timelines once ids are given", async () => {
    vi.mocked(client.getSession).mockImplementation((id: string) =>
      Promise.resolve(session(id, id === "sess-1" ? "Run A" : "Run B")),
    );
    const eventsFor = (id: string): RetraceEvent[] => [
      {
        seq: 0,
        ts: "2026-07-15T14:37:00.000Z",
        sessionId: id,
        prevHash: null,
        hash: "h0",
        kind: "user_prompt",
        payload: { text: `hello from ${id}` },
      } as RetraceEvent,
    ];
    vi.mocked(client.getAllEvents).mockImplementation((id: string) => Promise.resolve(eventsFor(id)));

    renderAt("?a=sess-1&b=sess-2");

    expect(await screen.findByText("Run A")).toBeInTheDocument();
    expect(screen.getByText("Run B")).toBeInTheDocument();
    expect(await screen.findByText(/final state diff/i)).toBeInTheDocument();
  });
});
