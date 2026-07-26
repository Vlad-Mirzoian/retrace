/**
 * Defensive, dependency-free readers over `tool_call.payload.input` (typed as
 * `unknown` in the schema since its shape varies per tool). Transcript
 * records come from an undocumented format that shifts between Claude Code
 * releases, so these must never throw on malformed input — a rule that
 * crashes on an unexpected shape takes the whole report down with it.
 */

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** `file_path` (Read/Edit/Write) or `notebook_path` (NotebookEdit), whichever is present. */
export function toolFilePath(input: unknown): string | undefined {
  const record = asRecord(input);
  const path = record.file_path ?? record.notebook_path;
  return typeof path === "string" && path.length > 0 ? path : undefined;
}

export function bashCommand(input: unknown): string | undefined {
  const command = asRecord(input).command;
  return typeof command === "string" && command.length > 0 ? command : undefined;
}

/**
 * Tool names that execute a shell command via `input.command` — not just
 * `Bash`. Claude Code also offers a `PowerShell` tool (the primary shell on
 * Windows, where this project develops), and real sessions use it routinely;
 * a rule that only recognizes `Bash` silently misses a large share of shell
 * activity on this platform.
 */
export const SHELL_TOOL_NAMES = new Set(["Bash", "PowerShell"]);

/**
 * Normalize a path for cross-comparison: unify separators, strip a leading
 * `./`, collapse repeated slashes, drop a trailing slash, and lowercase —
 * Windows paths are case-insensitive, and this project develops on Windows,
 * so comparing paths verbatim produces false positives (the same file
 * appearing as an absolute path, a path with different separators, or with
 * different casing all being treated as distinct).
 */
export function normalizePath(path: string): string {
  let normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith("./")) normalized = normalized.slice(2);
  normalized = normalized.replace(/\/+/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  return normalized.toLowerCase();
}
