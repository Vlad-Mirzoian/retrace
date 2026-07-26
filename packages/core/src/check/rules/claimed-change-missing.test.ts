import { describe, expect, it } from "vitest";
import { sealEvents } from "../../chain.js";
import type { RetraceEventDraft } from "../../schema.js";
import { claimedChangeMissingRule } from "./claimed-change-missing.js";

const ts = "2026-07-15T14:37:00.000Z";

function drafts(
  items: Array<{ kind: RetraceEventDraft["kind"]; payload: unknown; sidechain?: boolean }>,
): RetraceEventDraft[] {
  return items.map((item) => ({
    ts,
    sessionId: "sess-1",
    ...item,
  })) as unknown as RetraceEventDraft[];
}

function run(items: Array<{ kind: RetraceEventDraft["kind"]; payload: unknown; sidechain?: boolean }>) {
  return claimedChangeMissingRule.run(sealEvents(drafts(items)), {});
}

describe("claimed-change-missing", () => {
  it("fires when the claimed path has no matching file_change anywhere in the session", () => {
    const findings = run([
      { kind: "file_change", payload: { path: "/repo/other.ts", operation: "edit", oldString: "x", newString: "y" } },
      { kind: "assistant_text", payload: { text: "I fixed the bug in src/auth.ts." } },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: "claimed-change-missing",
      severity: "low",
      path: "src/auth.ts",
    });
  });

  it("does not fire when a matching file_change exists, even described earlier in the session", () => {
    const findings = run([
      { kind: "assistant_text", payload: { text: "I fixed the bug in src/auth.ts." } },
      { kind: "file_change", payload: { path: "/repo/src/auth.ts", operation: "edit", oldString: "x", newString: "y" } },
    ]);
    expect(findings).toEqual([]);
  });

  it("suppresses on a basename-only match, even without a matching parent segment", () => {
    const findings = run([
      { kind: "file_change", payload: { path: "/some/other/dir/auth.ts", operation: "edit", oldString: "x", newString: "y" } },
      { kind: "assistant_text", payload: { text: "I fixed the bug in src/auth.ts." } },
    ]);
    expect(findings).toEqual([]);
  });

  it("skips entirely when the session has zero file_change events", () => {
    const findings = run([{ kind: "assistant_text", payload: { text: "I fixed the bug in src/auth.ts." } }]);
    expect(findings).toEqual([]);
  });

  it("fires only once per distinct claimed path", () => {
    const findings = run([
      { kind: "file_change", payload: { path: "/repo/other.ts", operation: "edit", oldString: "x", newString: "y" } },
      { kind: "assistant_text", payload: { text: "I fixed the bug in src/auth.ts." } },
      { kind: "assistant_text", payload: { text: "As I said, I fixed src/auth.ts properly this time." } },
    ]);
    expect(findings).toHaveLength(1);
  });
});
