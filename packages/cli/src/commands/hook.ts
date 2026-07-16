import { existsSync, readFileSync } from "node:fs";
import { RetraceStore, type RetraceEventDraft } from "retrace-core";

/**
 * The JSON payload Claude Code writes to a hook command's stdin. Field names
 * are snake_case (verified against the Claude Code 2.1.x binary). All optional
 * — the handler is defensive and never assumes a field is present.
 */
export interface HookPayload {
  hook_event_name?: string;
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  permission_mode?: string;
  source?: string;
  reason?: string;
}

/** Tools whose target file we snapshot before the edit lands. */
const SNAPSHOT_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

function operationFor(toolName: string): "write" | "edit" | "notebook_edit" {
  if (toolName === "Write") return "write";
  if (toolName === "NotebookEdit") return "notebook_edit";
  return "edit";
}

async function fileChangeDraft(
  payload: HookPayload,
  store: RetraceStore,
  ts: string,
  sessionId: string,
): Promise<RetraceEventDraft | null> {
  const toolName = payload.tool_name;
  if (!toolName) return null;
  const input = (payload.tool_input ?? {}) as Record<string, unknown>;

  const path =
    typeof input.file_path === "string"
      ? input.file_path
      : typeof input.notebook_path === "string"
        ? input.notebook_path
        : "";
  if (!path) return null;

  const fileChange: Extract<RetraceEventDraft, { kind: "file_change" }>["payload"] = {
    path,
    operation: operationFor(toolName),
    toolName,
  };

  // The key value-add of the hook: snapshot the file's *current* content, which
  // the transcript never records for a whole-file Write. Done in a PreToolUse
  // hook, so this is the true "before" state.
  if (existsSync(path)) {
    try {
      fileChange.beforeRef = await store.objects.put(readFileSync(path));
    } catch {
      // Unreadable file (permissions, race) — record the change without a snapshot.
    }
  }

  // Write carries the full intended content; stash it as the "after" snapshot.
  if (toolName === "Write" && typeof input.content === "string") {
    fileChange.afterRef = await store.objects.put(input.content);
  }
  // Edit carries the hunk directly; keep it so the viewer needs no correlation.
  if (toolName === "Edit") {
    if (typeof input.old_string === "string") fileChange.oldString = input.old_string;
    if (typeof input.new_string === "string") fileChange.newString = input.new_string;
  }

  return { ts, sessionId, kind: "file_change", payload: fileChange };
}

/**
 * Turn one Claude Code hook payload into event drafts and append them to the
 * store. Returns the drafts (for testing). Unknown/unhandled events yield none.
 */
export async function handleHook(
  payload: HookPayload,
  store: RetraceStore,
  now: () => string = () => new Date().toISOString(),
): Promise<RetraceEventDraft[]> {
  const sessionId = payload.session_id;
  if (!sessionId) return []; // can't attribute the event to a session

  const ts = now();
  const drafts: RetraceEventDraft[] = [];

  switch (payload.hook_event_name) {
    case "PreToolUse": {
      if (payload.tool_name && SNAPSHOT_TOOLS.has(payload.tool_name)) {
        const draft = await fileChangeDraft(payload, store, ts, sessionId);
        if (draft) drafts.push(draft);
      }
      break;
    }
    case "SessionStart": {
      const start: Extract<RetraceEventDraft, { kind: "session_start" }>["payload"] = {};
      if (typeof payload.cwd === "string") start.cwd = payload.cwd;
      if (typeof payload.permission_mode === "string") start.permissionMode = payload.permission_mode;
      drafts.push({ ts, sessionId, kind: "session_start", payload: start });
      break;
    }
    case "SessionEnd": {
      drafts.push({
        ts,
        sessionId,
        kind: "session_end",
        payload: typeof payload.reason === "string" ? { reason: payload.reason } : {},
      });
      break;
    }
    case "SubagentStop": {
      drafts.push({ ts, sessionId, kind: "subagent_stop", payload: {} });
      break;
    }
    default:
      break; // other events (Stop, PostToolUse, ...) are not recorded
  }

  for (const draft of drafts) store.appendEvent(draft);
  return drafts;
}

/** Read all of stdin as a UTF-8 string. */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Entry point for `retrace hook`: read the payload from stdin, record it, and
 * always exit cleanly. A hook must never break the user's Claude Code session,
 * so every failure path is swallowed (logged to stderr) rather than thrown.
 */
export async function runHook(createStore: () => RetraceStore): Promise<void> {
  let raw: string;
  try {
    raw = await readStdin();
  } catch {
    return;
  }
  if (!raw.trim()) return;

  let payload: HookPayload;
  try {
    payload = JSON.parse(raw) as HookPayload;
  } catch {
    return; // malformed payload — do nothing, but don't fail the tool call
  }

  const store = createStore();
  try {
    await handleHook(payload, store);
  } catch (err) {
    process.stderr.write(`retrace hook: ${(err as Error).message}\n`);
  } finally {
    store.close();
  }
}
