import type { RetraceEvent } from "../../schema.js";
import type { CheckFinding, CheckRule, Severity } from "../types.js";
import { bashCommand, SHELL_TOOL_NAMES } from "../toolInput.js";
import { extractClaims, type ExtractedClaim } from "../claims.js";

/**
 * Recognized test/build commands. Kept in one exported constant so it can be
 * extended without touching rule logic. The npm/pnpm/yarn patterns tolerate
 * flags between the package manager and the script name (`pnpm -w build`,
 * `npm run -w core test`) since real invocations routinely carry them.
 */
export const TEST_BUILD_COMMAND_PATTERNS: RegExp[] = [
  /\b(?:npm|pnpm|yarn)\s+(?:-\S+\s+)*(?:run\s+)?test\b/i,
  /\b(?:npm|pnpm|yarn)\s+(?:-\S+\s+)*(?:run\s+)?build\b/i,
  /\bvitest\b/i,
  /\bjest\b/i,
  /\bpytest\b/i,
  /\bcargo (?:test|build)\b/i,
  /\bgo (?:test|build|vet)\b/i,
  /\bmake\b(?:\s+\w+)?/i,
  /\btsc\b/i,
  /\bmvn\s+\w*(?:test|package|verify|compile)\b/i,
  /\bdotnet\s+(?:test|build)\b/i,
];

function isTestOrBuildCommand(command: string | undefined): boolean {
  return command !== undefined && TEST_BUILD_COMMAND_PATTERNS.some((p) => p.test(command));
}

function subjectLabel(kind: ExtractedClaim["kind"]): string {
  return kind === "tests-pass" ? "tests pass" : "the build passes";
}

/**
 * The assistant asserted "tests pass" / "the build succeeds" (see claims.ts
 * for what counts as an assertion — relaying the user's own statement is
 * deliberately excluded there, not here), but no recognized test/build
 * command ran between the last file change before the claim and the claim
 * itself.
 */
export const unverifiedTestClaimRule: CheckRule = {
  id: "unverified-test-claim",
  description:
    "The assistant claimed tests or the build pass, but no matching test/build command ran after the last file change. Contradicting a recorded failure is a stronger (medium) finding; an absent verification is a weaker (low) one.",
  defaultSeverity: "low",
  run(events: RetraceEvent[]): CheckFinding[] {
    const claims = extractClaims(events).filter(
      (c) => c.kind === "tests-pass" || c.kind === "build-passes",
    );
    if (claims.length === 0) return [];

    const resultByToolUseId = new Map<string, { seq: number; isError: boolean }>();
    for (const event of events) {
      if (event.kind === "tool_result") {
        resultByToolUseId.set(event.payload.toolUseId, {
          seq: event.seq,
          isError: event.payload.isError === true,
        });
      }
    }

    const findings: CheckFinding[] = [];

    for (const claim of claims) {
      let lastFileChangeSeq: number | undefined;
      let testCall: { seq: number; toolUseId: string } | undefined;

      for (const event of events) {
        if (event.seq >= claim.seq) break;

        if (event.kind === "file_change") {
          lastFileChangeSeq = event.seq;
          // A run before this edit doesn't verify the edit — only a run
          // after the most recent (code) file change counts. A `.md` change
          // is excluded from that reset: memory/handoff notes are routinely
          // written *after* a real test run as the last step of a turn, and
          // don't invalidate the verification that already happened —
          // confirmed against real sessions, where this was the single
          // largest source of false positives (see the module's completion
          // note in plan/module-05-claim-rules.md).
          if (!event.payload.path.toLowerCase().endsWith(".md")) {
            testCall = undefined;
          }
        } else if (
          event.kind === "tool_call" &&
          SHELL_TOOL_NAMES.has(event.payload.toolName) &&
          isTestOrBuildCommand(bashCommand(event.payload.input))
        ) {
          testCall = { seq: event.seq, toolUseId: event.payload.toolUseId };
        }
      }

      const relatedSeqs: number[] = [];
      if (lastFileChangeSeq !== undefined) relatedSeqs.push(lastFileChangeSeq);

      if (testCall) {
        const result = resultByToolUseId.get(testCall.toolUseId);
        if (result && !result.isError) continue; // actually verified — no finding

        relatedSeqs.push(testCall.seq);
        const severity: Severity = result?.isError ? "medium" : "low";
        const subject = subjectLabel(claim.kind);
        findings.push({
          ruleId: "unverified-test-claim",
          severity,
          title: result?.isError
            ? `Claimed ${subject}, but the last test run failed`
            : `Claimed ${subject}, but its test run has no recorded result`,
          detail: claim.excerpt,
          seq: claim.seq,
          relatedSeqs: relatedSeqs.length > 0 ? relatedSeqs : undefined,
        });
        continue;
      }

      findings.push({
        ruleId: "unverified-test-claim",
        severity: "low",
        title: `Claimed ${subjectLabel(claim.kind)} with no verifying command`,
        detail: claim.excerpt,
        seq: claim.seq,
        relatedSeqs: relatedSeqs.length > 0 ? relatedSeqs : undefined,
      });
    }

    return findings;
  },
};
