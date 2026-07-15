import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Default command Claude Code will invoke for each managed hook event. */
export const DEFAULT_HOOK_COMMAND = "retrace hook";

interface ManagedHook {
  event: string;
  /** Tool-name regex for tool-scoped events (PreToolUse); absent otherwise. */
  matcher?: string;
}

/**
 * The hook events Retrace installs. PreToolUse is scoped to file-writing tools
 * (so we snapshot before an edit lands); the rest mark session/subagent
 * boundaries. Note: we deliberately use SessionEnd — not Stop — for the
 * end-of-session boundary, since Stop fires at the end of *every* assistant
 * turn, not once per session.
 */
export const MANAGED_HOOKS: readonly ManagedHook[] = [
  { event: "PreToolUse", matcher: "Write|Edit|NotebookEdit" },
  { event: "SessionStart" },
  { event: "SessionEnd" },
  { event: "SubagentStop" },
];

interface HookEntry {
  type: "command";
  command: string;
}
interface HookGroup {
  matcher?: string;
  hooks: HookEntry[];
}

function groupHasCommand(group: unknown, command: string): boolean {
  const hooks = (group as { hooks?: unknown }).hooks;
  return (
    Array.isArray(hooks) &&
    hooks.some((h) => (h as { command?: unknown }).command === command)
  );
}

/**
 * Merge Retrace's managed hooks into an existing settings object without
 * disturbing any other hooks or settings. Idempotent: if our command is
 * already present for an event, that event is left untouched. Returns a new
 * object plus whether anything changed.
 */
export function mergeHooks(
  settings: Record<string, unknown>,
  command: string = DEFAULT_HOOK_COMMAND,
): { settings: Record<string, unknown>; changed: boolean } {
  const next = structuredClone(settings);
  const hooks = (next.hooks ??= {}) as Record<string, unknown>;
  let changed = false;

  for (const managed of MANAGED_HOOKS) {
    const existing = hooks[managed.event];
    const groups: unknown[] = Array.isArray(existing) ? existing : [];
    if (!Array.isArray(existing)) hooks[managed.event] = groups;

    if (groups.some((group) => groupHasCommand(group, command))) continue;

    const group: HookGroup = {
      ...(managed.matcher ? { matcher: managed.matcher } : {}),
      hooks: [{ type: "command", command }],
    };
    groups.push(group);
    changed = true;
  }

  return { settings: next, changed };
}

export interface InitOptions {
  settingsPath: string;
  command?: string;
}

export interface InitResult {
  settingsPath: string;
  changed: boolean;
  created: boolean;
  backupPath?: string;
}

/** Resolve the settings.json path for `retrace init` (project by default). */
export function resolveSettingsPath(opts: {
  global?: boolean;
  cwd?: string;
  home?: string;
}): string {
  const root = opts.global ? (opts.home ?? homedir()) : (opts.cwd ?? process.cwd());
  return join(root, ".claude", "settings.json");
}

/**
 * Install Retrace hooks into a Claude Code settings file. Parses the existing
 * file (refusing to touch it if it's malformed rather than clobbering), backs
 * it up before writing, and preserves all existing content.
 */
export function initHooks(opts: InitOptions): InitResult {
  const command = opts.command ?? DEFAULT_HOOK_COMMAND;
  const existed = existsSync(opts.settingsPath);

  let current: Record<string, unknown> = {};
  if (existed) {
    const text = readFileSync(opts.settingsPath, "utf8");
    if (text.trim()) {
      try {
        current = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new Error(
          `refusing to modify malformed JSON settings at ${opts.settingsPath}`,
        );
      }
    }
  }

  const { settings, changed } = mergeHooks(current, command);
  if (!changed) {
    return { settingsPath: opts.settingsPath, changed: false, created: false };
  }

  let backupPath: string | undefined;
  if (existed) {
    backupPath = `${opts.settingsPath}.backup-${Date.now()}`;
    copyFileSync(opts.settingsPath, backupPath);
  } else {
    mkdirSync(dirname(opts.settingsPath), { recursive: true });
  }

  writeFileSync(opts.settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return { settingsPath: opts.settingsPath, changed: true, created: !existed, backupPath };
}
