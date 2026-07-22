import type { SessionRow } from "retrace-core";
import { describe, expect, it } from "vitest";
import { formatSessionsTable } from "./list.js";

function session(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "sess-1234567890",
    project: "my-project",
    cwd: "/repo",
    gitBranch: "main",
    ccVersion: "2.1.181",
    permissionMode: "default",
    title: "Fix the login bug",
    startedAt: "2026-07-15T14:37:00.123Z",
    endedAt: "2026-07-15T15:00:00.000Z",
    eventCount: 42,
    toolCallCount: 12,
    ...overrides,
  };
}

describe("formatSessionsTable", () => {
  it("shows a friendly message when there are no sessions", () => {
    expect(formatSessionsTable([])).toMatch(/no sessions/i);
  });

  it("renders a header row and one row per session", () => {
    const table = formatSessionsTable([session()]);
    const lines = table.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/SESSION/);
    expect(lines[0]).toMatch(/PROJECT/);
    expect(lines[0]).toMatch(/BRANCH/);
    expect(lines[0]).toMatch(/TITLE/);
    expect(lines[0]).toMatch(/STARTED/);
    expect(lines[0]).toMatch(/DURATION/);
    expect(lines[0]).toMatch(/EVENTS/);
    expect(lines[0]).toMatch(/TOOLS/);
  });

  it("shows how long the session ran and how many tools it called", () => {
    const table = formatSessionsTable([
      session({
        startedAt: "2026-07-15T14:37:00.000Z",
        endedAt: "2026-07-15T15:00:00.000Z",
        toolCallCount: 12,
      }),
    ]);
    expect(table).toContain("23m 0s");
    expect(table).toContain("12");
  });

  it("falls back to an em dash when a session has no end timestamp", () => {
    const table = formatSessionsTable([session({ endedAt: null })]);
    const dataRow = table.split("\n")[1];
    expect(dataRow).toContain("—");
  });

  it("includes each session's data in its row", () => {
    const table = formatSessionsTable([session()]);
    expect(table).toContain("my-project");
    expect(table).toContain("main");
    expect(table).toContain("Fix the login bug");
    expect(table).toContain("42");
  });

  it("shortens the session id and strips sub-second precision from the timestamp", () => {
    const table = formatSessionsTable([session({ id: "abcdefghijklmnop" })]);
    expect(table).toContain("abcdefghij");
    expect(table).not.toContain("abcdefghijklmnop");
    expect(table).toContain("2026-07-15 14:37:00");
    expect(table).not.toContain("14:37:00.123Z");
  });

  it("falls back to an em dash for missing project/branch/title/startedAt", () => {
    const table = formatSessionsTable([
      session({ project: null, gitBranch: null, title: null, startedAt: null }),
    ]);
    const dataRow = table.split("\n")[1];
    expect(dataRow).toContain("—");
  });

  it("truncates very long titles", () => {
    const longTitle = "x".repeat(200);
    const table = formatSessionsTable([session({ title: longTitle })]);
    expect(table).toContain("…");
    expect(table).not.toContain(longTitle);
  });

  it("aligns columns across multiple rows of varying widths", () => {
    const table = formatSessionsTable([
      session({ id: "short", project: "a" }),
      session({ id: "a-much-longer-session-id", project: "a-longer-project-name" }),
    ]);
    const lines = table.split("\n");
    const projectStart = lines[0].indexOf("PROJECT");
    const branchStart = lines[0].indexOf("BRANCH");

    // Slicing every data row at the header-derived column offsets should
    // recover exactly that row's project value, proving the padding is
    // consistent across rows of very different cell widths.
    expect(lines[1].slice(projectStart, branchStart).trimEnd()).toBe("a");
    expect(lines[2].slice(projectStart, branchStart).trimEnd()).toBe("a-longer-project-name");
  });
});
