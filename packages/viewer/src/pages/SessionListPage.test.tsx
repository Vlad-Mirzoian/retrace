import type { SessionRow } from "retrace-core/browser";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import * as client from "../api/client.js";
import { SessionListPage } from "./SessionListPage.js";

vi.mock("../api/client.js");

function session(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "sess-1234567890",
    // Deliberately mangled, like a real Claude Code project dir — the
    // viewer should prefer cwd's basename ("my-project") for display.
    project: "-home-dev-my-project",
    cwd: "/home/dev/my-project",
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

  describe("search", () => {
    const sessions = [
      session({ id: "sess-a", cwd: "/home/dev/my-project", title: "Fix the login bug", gitBranch: "main" }),
      session({
        id: "sess-b",
        project: "-home-dev-other-app",
        cwd: "/home/dev/other-app",
        title: "Add dark mode",
        gitBranch: "feature/dark-mode",
      }),
    ];

    it("narrows the list to sessions matching the search text", async () => {
      vi.mocked(client.listSessions).mockResolvedValue(sessions);
      render(
        <MemoryRouter>
          <SessionListPage />
        </MemoryRouter>,
      );
      await screen.findByText("my-project");
      expect(screen.getByText("other-app")).toBeInTheDocument();

      await userEvent.type(screen.getByRole("searchbox", { name: /search sessions/i }), "dark mode");

      expect(screen.queryByText("my-project")).not.toBeInTheDocument();
      expect(screen.getByText("other-app")).toBeInTheDocument();
    });

    it("matches on branch name, not just the project label", async () => {
      vi.mocked(client.listSessions).mockResolvedValue(sessions);
      render(
        <MemoryRouter>
          <SessionListPage />
        </MemoryRouter>,
      );
      await screen.findByText("my-project");

      await userEvent.type(screen.getByRole("searchbox", { name: /search sessions/i }), "feature/dark-mode");

      expect(screen.queryByText("my-project")).not.toBeInTheDocument();
      expect(screen.getByText("other-app")).toBeInTheDocument();
    });

    it("is case-insensitive", async () => {
      vi.mocked(client.listSessions).mockResolvedValue(sessions);
      render(
        <MemoryRouter>
          <SessionListPage />
        </MemoryRouter>,
      );
      await screen.findByText("my-project");

      await userEvent.type(screen.getByRole("searchbox", { name: /search sessions/i }), "LOGIN");

      expect(screen.getByText("my-project")).toBeInTheDocument();
      expect(screen.queryByText("other-app")).not.toBeInTheDocument();
    });

    it("shows a friendly message when nothing matches", async () => {
      vi.mocked(client.listSessions).mockResolvedValue(sessions);
      render(
        <MemoryRouter>
          <SessionListPage />
        </MemoryRouter>,
      );
      await screen.findByText("my-project");

      await userEvent.type(screen.getByRole("searchbox", { name: /search sessions/i }), "nonexistent");

      expect(screen.getByText(/no sessions match "nonexistent"/i)).toBeInTheDocument();
    });

    it("shows a matched/total count", async () => {
      vi.mocked(client.listSessions).mockResolvedValue(sessions);
      render(
        <MemoryRouter>
          <SessionListPage />
        </MemoryRouter>,
      );
      await screen.findByText("my-project");
      expect(screen.getByText("2 / 2")).toBeInTheDocument();

      await userEvent.type(screen.getByRole("searchbox", { name: /search sessions/i }), "dark mode");
      expect(screen.getByText("1 / 2")).toBeInTheDocument();
    });
  });
});
