import type { RetraceEvent, SessionRow } from "retrace-core/browser";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../api/client.js";
import { SessionDetailPage } from "./SessionDetailPage.js";

vi.mock("../api/client.js");

const session: SessionRow = {
  id: "sess-1",
  project: "demo",
  cwd: "/work/demo",
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

beforeEach(() => {
  vi.mocked(client.getVerification).mockResolvedValue({ ok: true });
});

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

  it("shows the findings panel's empty state (naming the rule count) for a session with no findings", async () => {
    vi.mocked(client.getSession).mockResolvedValue(session);
    vi.mocked(client.getAllEvents).mockResolvedValue(events);

    renderAtSession("sess-1");
    await screen.findByText("please fix the login bug");

    expect(screen.getByText(/no findings — \d+ rule\(s\) run\./i)).toBeInTheDocument();
  });

  it("shows real findings in the panel when the session's events warrant one", async () => {
    const eventsWithBlindEdit: RetraceEvent[] = [
      ...events,
      {
        seq: 3,
        ts: "2026-07-15T14:37:03.000Z",
        sessionId: "sess-1",
        prevHash: "h2",
        hash: "h3",
        kind: "file_change",
        payload: { path: "/repo/b.ts", operation: "edit", oldString: "x", newString: "y" },
      },
    ];
    vi.mocked(client.getSession).mockResolvedValue(session);
    vi.mocked(client.getAllEvents).mockResolvedValue(eventsWithBlindEdit);

    renderAtSession("sess-1");
    await screen.findByText("please fix the login bug");

    expect(screen.getByText(/edited without being read/i)).toBeInTheDocument();
    expect(screen.queryByText(/no findings/i)).not.toBeInTheDocument();
  });

  it("re-enables the Errors chip when jumping to a failure the filter is currently hiding", async () => {
    const withFailure: RetraceEvent[] = [
      ...events,
      {
        seq: 3,
        ts: "2026-07-15T14:37:03.000Z",
        sessionId: "sess-1",
        prevHash: "h2",
        hash: "h3",
        kind: "tool_call",
        payload: { toolName: "Bash", toolUseId: "t2", input: { command: "false" } },
      },
      {
        seq: 4,
        ts: "2026-07-15T14:37:04.000Z",
        sessionId: "sess-1",
        prevHash: "h3",
        hash: "h4",
        kind: "tool_result",
        payload: { toolUseId: "t2", output: "command failed", isError: true },
      },
    ];
    vi.mocked(client.getSession).mockResolvedValue(session);
    vi.mocked(client.getAllEvents).mockResolvedValue(withFailure);

    renderAtSession("sess-1");
    await screen.findByText("please fix the login bug");

    const errorsChip = screen.getByRole("button", { name: "Errors" });
    await userEvent.click(errorsChip); // hide errors — reproduces the reported bug setup
    expect(errorsChip).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("command failed")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /jump to first failure/i }));

    // The chip comes back on its own, and the failing row is now actually
    // visible in the *timeline* — not just referenced by the (unfiltered)
    // causal trace in the side panel while the timeline scrolls toward a row
    // that isn't there. Scoped to the main column: the same text also
    // legitimately appears in the causal trace next to it.
    expect(errorsChip).toHaveAttribute("aria-pressed", "true");
    const mainColumn = document.querySelector<HTMLElement>(".session-column-main");
    expect(mainColumn).not.toBeNull();
    expect(within(mainColumn!).getByText("command failed")).toBeInTheDocument();
  });
});
