import type { CheckReport, RetraceEvent } from "retrace-core/browser";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { FindingsPanel } from "./FindingsPanel.js";
import { ReplayProvider, useReplay } from "../replay/ReplayContext.js";

function base(seq: number) {
  return { seq, ts: "2026-07-15T14:37:00.000Z", sessionId: "s", prevHash: null, hash: `h${seq}` };
}

const events: RetraceEvent[] = [
  {
    ...base(0),
    kind: "tool_call",
    payload: { toolName: "Bash", toolUseId: "t1", input: { command: "npm test" } },
  } as RetraceEvent,
  {
    ...base(1),
    kind: "tool_result",
    payload: { toolUseId: "t1", output: "boom", isError: true },
  } as RetraceEvent,
];

function report(overrides: Partial<CheckReport> = {}): CheckReport {
  return {
    sessionId: "sess-1",
    eventCount: 2,
    findings: [],
    rulesRun: ["edit-without-read", "unaddressed-error"],
    rulesSkipped: [],
    ...overrides,
  };
}

function CurrentSeq() {
  const { currentSeq } = useReplay();
  return <span data-testid="seq">{currentSeq}</span>;
}

/** Simulates something *other* than this panel moving the shared replay cursor — a click elsewhere in the sidebar, a timeline row, a replay-control step. */
function JumpElsewhere({ seq }: { seq: number }) {
  const { setCurrentSeq } = useReplay();
  return (
    <button type="button" onClick={() => setCurrentSeq(seq)}>
      jump elsewhere
    </button>
  );
}

/** Starts autoplay and shows whether it's still running, so a test can assert a finding click stops it. */
function PlaybackToggle() {
  const { playing, setPlaying } = useReplay();
  return (
    <>
      <span data-testid="playing">{String(playing)}</span>
      <button type="button" onClick={() => setPlaying(true)}>
        play
      </button>
    </>
  );
}

function renderPanel(r: CheckReport, fixtureEvents: RetraceEvent[] = events, extra?: ReactNode) {
  return render(
    <ReplayProvider maxSeq={10}>
      <CurrentSeq />
      {extra}
      <FindingsPanel report={r} events={fixtureEvents} />
    </ReplayProvider>,
  );
}

describe("FindingsPanel", () => {
  it("shows the empty state naming the rule count when there are no findings", () => {
    renderPanel(report());
    expect(screen.getByText("No findings — 2 rule(s) run.")).toBeInTheDocument();
  });

  it("groups findings by severity, high first", () => {
    renderPanel(
      report({
        findings: [
          { ruleId: "claimed-change-missing", severity: "low", title: "low one", seq: 3 },
          { ruleId: "unaddressed-error", severity: "high", title: "high one", seq: 1 },
          { ruleId: "edit-without-read", severity: "medium", title: "medium one", seq: 2 },
        ],
      }),
    );

    const groupHeadings = document.querySelectorAll(".findings-group-heading");
    expect(Array.from(groupHeadings).map((h) => h.textContent)).toEqual(["High", "Medium", "Low"]);

    const titles = document.querySelectorAll(".finding-title");
    expect(Array.from(titles).map((t) => t.textContent)).toEqual(["high one", "medium one", "low one"]);
  });

  it("seeks the replay cursor to the finding's seq when clicked", () => {
    renderPanel(
      report({
        findings: [{ ruleId: "unaddressed-error", severity: "high", title: "Bash failed", seq: 1 }],
      }),
    );
    fireEvent.click(screen.getByText("Bash failed"));
    expect(screen.getByTestId("seq")).toHaveTextContent("1");
  });

  it("shows detail and path for the selected finding", () => {
    renderPanel(
      report({
        findings: [
          {
            ruleId: "edit-without-read",
            severity: "medium",
            title: "a.ts edited blind",
            detail: "no preceding Read",
            path: "src/a.ts",
            seq: 0,
          },
        ],
      }),
    );
    fireEvent.click(screen.getByText("a.ts edited blind"));
    expect(screen.getByText("no preceding Read")).toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
  });

  it("shows the causal trace for a finding with a toolUseId", () => {
    renderPanel(
      report({
        findings: [
          { ruleId: "unaddressed-error", severity: "high", title: "Bash failed", seq: 1, toolUseId: "t1" },
        ],
      }),
    );
    fireEvent.click(screen.getByText("Bash failed"));
    expect(screen.getByText(/why did this happen/i)).toBeInTheDocument();
    expect(screen.getByText("Bash")).toBeInTheDocument();
  });

  it("does not show a detail section before any finding is selected", () => {
    renderPanel(
      report({
        findings: [{ ruleId: "unaddressed-error", severity: "high", title: "Bash failed", seq: 1 }],
      }),
    );
    expect(document.querySelector(".finding-detail")).not.toBeInTheDocument();
  });

  it("distinguishes two findings that share the same seq", () => {
    renderPanel(
      report({
        findings: [
          {
            ruleId: "claimed-change-missing",
            severity: "low",
            title: "helpers.ts claimed changed",
            detail: "claim excerpt",
            seq: 10,
          },
          {
            ruleId: "unverified-test-claim",
            severity: "medium",
            title: "tests claimed to pass",
            detail: "claim excerpt two",
            seq: 10,
          },
        ],
      }),
    );

    fireEvent.click(screen.getByText("helpers.ts claimed changed"));
    expect(screen.getByText("claim excerpt")).toBeInTheDocument();
    expect(screen.queryByText("claim excerpt two")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("tests claimed to pass"));
    expect(screen.getByText("claim excerpt two")).toBeInTheDocument();
    expect(screen.queryByText("claim excerpt")).not.toBeInTheDocument();
  });

  it("marks a subagent-branch finding visibly", () => {
    renderPanel(
      report({
        findings: [
          {
            ruleId: "edit-without-read",
            severity: "medium",
            title: "sub.ts edited blind",
            seq: 0,
            sidechain: true,
          },
        ],
      }),
    );
    const item = screen.getByText("sub.ts edited blind").closest("button")!;
    expect(within(item).getByText("subagent")).toBeInTheDocument();
  });

  it("renders rulesSkipped as a distinct, separate section — never as a passed rule", () => {
    renderPanel(report({ rulesSkipped: [{ ruleId: "flaky-rule", reason: "boom" }] }));
    expect(screen.getByText("Rules skipped")).toBeInTheDocument();
    expect(screen.getByText(/flaky-rule: boom/)).toBeInTheDocument();
    // The empty-state "no findings" line and the skipped section can coexist —
    // a skipped rule must never be silently folded into "clean".
    expect(screen.getByText(/no findings/i)).toBeInTheDocument();
  });

  it("clears the selection when the replay cursor moves elsewhere", () => {
    renderPanel(
      report({
        findings: [{ ruleId: "unaddressed-error", severity: "high", title: "Bash failed", seq: 1 }],
      }),
      events,
      <JumpElsewhere seq={0} />,
    );

    const button = screen.getByText("Bash failed").closest("button")!;
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".finding-detail")).toBeInTheDocument();

    // Something else (a Failure, a timeline row, a replay-control step) —
    // anything that moves the shared cursor away from this finding's own
    // seq — must clear this panel's highlight and detail along with it.
    fireEvent.click(screen.getByText("jump elsewhere"));
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector(".finding-detail")).not.toBeInTheDocument();
  });

  it("pauses autoplay when a finding is clicked", () => {
    renderPanel(
      report({
        findings: [{ ruleId: "unaddressed-error", severity: "high", title: "Bash failed", seq: 1 }],
      }),
      events,
      <PlaybackToggle />,
    );

    fireEvent.click(screen.getByText("play"));
    expect(screen.getByTestId("playing")).toHaveTextContent("true");

    fireEvent.click(screen.getByText("Bash failed"));
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
  });

  it("is keyboard accessible: findings are focusable, activatable buttons", () => {
    renderPanel(
      report({
        findings: [{ ruleId: "unaddressed-error", severity: "high", title: "Bash failed", seq: 1 }],
      }),
    );
    const button = screen.getByRole("button", { name: /Bash failed/ });
    button.focus();
    expect(button).toHaveFocus();
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.click(button); // jsdom doesn't auto-invoke click on Enter for a real <button>; verifies the same handler
    expect(screen.getByTestId("seq")).toHaveTextContent("1");
  });
});
