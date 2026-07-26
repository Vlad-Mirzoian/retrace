import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RetraceStore } from "retrace-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importFile } from "./import.js";
import { breachesThreshold, checkAll, checkSession } from "./check.js";

let home: string;
let store: RetraceStore;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "retrace-check-home-"));
  store = new RetraceStore(home);
});

afterEach(async () => {
  store.close();
  await rm(home, { recursive: true, force: true });
});

function seed(sessionId: string, text: string) {
  store.appendEvent({
    ts: "2026-07-15T14:37:00.000Z",
    sessionId,
    kind: "user_prompt",
    payload: { text },
  });
  store.ensureSession({ id: sessionId });
}

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../../../core/fixtures/${name}`, import.meta.url));
}

describe("checkSession", () => {
  it("returns zero findings for a clean session", () => {
    seed("sess-1", "hello");
    const result = checkSession(store, "sess-1");
    expect(result.sessionId).toBe("sess-1");
    expect(result.report.findings).toEqual([]);
    expect(result.report.rulesRun.length).toBeGreaterThan(0);
  });

  it("resolves a unique id prefix", () => {
    seed("sess-unique-full-id", "hi");
    const result = checkSession(store, "sess-unique");
    expect(result.sessionId).toBe("sess-unique-full-id");
  });

  it("throws for an id that matches no session", () => {
    expect(() => checkSession(store, "does-not-exist")).toThrow(/no session matches/);
  });

  it("finds every rule's finding on the real flagged-session fixture", () => {
    const path = fixturePath("flagged-session.jsonl");
    const imported = importFile(store, path);
    const result = checkSession(store, imported.sessionId);

    expect(result.report.findings.length).toBeGreaterThanOrEqual(5);
    const ruleIds = new Set(result.report.findings.map((f) => f.ruleId));
    expect(ruleIds).toEqual(
      new Set([
        "edit-without-read",
        "unaddressed-error",
        "unverified-test-claim",
        "claimed-change-missing",
        "untracked-bash-mutation",
      ]),
    );
  });

  it("respects a disabled-rules option", () => {
    seed("sess-1", "hi");
    const result = checkSession(store, "sess-1", { disabled: ["edit-without-read"] });
    expect(result.report.rulesRun).not.toContain("edit-without-read");
  });
});

describe("checkAll", () => {
  it("checks every recorded session", () => {
    seed("sess-1", "hi");
    seed("sess-2", "there");
    const summary = checkAll(store);
    expect(summary.results.map((r) => r.sessionId).sort()).toEqual(["sess-1", "sess-2"]);
  });

  it("puts a session with a finding at or above the threshold into failed", () => {
    const path = fixturePath("flagged-session.jsonl");
    const imported = importFile(store, path);
    seed("sess-clean", "hi");

    const summary = checkAll(store, undefined, "medium");
    expect(summary.failed.map((r) => r.sessionId)).toEqual([imported.sessionId]);
  });

  it("never fails anything when failOn is 'never'", () => {
    const path = fixturePath("flagged-session.jsonl");
    importFile(store, path);

    const summary = checkAll(store, undefined, "never");
    expect(summary.failed).toEqual([]);
  });

  it("defaults to a 'high' threshold, matching module 04's only high-severity rule", () => {
    const path = fixturePath("flagged-session.jsonl");
    importFile(store, path);

    // flagged-session.jsonl's findings are all medium/low, so the default
    // (high) threshold does not flag it as failed.
    const summary = checkAll(store);
    expect(summary.failed).toEqual([]);
  });
});

describe("breachesThreshold", () => {
  const report = {
    sessionId: "sess-1",
    eventCount: 1,
    findings: [{ ruleId: "r", severity: "medium" as const, title: "t", seq: 0 }],
    rulesRun: ["r"],
    rulesSkipped: [],
  };

  it("breaches when a finding meets or exceeds the threshold", () => {
    expect(breachesThreshold(report, "medium")).toBe(true);
    expect(breachesThreshold(report, "low")).toBe(true);
  });

  it("does not breach when every finding is below the threshold", () => {
    expect(breachesThreshold(report, "high")).toBe(false);
  });

  it("never breaches when threshold is 'never', regardless of findings", () => {
    expect(breachesThreshold(report, "never")).toBe(false);
  });

  it("does not breach a report with zero findings", () => {
    expect(breachesThreshold({ ...report, findings: [] }, "low")).toBe(false);
  });
});
