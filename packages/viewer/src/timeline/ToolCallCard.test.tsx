import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ToolCallEvent, ToolResultEvent } from "./grouping.js";
import { ToolCallCard, outputToText } from "./ToolCallCard.js";

function call(toolName: string, input: unknown): ToolCallEvent {
  return {
    seq: 0,
    ts: "2026-07-15T14:37:00.000Z",
    sessionId: "s",
    prevHash: null,
    hash: "h",
    kind: "tool_call",
    payload: { toolName, toolUseId: "t1", input },
  } as ToolCallEvent;
}

function result(output: unknown, isError?: true): ToolResultEvent {
  return {
    seq: 1,
    ts: "2026-07-15T14:37:01.000Z",
    sessionId: "s",
    prevHash: "h",
    hash: "h2",
    kind: "tool_result",
    payload: { toolUseId: "t1", output, ...(isError ? { isError } : {}) },
  } as ToolResultEvent;
}

describe("outputToText", () => {
  it("passes a string result through", () => {
    expect(outputToText("hello")).toBe("hello");
  });

  it("joins the text of content blocks", () => {
    expect(outputToText([{ type: "text", text: "a" }, { type: "text", text: "b" }])).toBe("a\nb");
  });

  it("falls back to JSON for blocks without text (e.g. tool_reference)", () => {
    // This exact shape appears in real transcripts.
    expect(outputToText([{ type: "tool_reference", tool_name: "ExitPlanMode" }])).toContain(
      "ExitPlanMode",
    );
  });

  it("renders an absent result as empty rather than 'undefined'", () => {
    expect(outputToText(undefined)).toBe("");
    expect(outputToText(null)).toBe("");
  });
});

describe("ToolCallCard", () => {
  it("shows the tool name and its result", () => {
    render(<ToolCallCard call={call("Read", { file_path: "/a.ts" })} result={result("file body")} />);
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("file body")).toBeInTheDocument();
  });

  it("renders an Edit as a diff of old_string → new_string", () => {
    render(
      <ToolCallCard
        call={call("Edit", { file_path: "/app.ts", old_string: "before", new_string: "after" })}
        result={result("ok")}
      />,
    );
    const diff = screen.getByTestId("diff");
    expect(diff).toHaveTextContent("-before");
    expect(diff).toHaveTextContent("+after");
    expect(screen.getByText("/app.ts")).toBeInTheDocument();
  });

  it("shows a Bash command as the command line itself", () => {
    render(<ToolCallCard call={call("Bash", { command: "ls -la" })} />);
    expect(screen.getByText("ls -la")).toBeInTheDocument();
  });

  it("flags an errored result", () => {
    render(<ToolCallCard call={call("Bash", { command: "boom" })} result={result("failed", true)} />);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("marks a call that never produced a result", () => {
    render(<ToolCallCard call={call("Bash", { command: "hung" })} />);
    // Exact match: a regex would also match the ancestors containing this text.
    expect(screen.getByText("no result")).toBeInTheDocument();
  });

  it("collapses a large result behind a toggle, revealing it on click", async () => {
    const big = "x".repeat(2000);
    render(<ToolCallCard call={call("Bash", { command: "cat big" })} result={result(big)} />);

    expect(screen.queryByText(big)).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /result/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);
    expect(screen.getByText(big)).toBeInTheDocument();
  });

  it("falls back to a JSON view for tools without a bespoke layout", () => {
    render(<ToolCallCard call={call("Glob", { pattern: "**/*.ts" })} />);
    expect(screen.getByText(/\*\*\/\*\.ts/)).toBeInTheDocument();
  });
});
