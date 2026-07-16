import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DiffView, toDiffRows } from "./DiffView.js";

describe("toDiffRows", () => {
  it("marks added, removed and context lines", () => {
    const rows = toDiffRows("keep\nold\n", "keep\nnew\n");
    expect(rows).toEqual([
      { type: "ctx", text: "keep" },
      { type: "del", text: "old" },
      { type: "add", text: "new" },
    ]);
  });

  it("does not invent a trailing blank line from the final newline", () => {
    const rows = toDiffRows("a\n", "b\n");
    expect(rows.map((r) => r.text)).toEqual(["a", "b"]);
  });

  it("returns only context rows for identical text", () => {
    const rows = toDiffRows("same\n", "same\n");
    expect(rows.every((r) => r.type === "ctx")).toBe(true);
  });

  it("handles an empty 'before' as an all-added diff", () => {
    const rows = toDiffRows("", "one\ntwo\n");
    expect(rows).toEqual([
      { type: "add", text: "one" },
      { type: "add", text: "two" },
    ]);
  });

  it("handles an empty 'after' as an all-removed diff", () => {
    const rows = toDiffRows("gone\n", "");
    expect(rows).toEqual([{ type: "del", text: "gone" }]);
  });
});

describe("DiffView", () => {
  it("renders +/- markers alongside the changed lines", () => {
    render(<DiffView oldText={"keep\nold\n"} newText={"keep\nnew\n"} />);
    const diff = screen.getByTestId("diff");
    // Marker abuts the content, exactly as in unified diff format.
    expect(diff).toHaveTextContent("-old");
    expect(diff).toHaveTextContent("+new");
  });

  it("says so when both sides are empty", () => {
    render(<DiffView oldText="" newText="" />);
    expect(screen.getByText(/no changes/i)).toBeInTheDocument();
  });
});
