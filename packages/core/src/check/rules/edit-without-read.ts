import type { RetraceEvent } from "../../schema.js";
import type { CheckFinding, CheckRule } from "../types.js";
import { normalizePath, toolFilePath } from "../toolInput.js";

const QUALIFYING_OPERATIONS = new Set(["edit", "write", "notebook_edit"]);

/**
 * A file was edited/written/notebook-edited without ever having been read in
 * this session, and wasn't created earlier in this session either (a file
 * this session itself created has no prior state worth reading).
 *
 * Reads are treated as session-global — a read anywhere in the stream
 * (including inside a subagent branch) counts for a later edit anywhere else
 * — to avoid false positives when a subagent legitimately edits a file the
 * parent already read. Findings from a subagent branch are tagged
 * `sidechain: true` so consumers can filter them separately.
 */
export const editWithoutReadRule: CheckRule = {
  id: "edit-without-read",
  description:
    "A file was edited without ever being read in this session. Proxy, not proof: a file read in a previous session, or via `Bash cat`, is invisible here.",
  defaultSeverity: "medium",
  run(events: RetraceEvent[]): CheckFinding[] {
    const readPaths = new Set<string>();
    const createdPaths = new Set<string>();
    const flaggedPaths = new Set<string>();
    const findings: CheckFinding[] = [];

    for (const event of events) {
      if (event.kind === "tool_call" && event.payload.toolName === "Read") {
        const path = toolFilePath(event.payload.input);
        if (path) readPaths.add(normalizePath(path));
        continue;
      }

      if (event.kind !== "file_change") continue;
      const { path, operation, beforeRef } = event.payload;
      const normalized = normalizePath(path);

      // A create, or a write to a path with no prior content (a Write to a
      // nonexistent file), needs no read: this session authored it from
      // scratch and already knows its full contents.
      if (operation === "create" || (operation === "write" && !beforeRef)) {
        createdPaths.add(normalized);
        continue;
      }

      if (!QUALIFYING_OPERATIONS.has(operation)) continue;
      if (readPaths.has(normalized) || createdPaths.has(normalized)) continue;
      if (flaggedPaths.has(normalized)) continue; // fire once per path

      flaggedPaths.add(normalized);
      findings.push({
        ruleId: "edit-without-read",
        severity: "medium",
        title: `${path} edited without being read`,
        detail: `This ${operation} has no preceding Read tool call for this path in the session.`,
        seq: event.seq,
        path,
        toolUseId: event.payload.toolUseId,
        sidechain: event.sidechain === true ? true : undefined,
      });
    }

    return findings;
  },
};
