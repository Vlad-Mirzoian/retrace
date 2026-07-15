import { z } from "zod";

/**
 * Schema version stamped by the store so future Retrace releases can migrate
 * on-disk events. Bump when the event shape changes incompatibly.
 */
export const RETRACE_SCHEMA_VERSION = 1;

/**
 * The full set of normalized event kinds. Every Claude Code transcript record
 * (and every hook payload) is mapped onto one of these; anything unrecognized
 * becomes a `meta` event rather than being dropped or throwing.
 */
export const EVENT_KINDS = [
  "session_start",
  "user_prompt",
  "assistant_text",
  "thinking",
  "tool_call",
  "tool_result",
  "file_change",
  "subagent_start",
  "subagent_stop",
  "session_end",
  "error",
  "meta",
] as const;

export const EventKind = z.enum(EVENT_KINDS);
export type EventKind = z.infer<typeof EventKind>;

// --- Per-kind payloads -----------------------------------------------------

export const SessionStartPayload = z.object({
  project: z.string().optional(),
  cwd: z.string().optional(),
  gitBranch: z.string().optional(),
  ccVersion: z.string().optional(),
  permissionMode: z.string().optional(),
  title: z.string().optional(),
});
export type SessionStartPayload = z.infer<typeof SessionStartPayload>;

export const UserPromptPayload = z.object({
  text: z.string(),
  /** Claude Code's promptId, when present, to correlate a turn's records. */
  promptId: z.string().optional(),
});
export type UserPromptPayload = z.infer<typeof UserPromptPayload>;

export const AssistantTextPayload = z.object({
  text: z.string(),
  model: z.string().optional(),
});
export type AssistantTextPayload = z.infer<typeof AssistantTextPayload>;

export const ThinkingPayload = z.object({
  text: z.string(),
  signature: z.string().optional(),
});
export type ThinkingPayload = z.infer<typeof ThinkingPayload>;

export const ToolCallPayload = z.object({
  toolName: z.string(),
  toolUseId: z.string(),
  /** Raw tool input object; shape varies per tool, kept as-is. */
  input: z.unknown(),
});
export type ToolCallPayload = z.infer<typeof ToolCallPayload>;

export const ToolResultPayload = z.object({
  toolUseId: z.string(),
  /** String or array of content blocks, as emitted by the tool. */
  output: z.unknown(),
  isError: z.boolean().optional(),
});
export type ToolResultPayload = z.infer<typeof ToolResultPayload>;

export const FILE_OPERATIONS = [
  "write",
  "edit",
  "create",
  "delete",
  "notebook_edit",
] as const;

export const FileChangePayload = z.object({
  path: z.string(),
  operation: z.enum(FILE_OPERATIONS),
  toolName: z.string().optional(),
  toolUseId: z.string().optional(),
  /** CAS hash of the file's contents before the change (from a PreToolUse hook). */
  beforeRef: z.string().optional(),
  /** CAS hash of the file's contents after the change, when captured. */
  afterRef: z.string().optional(),
  /** For Edit-style changes, the literal strings so a diff can be shown without a snapshot. */
  oldString: z.string().optional(),
  newString: z.string().optional(),
});
export type FileChangePayload = z.infer<typeof FileChangePayload>;

export const SubagentStartPayload = z.object({
  description: z.string().optional(),
  /** The parent tool_use id (Task tool call) that spawned this subagent, if known. */
  parentToolUseId: z.string().optional(),
});
export type SubagentStartPayload = z.infer<typeof SubagentStartPayload>;

export const SubagentStopPayload = z.object({
  description: z.string().optional(),
});
export type SubagentStopPayload = z.infer<typeof SubagentStopPayload>;

export const SessionEndPayload = z.object({
  reason: z.string().optional(),
});
export type SessionEndPayload = z.infer<typeof SessionEndPayload>;

export const ErrorPayload = z.object({
  message: z.string(),
  detail: z.unknown().optional(),
});
export type ErrorPayload = z.infer<typeof ErrorPayload>;

export const MetaPayload = z.object({
  /** The original transcript/hook record type this meta event stands in for. */
  originalType: z.string().optional(),
  note: z.string().optional(),
  /** Original record kept verbatim for reprocessing by future parser versions. */
  raw: z.unknown().optional(),
});
export type MetaPayload = z.infer<typeof MetaPayload>;

/** Maps each kind to its payload schema — the single source of truth. */
export const PAYLOAD_SCHEMAS = {
  session_start: SessionStartPayload,
  user_prompt: UserPromptPayload,
  assistant_text: AssistantTextPayload,
  thinking: ThinkingPayload,
  tool_call: ToolCallPayload,
  tool_result: ToolResultPayload,
  file_change: FileChangePayload,
  subagent_start: SubagentStartPayload,
  subagent_stop: SubagentStopPayload,
  session_end: SessionEndPayload,
  error: ErrorPayload,
  meta: MetaPayload,
} as const satisfies Record<EventKind, z.ZodTypeAny>;

// --- Event envelope --------------------------------------------------------

/** Fields present on an event before it is sealed into the hash chain. */
const draftFields = {
  /** ISO-8601 timestamp. Kept as a plain string to tolerate transcript quirks. */
  ts: z.string(),
  sessionId: z.string(),
  /** True when this event belongs to a subagent (sidechain) branch. */
  sidechain: z.boolean().optional(),
  /** CAS hashes this event references (file snapshots, offloaded large payloads). */
  artifactRefs: z.array(z.string()).optional(),
};

/** Fields added by the store when the event is assigned a position and sealed. */
const sealedFields = {
  ...draftFields,
  /** 0-based position within the session's event stream. */
  seq: z.number().int().nonnegative(),
  /** Hash of the previous sealed event; null for the first event in a session. */
  prevHash: z.string().nullable(),
  /** Hash of this event's canonical form (see chain.ts). */
  hash: z.string(),
};

function variant<K extends EventKind>(
  base: typeof draftFields | typeof sealedFields,
  kind: K,
) {
  return z.object({
    ...base,
    kind: z.literal(kind),
    payload: PAYLOAD_SCHEMAS[kind],
  });
}

/**
 * A parsed-but-unsealed event: produced by the transcript parser and hook
 * handler before the store assigns a `seq` and computes the hash chain.
 */
export const RetraceEventDraft = z.discriminatedUnion("kind", [
  variant(draftFields, "session_start"),
  variant(draftFields, "user_prompt"),
  variant(draftFields, "assistant_text"),
  variant(draftFields, "thinking"),
  variant(draftFields, "tool_call"),
  variant(draftFields, "tool_result"),
  variant(draftFields, "file_change"),
  variant(draftFields, "subagent_start"),
  variant(draftFields, "subagent_stop"),
  variant(draftFields, "session_end"),
  variant(draftFields, "error"),
  variant(draftFields, "meta"),
]);
export type RetraceEventDraft = z.infer<typeof RetraceEventDraft>;

/** A sealed event as persisted to `events.jsonl`, with seq and hash chain. */
export const RetraceEvent = z.discriminatedUnion("kind", [
  variant(sealedFields, "session_start"),
  variant(sealedFields, "user_prompt"),
  variant(sealedFields, "assistant_text"),
  variant(sealedFields, "thinking"),
  variant(sealedFields, "tool_call"),
  variant(sealedFields, "tool_result"),
  variant(sealedFields, "file_change"),
  variant(sealedFields, "subagent_start"),
  variant(sealedFields, "subagent_stop"),
  variant(sealedFields, "session_end"),
  variant(sealedFields, "error"),
  variant(sealedFields, "meta"),
]);
export type RetraceEvent = z.infer<typeof RetraceEvent>;

/** Narrow a sealed event to a specific kind (handy in the viewer/tests). */
export function isKind<K extends EventKind>(
  event: RetraceEvent,
  kind: K,
): event is Extract<RetraceEvent, { kind: K }> {
  return event.kind === kind;
}
