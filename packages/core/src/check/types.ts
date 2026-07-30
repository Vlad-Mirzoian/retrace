import type { RetraceEvent } from "../schema.js";

/**
 * Pure findings model for the check engine. Zero Node dependencies — the same
 * constraint replay.ts/compare.ts live under — so this is safe to re-export
 * from `browser.ts` for the viewer and the self-contained HTML export.
 */

/**
 * Severity contract every rule's escalation logic must be traceable to:
 * - `high` — the session ended with work in a state the agent's own account
 *   does not match, and no recorded evidence resolves it. Blocking is a
 *   defensible response.
 * - `medium` — a real behavioral problem with a plausible benign
 *   explanation; worth a look, not worth blocking.
 * - `low` — a claim that could not be corroborated from the record.
 *   Informational.
 */
export type Severity = "high" | "medium" | "low";

export interface CheckFinding {
  /** Stable kebab-case rule id, e.g. "edit-without-read". Part of the public contract — CI configs will reference it. */
  ruleId: string;
  severity: Severity;
  /** One line, no trailing period, names the thing: "src/auth.ts edited without being read". */
  title: string;
  /** Optional longer explanation of what was observed and why it matters. */
  detail?: string;
  /** The event seq this finding anchors to — what the viewer scrolls to and the CLI prints. */
  seq: number;
  /** Additional related seqs (e.g. the failing call and the claim that ignored it). */
  relatedSeqs?: number[];
  /** File path, when the finding is about one. */
  path?: string;
  toolUseId?: string;
  /** True when the anchor event is inside a subagent branch. */
  sidechain?: boolean;
}

export interface CheckRule {
  id: string;
  /** One-sentence description, surfaced by `retrace check --list-rules`. */
  description: string;
  /**
   * The rule's floor severity, surfaced by `retrace check --list-rules`. Not
   * what gets reported: individual findings carry their own `severity`,
   * which a rule may escalate above this floor per finding (see the
   * `Severity` contract above) or a caller may override via
   * `CheckOptions.severity`.
   */
  defaultSeverity: Severity;
  run(events: RetraceEvent[], options: CheckOptions): CheckFinding[];
}

export interface CheckOptions {
  /** Rule ids to skip. */
  disabled?: string[];
  /** Per-rule severity overrides. */
  severity?: Record<string, Severity>;
}

export interface CheckReport {
  sessionId: string;
  eventCount: number;
  findings: CheckFinding[];
  /** Rules that ran, so consumers can distinguish "clean" from "not checked". */
  rulesRun: string[];
  /** Rules that could not run and why — e.g. a rule needing snapshots on a session that has none. */
  rulesSkipped: { ruleId: string; reason: string }[];
}
