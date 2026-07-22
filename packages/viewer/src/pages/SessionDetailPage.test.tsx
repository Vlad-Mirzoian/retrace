import type { RetraceEvent, SessionRow } from "retrace-core/browser";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import * as client from "../api/client.js";
import { SessionDetailPage } from "./SessionDetailPage.js";

vi.mock("../api/client.js");

const session: SessionRow = {
  id: "sess-1",
  project: "demo",
  cwd: "/repo",
  gitBranch: "main",
  ccVersion: "2.1.181",
  permissionMode: "default",
  title: "Fix the login bug",
  startedAt: "2026-07-15T14:37:00.000Z",
  endedAt: null,
  eventCount: 2,
  toolCallCount: 1,
};

const events: RetraceEvent[] = [
  {
    seq: 0,
    ts: "2026-07-15T14:37:00.000Z",
    sessionId: "sess-1",
    prevHash: null,
    hash: "h0",
    kind: "user_prompt",
    payload: { text: "please fix the login bug" },
  },
  {
    seq: 1,
    ts: "2026-07-15T14:37:01.000Z",
    sessionId: "sess-1",
    prevHash: "h0",
    hash: "h1",
    kind: "tool_call",
    payload: { toolName: "Read", toolUseId: "t1", input: { file_path: "/a.ts" } },
  },
  {
    seq: 2,
    ts: "2026-07-15T14:37:02.000Z",
    sessionId: "sess-1",
    prevHash: "h1",
    hash: "h2",
    kind: "tool_result",
    payload: { toolUseId: "t1", output: "the file body" },
  },
];

function renderAtSession(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/sessions/${id}`]}>
      <Routes>
        <Route path="/sessions/:id" element={<SessionDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SessionDetailPage", () => {
  it("renders the session header and its timeline", async () => {
    vi.mocked(client.getSession).mockResolvedValue(session);
    vi.mocked(client.getAllEvents).mockResolvedValue(events);

    renderAtSession("sess-1");

    expect(await screen.findByRole("heading", { name: "Fix the login bug" })).toBeInTheDocument();
    expect(screen.getByText(/demo/)).toBeInTheDocument();
    expect(await screen.findByText("please fix the login bug")).toBeInTheDocument();
    // The tool call and its result are folded into a single row.
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("the file body")).toBeInTheDocument();
  });

  it("loads the whole session, not just the first page", async () => {
    vi.mocked(client.getSession).mockResolvedValue(session);
    vi.mocked(client.getAllEvents).mockResolvedValue([]);

    renderAtSession("sess-1");

    await screen.findByRole("heading", { name: "Fix the login bug" });
    expect(client.getSession).toHaveBeenCalledWith("sess-1");
    expect(client.getAllEvents).toHaveBeenCalledWith("sess-1");
  });

  it("shows a friendly message when there are no events", async () => {
    vi.mocked(client.getSession).mockResolvedValue(session);
    vi.mocked(client.getAllEvents).mockResolvedValue([]);

    renderAtSession("sess-1");
    expect(await screen.findByText(/no events recorded/i)).toBeInTheDocument();
  });

  it("shows an error when the session fails to load", async () => {
    vi.mocked(client.getSession).mockRejectedValue(new Error("boom"));
    vi.mocked(client.getAllEvents).mockResolvedValue([]);

    renderAtSession("sess-1");
    expect(await screen.findByText(/failed to load session: boom/i)).toBeInTheDocument();
  });

  it("shows an error when the events fail to load", async () => {
    vi.mocked(client.getSession).mockResolvedValue(session);
    vi.mocked(client.getAllEvents).mockRejectedValue(new Error("events exploded"));

    renderAtSession("sess-1");
    expect(await screen.findByText(/failed to load events: events exploded/i)).toBeInTheDocument();
  });

  it("filters the timeline by text search", async () => {
    vi.mocked(client.getSession).mockResolvedValue(session);
    vi.mocked(client.getAllEvents).mockResolvedValue(events);

    renderAtSession("sess-1");
    await screen.findByText("please fix the login bug");
    expect(screen.getByText("Read")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("searchbox"), "login");

    expect(screen.getByText("please fix the login bug")).toBeInTheDocument();
    expect(screen.queryByText("Read")).not.toBeInTheDocument();
    expect(screen.getByText("1 / 3 events")).toBeInTheDocument();
  });

  it("filters the timeline by kind chip", async () => {
    vi.mocked(client.getSession).mockResolvedValue(session);
    vi.mocked(client.getAllEvents).mockResolvedValue(events);

    renderAtSession("sess-1");
    await screen.findByText("please fix the login bug");

    await userEvent.click(screen.getByRole("button", { name: "Tools" }));

    expect(screen.queryByText("Read")).not.toBeInTheDocument();
    expect(screen.getByText("please fix the login bug")).toBeInTheDocument();
  });
});
