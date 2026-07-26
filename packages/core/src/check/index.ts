import type { RetraceEvent } from "../schema.js";
import type { CheckFinding, CheckOptions, CheckReport, CheckRule } from "./types.js";
import { editWithoutReadRule } from "./rules/edit-without-read.js";
import { unaddressedErrorRule } from "./rules/unaddressed-error.js";
import { unverifiedTestClaimRule } from "./rules/unverified-test-claim.js";
import { claimedChangeMissingRule } from "./rules/claimed-change-missing.js";
import { untrackedBashMutationRule } from "./rules/untracked-bash-mutation.js";

export * from "./types.js";
export * from "./toolInput.js";
export * from "./claims.js";

/** Every registered rule, so `--list-rules` and the viewer can enumerate them without running anything. */
export const RULES: CheckRule[] = [
  editWithoutReadRule,
  unaddressedErrorRule,
  unverifiedTestClaimRule,
  claimedChangeMissingRule,
  untrackedBashMutationRule,
];

/**
 * Run the check engine over a sealed event stream. Each rule is isolated: a
 * throwing rule is caught and recorded in `rulesSkipped` rather than taking
 * the whole report down, so one broken rule never hides another rule's
 * findings.
 *
 * `rules` defaults to the full registry; overriding it is for tests that
 * need to exercise `runChecks`'s own error-isolation behavior with a stub.
 */
export function runChecks(
  sessionId: string,
  events: RetraceEvent[],
  options: CheckOptions = {},
  rules: CheckRule[] = RULES,
): CheckReport {
  const disabled = new Set(options.disabled ?? []);
  const findings: CheckFinding[] = [];
  const rulesRun: string[] = [];
  const rulesSkipped: { ruleId: string; reason: string }[] = [];

  for (const rule of rules) {
    if (disabled.has(rule.id)) continue;

    try {
      const results = rule.run(events, options);
      const severityOverride = options.severity?.[rule.id];
      for (const finding of results) {
        findings.push(severityOverride ? { ...finding, severity: severityOverride } : finding);
      }
      rulesRun.push(rule.id);
    } catch (err) {
      rulesSkipped.push({
        ruleId: rule.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  findings.sort((a, b) => a.seq - b.seq || a.ruleId.localeCompare(b.ruleId));

  return { sessionId, eventCount: events.length, findings, rulesRun, rulesSkipped };
}
