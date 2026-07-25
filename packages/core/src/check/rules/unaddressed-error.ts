import type { RetraceEvent } from "../../schema.js";
import { causalChainFor } from "../../replay.js";
import type { CheckFinding, CheckRule, Severity } from "../types.js";
import { bashCommand, toolFilePath } from "../toolInput.js";

const MAX_DETAIL_LENGTH = 120;

/**
 * Tools whose failures are routinely benign and expected (a lookup that
 * comes back empty or missing is a normal outcome, not a stuck agent) — so
 * they're excluded from this rule. This is a structural, tool-name-based
 * scoping decision (not text/NLP-based), mirroring how edit-without-read
 * already keys off `toolName === "Read"`. Without it, a `Read` on a file
 * that legitimately doesn't exist yet (a common "does this exist" probe)
 * would be indistinguishable from a genuinely neglected failure.
 */
const READ_ONLY_TOOLS = new Set(["Read", "Glob", "Grep", "LS"]);

function truncate(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_DETAIL_LENGTH
    ? `${oneLine.slice(0, MAX_DETAIL_LENGTH - 1)}…`
    : oneLine;
}

function firstLine(text: string): string {
  const [line = ""] = text.split("\n");
  return line;
}

function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    return output
      .map((block) => {
        const text = (block as { text?: unknown } | null)?.text;
        return typeof text === "string" ? text : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** The path or command a tool call targets, used to recognize a retry of the same action. */
function retryTarget(input: unknown): string | undefined {
  return toolFilePath(input) ?? bashCommand(input);
}

/**
 * A tool call failed (or an `error` event was recorded) and nothing
 * afterward shows a sign of response: no retry of the same tool against the
 * same target, no file_change, no user_prompt (the human taking over). An
 * assistant's own claim that things are fine deliberately does *not* count
 * — that unverifiable claim is exactly the failure mode this rule exists to
 * surface, not a reason to suppress it.
 */
export const unaddressedErrorRule: CheckRule = {
  id: "unaddressed-error",
  description:
    "A tool call failed (or an error event was recorded) and nothing in the rest of the session — a retry, a file change, or the human taking over — responded to it. Read-only lookups (Read/Glob/Grep/LS) are excluded: a missing file or empty match is routinely expected, not a stuck agent.",
  defaultSeverity: "high",
  run(events: RetraceEvent[]): CheckFinding[] {
    const findings: CheckFinding[] = [];

    for (const event of events) {
      const isFailedResult = event.kind === "tool_result" && event.payload.isError === true;
      const isErrorEvent = event.kind === "error";
      if (!isFailedResult && !isErrorEvent) continue;

      const chain = event.kind === "tool_result" ? causalChainFor(events, event.seq) : undefined;
      const originatingCall = chain?.toolCall;

      if (originatingCall && READ_ONLY_TOOLS.has(originatingCall.payload.toolName)) continue;

      const target = originatingCall ? retryTarget(originatingCall.payload.input) : undefined;
      const after = events.filter((e) => e.seq > event.seq);

      const addressed = after.some((e) => {
        if (e.kind === "user_prompt" || e.kind === "file_change") return true;
        if (
          e.kind === "tool_call" &&
          originatingCall &&
          e.payload.toolName === originatingCall.payload.toolName &&
          target !== undefined
        ) {
          return retryTarget(e.payload.input) === target;
        }
        return false;
      });
      if (addressed) continue;

      const severity: Severity = after.length === 0 ? "high" : "medium";
      const message = event.kind === "error" ? event.payload.message : outputText(event.payload.output);
      const toolName = originatingCall?.payload.toolName;
      const subject = target ?? toolName;

      findings.push({
        ruleId: "unaddressed-error",
        severity,
        title: subject ? `${subject} failed with no follow-up` : "error had no follow-up",
        detail: message ? truncate(firstLine(message)) : undefined,
        seq: event.seq,
        relatedSeqs: originatingCall ? [originatingCall.seq] : undefined,
        path: toolFilePath(originatingCall?.payload.input),
        toolUseId: event.kind === "tool_result" ? event.payload.toolUseId : undefined,
        sidechain: event.sidechain === true ? true : undefined,
      });
    }

    return findings;
  },
};
