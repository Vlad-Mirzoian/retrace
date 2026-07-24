import type { RetraceEvent } from "retrace-core/browser";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as client from "../api/client.js";
import { FinalStateDiff } from "./FinalStateDiff.js";

vi.mock("../api/client.js");

function base(seq: number) {
  return { seq, ts: "2026-07-15T14:37:00.000Z", sessionId: "s", prevHash: null, hash: `h${seq}` };
}

describe("FinalStateDiff", () => {
  it("reports no difference when both runs left an identical file behind", () => {
    const a: RetraceEvent[] = [
      {
        ...base(0),
        kind: "file_change",
        payload: { path: "a.txt", operation: "write", afterRef: "hash-1" },
      } as RetraceEvent,
    ];
    const b: RetraceEvent[] = [
      {
        ...base(0),
        kind: "file_change",
        payload: { path: "a.txt", operation: "write", afterRef: "hash-1" },
      } as RetraceEvent,
    ];
    render(<FinalStateDiff eventsA={a} eventsB={b} />);
    expect(screen.getByText(/same state/i)).toBeInTheDocument();
  });

  it("diffs a path whose final content differs between the two runs", async () => {
    vi.mocked(client.getObjectText).mockImplementation((hash: string) =>
      Promise.resolve(hash === "hash-a" ? "CONTENT FROM RUN A" : "CONTENT FROM RUN B"),
    );
    const a: RetraceEvent[] = [
      {
        ...base(0),
        kind: "file_change",
        payload: { path: "a.txt", operation: "write", afterRef: "hash-a" },
      } as RetraceEvent,
    ];
    const b: RetraceEvent[] = [
      {
        ...base(0),
        kind: "file_change",
        payload: { path: "a.txt", operation: "write", afterRef: "hash-b" },
      } as RetraceEvent,
    ];
    render(<FinalStateDiff eventsA={a} eventsB={b} />);

    expect(screen.getByText("a.txt")).toBeInTheDocument();
    expect(await screen.findByText("CONTENT FROM RUN A")).toBeInTheDocument();
    expect(screen.getByText("CONTENT FROM RUN B")).toBeInTheDocument();
  });

  it("ignores a path deleted by both runs — nothing left in either final tree", () => {
    const a: RetraceEvent[] = [
      {
        ...base(0),
        kind: "file_change",
        payload: { path: "gone.txt", operation: "create", afterRef: "h1" },
      } as RetraceEvent,
      {
        ...base(1),
        kind: "file_change",
        payload: { path: "gone.txt", operation: "delete" },
      } as RetraceEvent,
    ];
    const b: RetraceEvent[] = [
      {
        ...base(0),
        kind: "file_change",
        payload: { path: "gone.txt", operation: "create", afterRef: "h2" },
      } as RetraceEvent,
      {
        ...base(1),
        kind: "file_change",
        payload: { path: "gone.txt", operation: "delete" },
      } as RetraceEvent,
    ];
    render(<FinalStateDiff eventsA={a} eventsB={b} />);
    expect(screen.getByText(/same state/i)).toBeInTheDocument();
    expect(screen.queryByText("gone.txt")).not.toBeInTheDocument();
  });

  it("shows a file present in only one run's final state", async () => {
    vi.mocked(client.getObjectText).mockResolvedValue("ONLY IN A");
    const a: RetraceEvent[] = [
      {
        ...base(0),
        kind: "file_change",
        payload: { path: "only-a.txt", operation: "create", afterRef: "hash-a" },
      } as RetraceEvent,
    ];
    render(<FinalStateDiff eventsA={a} eventsB={[]} />);
    expect(screen.getByText("only-a.txt")).toBeInTheDocument();
    expect(await screen.findByText("ONLY IN A")).toBeInTheDocument();
  });
});
