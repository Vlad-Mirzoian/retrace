import type { SessionRow } from "retrace-core/browser";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as client from "../api/client.js";
import { SessionHeader } from "./SessionHeader.js";

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

describe("SessionHeader", () => {
  it("shows a verified badge for an intact chain", async () => {
    vi.mocked(client.getVerification).mockResolvedValue({ ok: true });
    render(<SessionHeader session={session} />);
    expect(await screen.findByText(/tamper-evident · verified/i)).toBeInTheDocument();
  });

  it("shows a broken-integrity badge with the seq and reason", async () => {
    vi.mocked(client.getVerification).mockResolvedValue({
      ok: false,
      index: 5,
      reason: "event hash does not match contents (tampered)",
    });
    render(<SessionHeader session={session} />);
    expect(
      await screen.findByText(/integrity broken at step 5 — event hash does not match contents/i),
    ).toBeInTheDocument();
  });

  it("degrades quietly when the verification check itself fails", async () => {
    vi.mocked(client.getVerification).mockRejectedValue(new Error("network down"));
    render(<SessionHeader session={session} />);
    expect(
      await screen.findByText(/integrity check unavailable: network down/i),
    ).toBeInTheDocument();
  });
});
