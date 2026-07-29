import type { RetraceEvent } from "../../schema.js";
import type { CheckFinding, CheckRule, Severity } from "../types.js";
import { bashCommand, normalizePath, SHELL_TOOL_NAMES } from "../toolInput.js";

const MAX_DETAIL_LENGTH = 120;
/**
 * Hard ceiling on findings this rule emits per session. Real corpora contain
 * sessions with dozens of shell mutations of the same handful of shapes; an
 * unbounded rule can't be attached to a PR (module 06). When the cap is hit,
 * the last slot becomes a summary finding instead of an individual one, so
 * the rule's own output never exceeds this number.
 */
const MAX_FINDINGS_PER_SESSION = 10;

function truncate(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_DETAIL_LENGTH
    ? `${oneLine.slice(0, MAX_DETAIL_LENGTH - 1)}…`
    : oneLine;
}

/** Path segments that mark a location as build/scratch output rather than tracked source. */
const TRANSIENT_PATH_SEGMENTS = /(^|\/)(node_modules|dist|\.git|tmp|temp|scratch|scratchpad)(\/|$)/;
/** A filename that announces itself as scratch output (`scratch-dump.mjs`, `scratch_export.html`), even sitting loose in a tracked directory. */
const SCRATCH_FILENAME = /^scratch[-_.]/;

function isTransientPath(path: string): boolean {
  const normalized = normalizePath(path);
  if (TRANSIENT_PATH_SEGMENTS.test(normalized)) return true;
  const filename = normalized.slice(normalized.lastIndexOf("/") + 1);
  return SCRATCH_FILENAME.test(filename);
}

function stripQuotes(token: string): string {
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return token.slice(1, -1);
    }
  }
  return token;
}

function cleanPath(token: string | undefined): string | undefined {
  if (token === undefined) return undefined;
  // A `\S+`-style token match has no notion of "end of this shell argument"
  // — when the next construct isn't separated by whitespace (`2>/dev/null;`,
  // `2>/dev/null)`), trailing shell metacharacters ride along and defeat an
  // exact-match check like the null-sink test below. They're never
  // legitimately part of an unquoted path in this rule's shapes.
  const stripped = stripQuotes(token).trim().replace(/[;)}&|]+$/, "");
  return stripped.length > 0 ? stripped : undefined;
}

/** Simple whitespace tokenizer that keeps `"quoted"` / `'quoted'` spans intact. */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const re = /"[^"]*"|'[^']*'|\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) tokens.push(match[0]);
  return tokens;
}

/**
 * Null sinks a redirect can never meaningfully "mutate" — POSIX's
 * `/dev/null`, Windows's `NUL`, and PowerShell's `$null`. Redirecting into
 * one of these is the single most common shape in the measured corpus
 * (`2>/dev/null` to silence stderr on a command that isn't otherwise a
 * mutation) and was previously indistinguishable from a real file write.
 */
function isNullSink(target: string): boolean {
  return /^(\/dev\/null|nul|\$null)$/i.test(target);
}

/** Blanks out `"..."` / `'...'` spans (same length, so later index math stays valid) so an operator quoted as literal text isn't mistaken for a real one. */
function blankQuotedSpans(text: string): string {
  return text.replace(/"[^"]*"|'[^']*'/g, (m) => " ".repeat(m.length));
}

/**
 * Joins a POSIX backslash line-continuation (`\` immediately before a
 * newline) into its following line, length-preserved with spaces. Without
 * this, a multi-line command like `rm -f a.txt \` + newline + `b.txt` reads
 * as two statements once split on newlines below — leaving a dangling `\`
 * to be picked up as a bogus path token, and `b.txt` invisible to `rm`'s
 * argument scan entirely.
 */
function joinLineContinuations(text: string): string {
  return text.replace(/\\\r?\n/g, (m) => " ".repeat(m.length));
}

/**
 * Finds a genuine file-writing redirect: `>`/`>>`, optionally preceded by a
 * file descriptor number, whose target is neither a stream merge (`2>&1`,
 * `>&2`) nor a null sink. Plain `fd>file` (e.g. `2>err.log`, a *real* stderr
 * log) still counts — only the merge/null forms are noise.
 *
 * Operator positions are located in the quote-blanked copy (so a `>` that's
 * really just characters inside a quoted string, e.g. `echo "a > b"`, is
 * skipped), but the target itself is re-read from the *original* command
 * through `tokenize` — which does respect quotes — so a legitimately quoted
 * target like `> "release notes.md"` still resolves correctly.
 */
function findRedirectionTarget(command: string): string | undefined {
  const scanned = blankQuotedSpans(command);
  const re = /\d*>{1,2}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(scanned))) {
    const afterOperator = command.slice(match.index + match[0].length);
    const targetToken = tokenize(afterOperator)[0];
    if (targetToken === undefined) continue;
    if (targetToken.startsWith("&")) continue; // stream merge, e.g. 2>&1 / >&2
    const target = cleanPath(targetToken);
    if (target === undefined || isNullSink(target)) continue;
    return target;
  }
  return undefined;
}

/**
 * Splits a command into independent statement segments on newlines, `&&`,
 * `||`, and `;` (not `|` — a pipeline's tail, e.g. `foo | tee out.log`, is
 * one statement for this rule's purposes). Real sessions routinely pass a
 * whole multi-step script as a single Bash `command` string (verification
 * scripts, heredocs); without this, a keyword match on one line would greedily
 * consume argument text from an unrelated later line — e.g. `rm a.ts\ncd
 * repo && pnpm test` previously resolved `rm`'s target as `repo`, from the
 * `cd` on the *next* line, because nothing stopped the scan at the newline.
 * Each segment is matched against `MUTATION_SHAPES` independently, and a
 * shape's arguments are only ever read from its own segment.
 */
function statementSegments(command: string): string[] {
  const scanned = blankQuotedSpans(command);
  const segments: string[] = [];
  let start = 0;
  const stopRe = /\n|&&|\|\||;/g;
  let match: RegExpExecArray | null;
  while ((match = stopRe.exec(scanned))) {
    segments.push(command.slice(start, match.index));
    start = match.index + match[0].length;
  }
  segments.push(command.slice(start));
  return segments;
}

/** Where a shape's own argument scan should stop within its segment — an unrelated trailing redirect, e.g. the `> log.txt` in `cp a.ts b.ts > log.txt`. */
const ARGS_STOP = /\d*>{1,2}/;

/** The segment text following `pattern`'s match, cut off at a trailing redirect so unrelated shell syntax doesn't bleed in. */
function argsAfterMatch(segment: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(blankQuotedSpans(segment));
  if (!match) return undefined;
  const rest = segment.slice(match.index + match[0].length);
  const stop = rest.search(ARGS_STOP);
  return stop === -1 ? rest : rest.slice(0, stop);
}

/** POSIX-style argument scan: strip `-flag` tokens (none of this rule's POSIX shapes take a separate value token), return the first or last remaining positional. */
function posixPositional(argsText: string, position: "first" | "last"): string | undefined {
  const positionals = tokenize(argsText).filter((t) => !t.startsWith("-"));
  if (positionals.length === 0) return undefined;
  return cleanPath(position === "first" ? positionals[0] : positionals[positionals.length - 1]);
}

/** These name the file target; their value is the resolved path. */
const POWERSHELL_PATH_FLAGS = new Set(["-path", "-literalpath", "-filepath", "-destination"]);
/**
 * These take a following value too, but it isn't a path — `-Encoding ascii`,
 * `-Value "text"`. Without knowing this, `ascii`/`"text"` would be mistaken
 * for a bare positional argument (the flag's own dash makes it obviously not
 * one, but its *value* token doesn't start with `-`, so it looks exactly
 * like one) once the scan moves past the flag.
 */
const POWERSHELL_OTHER_VALUE_FLAGS = new Set(["-value", "-itemtype", "-encoding", "-delimiter"]);

/**
 * PowerShell-style argument scan: named flags that take a following value
 * consume it (so its value never gets mistaken for a bare positional
 * argument — see `POWERSHELL_OTHER_VALUE_FLAGS`); an explicit
 * `-Path`/`-LiteralPath`/`-FilePath`/`-Destination` wins outright when
 * present, since that's what PowerShell scripts actually use to name the
 * target. Only known value-taking flags are special-cased — an unrecognized
 * `-Flag` is assumed boolean (like `-Recurse`/`-Force`) and its neighbor is
 * left as a candidate positional.
 */
function powerShellPositional(argsText: string, position: "first" | "last"): string | undefined {
  const tokens = tokenize(argsText);
  const positionals: string[] = [];
  let preferred: string | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith("-")) {
      const key = token.toLowerCase();
      const value = tokens[i + 1];
      const isPathFlag = POWERSHELL_PATH_FLAGS.has(key);
      if ((isPathFlag || POWERSHELL_OTHER_VALUE_FLAGS.has(key)) && value !== undefined) {
        if (isPathFlag) {
          if (key === "-destination") preferred = value;
          else preferred ??= value;
        }
        i++;
      }
      continue;
    }
    positionals.push(token);
  }
  if (preferred !== undefined) return cleanPath(preferred);
  if (positionals.length === 0) return undefined;
  return cleanPath(position === "first" ? positionals[0] : positionals[positionals.length - 1]);
}

type ExtractMode = "redirection" | "posix-first" | "posix-last" | "powershell-first" | "powershell-last" | "none";

interface MutationShape {
  label: string;
  pattern: RegExp;
  extract: ExtractMode;
  /**
   * Near-universal housekeeping: creating a directory, installing a
   * dependency, or reverting to tracked state are expected agent activity,
   * not a gap in Retrace's record worth a reviewer's attention — so these
   * fall to `low` rather than `medium` when (as is essentially always the
   * case) no single file target applies. `extract: "none"` here is
   * deliberate, not a placeholder: a resolvable target for these shapes
   * (a branch name, a ref, a package specifier) isn't a file path, and
   * guessing one risks the "wrongly attributed" failure mode the path
   * extraction is built to avoid.
   */
  housekeeping?: boolean;
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
const MUTATION_SHAPES: MutationShape[] = [
  { label: "sed -i", pattern: /\bsed\s+(?:-\w*i\w*|--in-place)\b/, extract: "posix-last" },
  {
    label: "git checkout/reset/apply/revert",
    pattern: /\bgit\s+(?:checkout|reset|apply|revert)\b/,
    extract: "none",
    housekeeping: true,
  },
  {
    label: "package install",
    pattern: /\b(?:npm|pnpm|yarn)\s+(?:install|i|ci|add|remove|uninstall)\b/,
    extract: "none",
    housekeeping: true,
  },
  { label: "Remove-Item", pattern: /\bRemove-Item\b/i, extract: "powershell-last" },
  { label: "Copy-Item", pattern: /\bCopy-Item\b/i, extract: "powershell-last" },
  { label: "Move-Item", pattern: /\bMove-Item\b/i, extract: "powershell-last" },
  { label: "New-Item", pattern: /\bNew-Item\b/i, extract: "powershell-last" },
  {
    label: "Set-Content / Add-Content / Out-File",
    pattern: /\b(?:Set-Content|Add-Content|Out-File)\b/i,
    extract: "powershell-first",
  },
  { label: "mv", pattern: /\bmv\b/, extract: "posix-last" },
  { label: "cp", pattern: /\bcp\b/, extract: "posix-last" },
  { label: "rm", pattern: /\brm\b/, extract: "posix-last" },
  { label: "mkdir", pattern: /\bmkdir\b/, extract: "none", housekeeping: true },
  { label: "touch", pattern: /\btouch\b/, extract: "posix-last" },
  { label: "patch", pattern: /\bpatch\b/, extract: "none" },
  { label: "tee", pattern: /\btee\b/, extract: "posix-last" },
  {
    label: "output redirection (> / >>)",
    // The authoritative check is `findRedirectionTarget` above (this pattern
    // is kept only for documentation) — a bare `>` also matches noise like
    // `2>/dev/null` and `2>&1`, which is exactly what this module fixes.
    pattern: />{1,2}/,
    extract: "redirection",
  },
];

function matchingShapeInSegment(segment: string): { shape: MutationShape; path: string | undefined } | undefined {
  for (const shape of MUTATION_SHAPES) {
    if (shape.extract === "redirection") {
      const path = findRedirectionTarget(segment);
      if (path !== undefined) return { shape, path };
      continue;
    }
    if (!shape.pattern.test(segment)) continue;

    const path = ((): string | undefined => {
      switch (shape.extract) {
        case "posix-first": {
          const rest = argsAfterMatch(segment, shape.pattern);
          return rest !== undefined ? posixPositional(rest, "first") : undefined;
        }
        case "posix-last": {
          const rest = argsAfterMatch(segment, shape.pattern);
          return rest !== undefined ? posixPositional(rest, "last") : undefined;
        }
        case "powershell-first": {
          const rest = argsAfterMatch(segment, shape.pattern);
          return rest !== undefined ? powerShellPositional(rest, "first") : undefined;
        }
        case "powershell-last": {
          const rest = argsAfterMatch(segment, shape.pattern);
          return rest !== undefined ? powerShellPositional(rest, "last") : undefined;
        }
        case "none":
        default:
          return undefined;
      }
    })();
    return { shape, path };
  }
  return undefined;
}

/**
 * Finds the first shape a command matches, scanning statement by statement
 * (see `statementSegments`) so a shape's arguments are only ever read from
 * the same statement its keyword appeared in.
 */
function matchingShape(command: string): { shape: MutationShape; path: string | undefined } | undefined {
  for (const segment of statementSegments(joinLineContinuations(command))) {
    const found = matchingShapeInSegment(segment);
    if (found) return found;
  }
  return undefined;
}

function severityFor(shape: MutationShape, resolvedPath: string | undefined): Severity {
  if (resolvedPath !== undefined) return isTransientPath(resolvedPath) ? "low" : "medium";
  return shape.housekeeping ? "low" : "medium";
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
    "A Bash or PowerShell command matched a filesystem-mutation shape (redirection, sed -i, mv/cp/rm, Remove-Item, git checkout/reset, package install, ...) with no corresponding file_change event — these changes are outside Retrace's record, and also outside Claude Code's own /rewind, which does not track files modified by shell commands either. Excludes stderr-to-null and stream-merge redirects (2>/dev/null, 2>&1), names the target file when it can be resolved from the command text, and collapses to one finding per distinct (shape, resolved file) pair per session, capped at 10 with a trailing summary of any remainder.",
  defaultSeverity: "medium",
  run(events: RetraceEvent[]): CheckFinding[] {
    const fileChangeToolUseIds = new Set(
      events
        .filter((e): e is Extract<RetraceEvent, { kind: "file_change" }> => e.kind === "file_change")
        .map((e) => e.payload.toolUseId)
        .filter((id): id is string => id !== undefined),
    );

    const seen = new Map<string, CheckFinding>();

    for (const event of events) {
      if (event.kind !== "tool_call" || !SHELL_TOOL_NAMES.has(event.payload.toolName)) continue;
      const command = bashCommand(event.payload.input);
      if (!command) continue;
      if (fileChangeToolUseIds.has(event.payload.toolUseId)) continue;

      const match = matchingShape(command);
      if (!match) continue;
      const { shape, path } = match;

      const groupKey = `${shape.label} ${path ? normalizePath(path) : ""}`;
      if (seen.has(groupKey)) continue;

      const severity = severityFor(shape, path);
      const title = path
        ? `${path} may have been modified by a shell command, outside Retrace's record`
        : `${event.payload.toolName} command (${shape.label}) may have modified files outside Retrace's record`;

      seen.set(groupKey, {
        ruleId: "untracked-bash-mutation",
        severity,
        title,
        detail: truncate(command),
        seq: event.seq,
        path,
        toolUseId: event.payload.toolUseId,
        sidechain: event.sidechain === true ? true : undefined,
      });
    }

    const findings = [...seen.values()];
    if (findings.length <= MAX_FINDINGS_PER_SESSION) return findings;

    const kept = findings.slice(0, MAX_FINDINGS_PER_SESSION - 1);
    const overflow = findings.length - kept.length;
    kept.push({
      ruleId: "untracked-bash-mutation",
      severity: "low",
      title: `${overflow} more untracked-bash-mutation finding(s) in this session were suppressed (capped at ${MAX_FINDINGS_PER_SESSION})`,
      seq: findings[kept.length].seq,
    });
    return kept;
  },
};
