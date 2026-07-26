import { describe, expect, it } from "vitest";
import { sealEvents } from "../chain.js";
import type { RetraceEventDraft } from "../schema.js";
import { extractClaims } from "./claims.js";

const ts = "2026-07-15T14:37:00.000Z";

function assistantEvents(texts: string[]): RetraceEventDraft[] {
  return texts.map((text) => ({
    ts,
    sessionId: "sess-1",
    kind: "assistant_text",
    payload: { text },
  })) as unknown as RetraceEventDraft[];
}

function claimsFor(text: string) {
  return extractClaims(sealEvents(assistantEvents([text])));
}

describe("extractClaims — positive cases", () => {
  it("extracts a tests-pass claim", () => {
    expect(claimsFor("All tests pass.")).toMatchObject([{ kind: "tests-pass", seq: 0 }]);
  });

  it("extracts a tests-pass claim phrased as 'now passing'", () => {
    expect(claimsFor("Tests are now passing.")).toMatchObject([{ kind: "tests-pass" }]);
  });

  it("extracts a build-passes claim", () => {
    expect(claimsFor("The build succeeds.")).toMatchObject([{ kind: "build-passes" }]);
  });

  it("extracts a build-passes claim phrased as compiling cleanly", () => {
    expect(claimsFor("It compiles successfully now.")).toMatchObject([{ kind: "build-passes" }]);
  });

  it("extracts a file-modified claim with the path as written", () => {
    expect(claimsFor("I fixed the bug in src/auth.ts.")).toMatchObject([
      { kind: "file-modified", subject: "src/auth.ts" },
    ]);
  });

  it("extracts a file-modified claim for a backticked path", () => {
    expect(claimsFor("I updated `packages/core/src/index.ts` to add the export.")).toMatchObject([
      { kind: "file-modified", subject: "packages/core/src/index.ts" },
    ]);
  });

  it("extracts multiple claims from one event, one per matching sentence", () => {
    const claims = claimsFor("I updated calc.ts to fix the bug. All tests pass now.");
    expect(claims.map((c) => c.kind)).toEqual(["file-modified", "tests-pass"]);
    expect(claims.every((c) => c.seq === 0)).toBe(true);
  });

  it("truncates a long excerpt to the 120-char house style", () => {
    const longSentence = `All tests pass because ${"x".repeat(200)} was removed from the setup.`;
    const [claim] = claimsFor(longSentence);
    expect(claim.excerpt.length).toBeLessThanOrEqual(120);
    expect(claim.excerpt.endsWith("…")).toBe(true);
  });
});

describe("extractClaims — negative cases (must not match)", () => {
  const negatives = [
    "Let me run the tests to confirm.",
    "I'll verify this works.",
    "Tests should pass now.",
    "I need to run the test suite.",
    "Running the tests now.",
    "Let's check if the build succeeds.",
    "I'm going to update src/auth.ts next.",
    "I will fix config.json shortly.",
    "The tests don't pass yet.",
    "The build isn't passing.",
    "Previously failing tests now pass.", // false negative by design: contains "failing"
    "You said tests pass on your machine.",
    "As you mentioned, the build succeeds.",
    "I should update the config file.",
    "Let's fix the bug in calc.ts.",
    "The config file needs updating.", // no path-shaped token ("config file" is prose)
    "Now the full build + test pass:", // trailing colon introduces the command about to run, not a completed claim
    "All tests pass:", // same — a colon-terminated header, not an assertion
    "I wrapped it in a try/catch.", // a slash phrase, not a path — no extension
    "Created feature/thesis-alignment off main.", // a branch name, not a path
  ];

  it.each(negatives)("does not extract a claim from: %s", (text) => {
    expect(claimsFor(text)).toEqual([]);
  });

  it("ignores thinking events entirely", () => {
    const events = sealEvents([
      { ts, sessionId: "sess-1", kind: "thinking", payload: { text: "All tests pass, I should verify." } },
    ] as unknown as RetraceEventDraft[]);
    expect(extractClaims(events)).toEqual([]);
  });

  it("skips text inside fenced code blocks", () => {
    const text = "Here's what happened:\n```\nAll tests pass\nbuild succeeds\n```\nLet me check further.";
    expect(claimsFor(text)).toEqual([]);
  });

  it("does not extract a claim from code-fenced text even when real prose surrounds it", () => {
    const text = "```\nAll tests pass.\n```\nI haven't verified this myself yet.";
    expect(claimsFor(text)).toEqual([]);
  });
});
