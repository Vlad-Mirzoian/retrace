import type { CheckFinding, CheckReport, RetraceEvent, Severity } from "retrace-core/browser";
import { useState } from "react";
import { CausalTrace } from "../replay/CausalTrace.js";
import { useReplay } from "../replay/ReplayContext.js";

const SEVERITY_ORDER: Severity[] = ["high", "medium", "low"];
const SEVERITY_LABEL: Record<Severity, string> = { high: "High", medium: "Medium", low: "Low" };

/** Distinguishes two findings that happen to anchor to the same seq (a real case — see module 05's flagged-session fixture). */
function findingKey(finding: CheckFinding): string {
  return `${finding.ruleId}:${finding.seq}`;
}

/**
 * The check engine's findings for a session, in the side column above
 * Failures — the conclusion, which Failures/Working tree are the evidence
 * for. Mirrors FailurePanel's interaction: clicking a finding seeks the
 * replay cursor and shows its detail (including the causal trace, when the
 * finding anchors to a tool call) below the list.
 */
export function FindingsPanel({ report, events }: { report: CheckReport; events: RetraceEvent[] }) {
  const { currentSeq, setCurrentSeq, setPlaying } = useReplay();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  function jump(finding: CheckFinding) {
    // A manual pick, same as a replay-control seek — must not have the next
    // autoplay tick immediately carry the cursor away from what was just
    // selected.
    setPlaying(false);
    setCurrentSeq(finding.seq);
    setSelectedKey(findingKey(finding));
  }

  const selected =
    report.findings.find(
      (finding) => findingKey(finding) === selectedKey && finding.seq === currentSeq,
    ) ?? null;

  return (
    <div className="findings-panel">
      {report.findings.length === 0 ? (
        <p className="muted small">No findings — {report.rulesRun.length} rule(s) run.</p>
      ) : (
        SEVERITY_ORDER.map((severity) => {
          const group = report.findings.filter((finding) => finding.severity === severity);
          if (group.length === 0) return null;
          return (
            <div key={severity} className="findings-group">
              <p className="findings-group-heading">{SEVERITY_LABEL[severity]}</p>
              <ul className="findings-list">
                {group.map((finding) => (
                  <li key={findingKey(finding)}>
                    <button
                      type="button"
                      className={`finding-item finding-${finding.severity}${
                        finding === selected ? " active" : ""
                      }`}
                      onClick={() => jump(finding)}
                      aria-pressed={finding === selected}
                    >
                      <span className={`badge badge-severity-${finding.severity}`}>{finding.severity}</span>
                      <span className="finding-rule">{finding.ruleId}</span>
                      <span className="badge">seq {finding.seq}</span>
                      <span className="finding-title">{finding.title}</span>
                      {finding.sidechain && <span className="subagent-tag">subagent</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}

      {selected && (
        <div className="finding-detail">
          {selected.detail && <p className="muted small">{selected.detail}</p>}
          {selected.path && <p className="file-path">{selected.path}</p>}
          {selected.toolUseId && <CausalTrace events={events} seq={selected.seq} />}
        </div>
      )}

      {report.rulesSkipped.length > 0 && (
        <div className="findings-skipped">
          <p className="findings-skipped-heading">Rules skipped</p>
          <ul>
            {report.rulesSkipped.map((skipped) => (
              <li key={skipped.ruleId} className="muted small">
                {skipped.ruleId}: {skipped.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
