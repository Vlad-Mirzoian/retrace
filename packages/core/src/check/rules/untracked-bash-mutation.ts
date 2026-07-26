import type { RetraceEvent } from "../../schema.js";
import type { CheckFinding, CheckRule } from "../types.js";
import { bashCommand, SHELL_TOOL_NAMES } from "../toolInput.js";

const MAX_DETAIL_LENGTH = 120;

function truncate(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_DETAIL_LENGTH
    ? `${oneLine.slice(0, MAX_DETAIL_LENGTH - 1)}…`
    : oneLine;
}

/**
 * Conservative shapes of a shell command that write to the filesystem —
 * both POSIX/Bash ones and PowerShell's native cmdlets, since this project
 * develops on Windows and real sessions run PowerShell about as often as a
 * POSIX shell (`rm`/`cp`/`mv`/`mkdir` are also PowerShell's builtin aliases,
 * so those patterns already cover both). Ordered list (not a set) so a
 * command matching several shapes is attributed to the first, most specific
 * one it hits.
 */
const MUTATION_SHAPES: { label: string; pattern: RegExp }[] = [
  { label: "sed -i", pattern: /\bsed\s+(?:-\w*i\w*|--in-place)\b/ },
  { label: "git checkout/reset/apply/revert", pattern: /\bgit\s+(?:checkout|reset|apply|revert)\b/ },
  { label: "package install", pattern: /\b(?:npm|pnpm|yarn)\s+(?:install|i|ci|add|remove|uninstall)\b/ },
  { label: "Remove-Item", pattern: /\bRemove-Item\b/i },
  { label: "Copy-Item", pattern: /\bCopy-Item\b/i },
  { label: "Move-Item", pattern: /\bMove-Item\b/i },
  { label: "New-Item", pattern: /\bNew-Item\b/i },
  { label: "Set-Content / Add-Content / Out-File", pattern: /\b(?:Set-Content|Add-Content|Out-File)\b/i },
  { label: "mv", pattern: /\bmv\b/ },
  { label: "cp", pattern: /\bcp\b/ },
  { label: "rm", pattern: /\brm\b/ },
  { label: "mkdir", pattern: /\bmkdir\b/ },
  { label: "touch", pattern: /\btouch\b/ },
  { label: "patch", pattern: /\bpatch\b/ },
  { label: "tee", pattern: /\btee\b/ },
  { label: "output redirection (> / >>)", pattern: />{1,2}/ },
];

function mutationShape(command: string): string | undefined {
  return MUTATION_SHAPES.find((shape) => shape.pattern.test(command))?.label;
}

/**
 * A `Bash` or `PowerShell` command matched a filesystem-mutation shape. This
 * is the only rule here that isn't NLP-heuristic — it's a structural fact
 * about the system, not the transcript: Claude Code's PreToolUse hook (and
 * this historical parser) only ever synthesize `file_change` events for
 * Write/Edit/NotebookEdit tool calls, never for a shell tool, so a mutating
 * shell command is *always* absent from the working-tree reconstruction. The
 * `file_change` check below is therefore mostly documentation of that fact
 * (and a guard against it silently changing later) rather than a filter that
 * currently excludes anything.
 */
export const untrackedBashMutationRule: CheckRule = {
  id: "untracked-bash-mutation",
  description:
    "A Bash or PowerShell command matched a filesystem-mutation shape (redirection, sed -i, mv/cp/rm, Remove-Item, git checkout/reset, package install, ...) with no corresponding file_change event — these changes are outside Retrace's record, and also outside Claude Code's own /rewind, which does not track files modified by shell commands either. Collapsed to one finding per distinct mutation shape per session.",
  defaultSeverity: "medium",
  run(events: RetraceEvent[]): CheckFinding[] {
    const fileChangeToolUseIds = new Set(
      events
        .filter((e): e is Extract<RetraceEvent, { kind: "file_change" }> => e.kind === "file_change")
        .map((e) => e.payload.toolUseId)
        .filter((id): id is string => id !== undefined),
    );

    const seenShapes = new Set<string>();
    const findings: CheckFinding[] = [];

    for (const event of events) {
      if (event.kind !== "tool_call" || !SHELL_TOOL_NAMES.has(event.payload.toolName)) continue;
      const command = bashCommand(event.payload.input);
      if (!command) continue;

      const shape = mutationShape(command);
      if (!shape) continue;
      if (fileChangeToolUseIds.has(event.payload.toolUseId)) continue;
      if (seenShapes.has(shape)) continue;
      seenShapes.add(shape);

      findings.push({
        ruleId: "untracked-bash-mutation",
        severity: "medium",
        title: `${event.payload.toolName} command (${shape}) may have modified files outside Retrace's record`,
        detail: truncate(command),
        seq: event.seq,
        toolUseId: event.payload.toolUseId,
        sidechain: event.sidechain === true ? true : undefined,
      });
    }

    return findings;
  },
};
