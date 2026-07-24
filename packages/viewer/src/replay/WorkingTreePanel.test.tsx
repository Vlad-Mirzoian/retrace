import type { RetraceEvent } from "retrace-core/browser";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as client from "../api/client.js";
import { ReplayProvider, useReplay } from "./ReplayContext.js";
import { WorkingTreePanel } from "./WorkingTreePanel.js";

vi.mock("../api/client.js");

function base(seq: number) {
  return { seq, ts: "2026-07-15T14:37:00.000Z", sessionId: "s", prevHash: null, hash: `h${seq}` };
}

// create -> edit (a.txt), a no-snapshot write (b.txt), then a.txt is deleted.
const events: RetraceEvent[] = [
  {
    ...base(0),
    kind: "file_change",
    payload: { path: "a.txt", operation: "create", afterRef: "hash-a1" },
  } as RetraceEvent,
  {
    ...base(1),
    kind: "file_change",
    payload: { path: "a.txt", operation: "edit", afterRef: "hash-a2" },
  } as RetraceEvent,
  {
    ...base(2),
    kind: "file_change",
    payload: { path: "b.txt", operation: "write", oldString: "x", newString: "y" },
  } as RetraceEvent,
  {
    ...base(3),
    kind: "file_change",
    payload: { path: "a.txt", operation: "delete" },
  } as RetraceEvent,
];

function SeekButtons() {
  const { setCurrentSeq } = useReplay();
  return (
    <div>
      {[0, 1, 2, 3].map((seq) => (
        <button key={seq} onClick={() => setCurrentSeq(seq)}>
          seek-{seq}
        </button>
      ))}
    </div>
  );
}

function renderPanel() {
  render(
    <ReplayProvider maxSeq={3}>
      <SeekButtons />
      <WorkingTreePanel events={events} />
    </ReplayProvider>,
  );
}

function seek(seq: number) {
  fireEvent.click(screen.getByText(`seek-${seq}`));
}

describe("WorkingTreePanel", () => {
  it("shows a friendly message when the session has no file changes", () => {
    render(
      <ReplayProvider maxSeq={0}>
        <WorkingTreePanel events={[]} />
      </ReplayProvider>,
    );
    expect(screen.getByText(/no files touched yet/i)).toBeInTheDocument();
  });

  it("lists only paths touched at or before the cursor, sorted by path, with the right status", () => {
    renderPanel();
    seek(0);
    expect(screen.getByText("a.txt")).toBeInTheDocument();
    expect(screen.queryByText("b.txt")).not.toBeInTheDocument();
    expect(screen.getByText("created")).toBeInTheDocument();

    seek(2);
    const paths = screen.getAllByText(/\.txt$/).map((el) => el.textContent);
    expect(paths).toEqual(["a.txt", "b.txt"]); // alphabetical
    expect(screen.getByText("edited")).toBeInTheDocument();
    expect(screen.getByText("no snapshot")).toBeInTheDocument(); // b.txt's write has no afterRef
  });

  it("flags a deleted path as deleted, distinct from fileStateAt's working-tree view", () => {
    renderPanel();
    seek(3);
    expect(screen.getByText("a.txt")).toBeInTheDocument(); // still listed...
    expect(screen.getByText("deleted")).toBeInTheDocument(); // ...but flagged deleted
  });

  it("shows a deletion message instead of content/diff controls for a deleted file", () => {
    renderPanel();
    seek(3);
    fireEvent.click(screen.getByText("a.txt"));
    expect(screen.getByText(/a\.txt was deleted at step 3/i)).toBeInTheDocument();
    expect(screen.queryByText("Content at this step")).not.toBeInTheDocument();
  });

  it("loads and shows a file's content at the current step", async () => {
    vi.mocked(client.getObjectText).mockResolvedValue("CONTENT AT SEQ 1");
    renderPanel();
    seek(1);
    fireEvent.click(screen.getByText("a.txt"));

    expect(client.getObjectText).toHaveBeenCalledWith("hash-a2");
    expect(await screen.findByText("CONTENT AT SEQ 1")).toBeInTheDocument();
  });

  it("degrades to a no-snapshot message for content mode when nothing was captured", () => {
    renderPanel();
    seek(2);
    fireEvent.click(screen.getByText("b.txt"));
    expect(screen.getByText("(no snapshot captured)")).toBeInTheDocument();
  });

  it("diffs a file against its previous recorded change", async () => {
    vi.mocked(client.getObjectText).mockImplementation((hash: string) =>
      Promise.resolve(hash === "hash-a1" ? "ORIGINAL" : "EDITED"),
    );
    renderPanel();
    seek(1);
    fireEvent.click(screen.getByText("a.txt"));
    fireEvent.click(screen.getByText("Diff since previous change"));

    expect(await screen.findByTestId("diff")).toBeInTheDocument();
    expect(screen.getByText("ORIGINAL")).toBeInTheDocument();
    expect(screen.getByText("EDITED")).toBeInTheDocument();
  });

  it("reports the first recorded change to a path rather than attempting a diff", () => {
    renderPanel();
    seek(2);
    fireEvent.click(screen.getByText("b.txt"));
    fireEvent.click(screen.getByText("Diff since previous change"));
    expect(screen.getByText(/first recorded change/i)).toBeInTheDocument();
  });

  it("deselects a file when it's clicked again", () => {
    renderPanel();
    seek(1);
    fireEvent.click(screen.getByText("a.txt"));
    expect(screen.getByText("Content at this step")).toBeInTheDocument();
    fireEvent.click(screen.getByText("a.txt"));
    expect(screen.queryByText("Content at this step")).not.toBeInTheDocument();
  });
});
