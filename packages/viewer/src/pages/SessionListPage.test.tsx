import type { SessionRow } from "retrace-core/browser";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import * as client from "../api/client.js";
import { SessionListPage } from "./SessionListPage.js";

vi.mock("../api/client.js");

function session(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "sess-1234567890",
    project: "my-project",
    cwd: "/repo",
    gitBranch: "main",
    ccVersion: "2.1.181",
    permissionMode: "default",
    title: "Fix the login bug",
    startedAt: "2026-07-15T14:37:00.000Z",
    endedAt: null,
    eventCount: 42,
    toolCallCount: 12,
    ...overrides,
  };
}

describe("SessionListPage", () => {
  it("shows a loading state, then renders sessions once loaded", async () => {
    vi.mocked(client.listSessions).mockResolvedValue([session()]);
    render(
      <MemoryRouter>
        <SessionListPage />
      </MemoryRouter>,
    );

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(await screen.findByText("my-project")).toBeInTheDocument();
    expect(screen.getByText("Fix the login bug")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("links each row to its session detail page", async () => {
    vi.mocked(client.listSessions).mockResolvedValue([session()]);
    render(
      <MemoryRouter>
        <SessionListPage />
      </MemoryRouter>,
    );

    const link = await screen.findByRole("link", { name: "my-project" });
    expect(link).toHaveAttribute("href", "/sessions/sess-1234567890");
  });

  it("shows a friendly empty state", async () => {
    vi.mocked(client.listSessions).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <SessionListPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/no sessions recorded yet/i)).toBeInTheDocument();
  });

  it("shows an error message when the request fails", async () => {
    vi.mocked(client.listSessions).mockRejectedValue(new Error("network down"));
    render(
      <MemoryRouter>
        <SessionListPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/failed to load sessions: network down/i)).toBeInTheDocument();
  });
});
