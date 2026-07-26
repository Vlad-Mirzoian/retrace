import type { RetraceEvent } from "../../schema.js";
import type { CheckFinding, CheckRule } from "../types.js";
import { normalizePath } from "../toolInput.js";
import { extractClaims } from "../claims.js";

function segments(path: string): string[] {
  return normalizePath(path).split("/").filter(Boolean);
}

/** Basename plus one parent segment, e.g. "src/auth.ts" from "/repo/src/auth.ts" — the assistant usually writes a short relative path while the event carries an absolute one, so a full-path comparison would almost never match. */
function pathKey(path: string): string {
  return segments(path).slice(-2).join("/");
}

function basename(path: string): string {
  const parts = segments(path);
  return parts[parts.length - 1] ?? "";
}

/**
 * The assistant said it changed a file, but no `file_change` for a matching
 * path exists anywhere in the session — not just after the claim, since the
 * assistant may describe a change it made a moment earlier.
 *
 * The most misfire-prone rule of the three: suppressed whenever *any*
 * file_change shares the claimed path's basename, even without a matching
 * parent segment, erring heavily toward silence over a false positive.
 */
export const claimedChangeMissingRule: CheckRule = {
  id: "claimed-change-missing",
  description:
    "The assistant said it changed a file, but no file_change for that path was recorded anywhere in the session. Matches on basename plus a parent segment (not the full path) and suppresses on any basename match, since the assistant's prose path and the event's path rarely agree exactly.",
  defaultSeverity: "low",
  run(events: RetraceEvent[]): CheckFinding[] {
    const changedPaths = events
      .filter((e): e is Extract<RetraceEvent, { kind: "file_change" }> => e.kind === "file_change")
      .map((e) => e.payload.path);

    // A read-only/planning session has nothing to compare against — the
    // pattern this rule looks for doesn't apply.
    if (changedPaths.length === 0) return [];

    const changedKeys = new Set(changedPaths.map(pathKey));
    const changedBasenames = new Set(changedPaths.map(basename));

    const claims = extractClaims(events).filter(
      (c): c is typeof c & { subject: string } => c.kind === "file-modified" && !!c.subject,
    );

    const findings: CheckFinding[] = [];
    const flagged = new Set<string>();

    for (const claim of claims) {
      const key = pathKey(claim.subject);
      if (changedKeys.has(key) || changedBasenames.has(basename(claim.subject))) continue;
      if (flagged.has(key)) continue; // fire once per distinct claimed path
      flagged.add(key);

      findings.push({
        ruleId: "claimed-change-missing",
        severity: "low",
        title: `${claim.subject} claimed changed, but no matching file_change was recorded`,
        detail: claim.excerpt,
        seq: claim.seq,
        path: claim.subject,
      });
    }

    return findings;
  },
};
