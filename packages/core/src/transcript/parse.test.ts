import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RetraceEventDraft } from "../schema.js";
import {
  normalizeRecord,
  parseTranscript,
  parseTranscriptLines,
  sessionInfoFromRecord,
} from "./parse.js";

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url)),
    "utf8",
  );
}

function kinds(events: RetraceEventDraft[]): string[] {
  return events.map((e) => e.kind);
}

describe("parseTranscript — basic session", () => {
  const parsed = parseTranscript(fixture("basic-session.jsonl"), "sess-basic");

  it("skips service records and emits only signal + meta events in order", () => {
    // user_prompt, thinking, assistant_text, tool_call, tool_result,
    // tool_call, tool_result(error), assistant_text, unknown->meta, parse-error->meta
    expect(kinds(parsed.events)).toEqual([
      "user_prompt",
      "thinking",
      "assistant_text",
      "tool_call",
      "tool_result",
      "tool_call",
      "tool_result",
      "assistant_text",
      "meta",
      "meta",
    ]);
  });

  it("captures the latest ai-title and session metadata", () => {
    expect(parsed.session.title).toBe("List files and read missing config");
    expect(parsed.session.cwd).toBe("/home/dev/demo");
    expect(parsed.session.gitBranch).toBe("main");
    expect(parsed.session.ccVersion).toBe("2.1.181");
    expect(parsed.session.permissionMode).toBe("default");
  });

  it("extracts the user prompt text and promptId", () => {
    const prompt = parsed.events[0];
    expect(prompt.kind).toBe("user_prompt");
    if (prompt.kind === "user_prompt") {
      expect(prompt.payload.text).toBe("List the files and read the config");
      expect(prompt.payload.promptId).toBe("prompt-1");
    }
  });

  it("preserves tool_call name and input", () => {
    const call = parsed.events[3];
    expect(call.kind).toBe("tool_call");
    if (call.kind === "tool_call") {
      expect(call.payload.toolName).toBe("Bash");
      expect(call.payload.toolUseId).toBe("toolu_1");
      expect(call.payload.input).toEqual({ command: "ls -la" });
    }
  });

  it("flags a tool_result error", () => {
    const errorResult = parsed.events[6];
    expect(errorResult.kind).toBe("tool_result");
    if (errorResult.kind === "tool_result") {
      expect(errorResult.payload.isError).toBe(true);
    }
  });

  it("turns an unknown record type into a meta event that retains the raw record", () => {
    const meta = parsed.events[8];
    expect(meta.kind).toBe("meta");
    if (meta.kind === "meta") {
      expect(meta.payload.originalType).toBe("future-record-type-we-do-not-know");
      expect(meta.payload.raw).toBeDefined();
    }
  });

  it("turns an unparseable line into a meta event instead of throwing", () => {
    const meta = parsed.events[9];
    expect(meta.kind).toBe("meta");
    if (meta.kind === "meta") {
      expect(meta.payload.originalType).toBe("parse-error");
    }
  });

  it("carries a timestamp on every event (falling back when a record omits it)", () => {
    for (const event of parsed.events) {
      expect(typeof event.ts).toBe("string");
      expect(event.ts.length).toBeGreaterThan(0);
    }
  });
});

describe("parseTranscriptLines — backfills leading timestamps", () => {
  it("stamps records that precede the first real timestamp with that timestamp, not the epoch", () => {
    const lines = [
      JSON.stringify({ type: "ai-title", aiTitle: "untimed" }),
      JSON.stringify({ type: "unknown-thing", note: "also untimed" }),
      JSON.stringify({
        type: "user",
        timestamp: "2026-07-15T14:37:00.500Z",
        message: { role: "user", content: "hi" },
      }),
    ];

    const parsed = parseTranscriptLines(lines, "sess-new");

    // ai-title is skipped (known service record); the untimed unknown record
    // and the timed user record remain.
    expect(parsed.events).toHaveLength(2);
    for (const event of parsed.events) {
      expect(event.ts).toBe("2026-07-15T14:37:00.500Z");
    }
  });

  it("respects a real fallbackTs from a prior import instead of backfilling", () => {
    const lines = [JSON.stringify({ type: "unknown-thing", note: "untimed" })];
    const parsed = parseTranscriptLines(lines, "sess-resumed", "2026-07-15T00:00:00.000Z");
    expect(parsed.events[0]?.ts).toBe("2026-07-15T00:00:00.000Z");
  });

  it("falls back to the current time when a batch never carries a real timestamp", () => {
    const before = Date.now();
    const lines = [JSON.stringify({ type: "unknown-thing", note: "untimed" })];
    const parsed = parseTranscriptLines(lines, "sess-untimed");
    const ts = Date.parse(parsed.events[0]?.ts ?? "");
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Date.now());
  });
});

describe("parseTranscript — subagent session", () => {
  const parsed = parseTranscript(fixture("subagent-session.jsonl"), "sess-sub");

  it("marks subagent-branch events with the sidechain flag", () => {
    const sidechainEvents = parsed.events.filter((e) => e.sidechain);
    // The Explore subagent produced: user_prompt, thinking, tool_call,
    // tool_result, assistant_text — all sidechain.
    expect(kinds(sidechainEvents)).toEqual([
      "user_prompt",
      "thinking",
      "tool_call",
      "tool_result",
      "assistant_text",
    ]);
  });

  it("leaves main-branch events unflagged", () => {
    const mainEvents = parsed.events.filter((e) => !e.sidechain);
    expect(mainEvents.every((e) => e.sidechain === undefined)).toBe(true);
    // The main branch dispatches the Task tool call.
    const taskCall = mainEvents.find((e) => e.kind === "tool_call");
    expect(taskCall?.kind === "tool_call" && taskCall.payload.toolName).toBe("Task");
  });
});

describe("normalizeRecord", () => {
  const ctx = { sessionId: "s", fallbackTs: "2026-07-15T00:00:00.000Z" };

  it("uses the fallback timestamp when a record omits its own", () => {
    const events = normalizeRecord(
      { type: "user", message: { role: "user", content: "hi" } },
      ctx,
    );
    expect(events[0]?.ts).toBe(ctx.fallbackTs);
  });

  it("drops empty/whitespace-only text blocks", () => {
    const events = normalizeRecord(
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "   " }] },
      },
      ctx,
    );
    expect(events).toEqual([]);
  });

  it("drops empty/whitespace-only thinking blocks", () => {
    const events = normalizeRecord(
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "thinking", thinking: "" }] },
      },
      ctx,
    );
    expect(events).toEqual([]);

    const whitespaceOnly = normalizeRecord(
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "thinking", thinking: "   \n  " }] },
      },
      ctx,
    );
    expect(whitespaceOnly).toEqual([]);
  });

  it("does not throw on malformed content blocks", () => {
    expect(() =>
      normalizeRecord(
        { type: "assistant", message: { role: "assistant", content: [null, 42, "x"] } },
        ctx,
      ),
    ).not.toThrow();
  });

  it("skips known service records", () => {
    expect(normalizeRecord({ type: "mode" }, ctx)).toEqual([]);
    expect(normalizeRecord({ type: "ai-title", aiTitle: "x" }, ctx)).toEqual([]);
  });
});

describe("parseTranscriptLines — file_change synthesis", () => {
  // A tool_use lives in an assistant record; its result arrives in a *later*,
  // separate user record — real transcript shape, and the reason synthesis
  // can't happen inline while a single record is being normalized.
  function toolUseLine(name: string, input: unknown, id = "toolu_1") {
    return JSON.stringify({
      type: "assistant",
      timestamp: "2026-07-15T00:00:00.000Z",
      message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
    });
  }
  function toolResultLine(toolUseId: string) {
    return JSON.stringify({
      type: "user",
      timestamp: "2026-07-15T00:00:01.000Z",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content: "ok" }] },
    });
  }

  it("inserts the file_change right after the tool_result — never between the call and its result", () => {
    // That gap is exactly what made the tool row's [call, result] span and
    // the file_change's own row overlap, sticking the replay cursor and
    // double-highlighting both rows (the live bug this guards against).
    const parsed = parseTranscriptLines(
      [
        toolUseLine("Edit", { file_path: "/repo/a.ts", old_string: "before", new_string: "after" }),
        toolResultLine("toolu_1"),
      ],
      "s",
    );

    expect(kinds(parsed.events)).toEqual(["tool_call", "tool_result", "file_change"]);
    const change = parsed.events[2];
    if (change.kind !== "file_change") throw new Error("expected file_change");
    expect(change.payload).toMatchObject({
      path: "/repo/a.ts",
      operation: "edit",
      toolName: "Edit",
      toolUseId: "toolu_1",
      oldString: "before",
      newString: "after",
    });
    expect(change.payload.afterRef).toBeUndefined();
    expect(change.artifactRefs).toBeUndefined();
  });

  it("CAS-snapshots a Write's full content as afterRef when a putObject is supplied", () => {
    const parsed = parseTranscriptLines(
      [toolUseLine("Write", { file_path: "/repo/new.ts", content: "hello world" }), toolResultLine("toolu_1")],
      "s",
      undefined,
      (content) => `hash:${content}`,
    );

    const change = parsed.events[2];
    if (change.kind !== "file_change") throw new Error("expected file_change");
    expect(change.payload).toMatchObject({
      path: "/repo/new.ts",
      operation: "write",
      afterRef: "hash:hello world",
    });
    // Declared as an artifact so export bundling / future GC can find it
    // without knowing file_change's payload shape (mirrors hook.ts).
    expect(change.artifactRefs).toEqual(["hash:hello world"]);
  });

  it("degrades a Write to no snapshot when no putObject is supplied", () => {
    const parsed = parseTranscriptLines(
      [toolUseLine("Write", { file_path: "/repo/new.ts", content: "hello world" }), toolResultLine("toolu_1")],
      "s",
    );

    const change = parsed.events[2];
    if (change.kind !== "file_change") throw new Error("expected file_change");
    expect(change.payload.afterRef).toBeUndefined();
    expect(change.artifactRefs).toBeUndefined();
  });

  it("synthesizes only a path for NotebookEdit — the hook doesn't capture notebook content either", () => {
    const parsed = parseTranscriptLines(
      [
        toolUseLine("NotebookEdit", { notebook_path: "/repo/nb.ipynb", new_source: "print(1)" }),
        toolResultLine("toolu_1"),
      ],
      "s",
    );

    const change = parsed.events[2];
    if (change.kind !== "file_change") throw new Error("expected file_change");
    expect(change.payload).toEqual({
      path: "/repo/nb.ipynb",
      operation: "notebook_edit",
      toolName: "NotebookEdit",
      toolUseId: "toolu_1",
    });
  });

  it("does not synthesize a file_change for a non-file tool", () => {
    const parsed = parseTranscriptLines(
      [toolUseLine("Bash", { command: "ls" }), toolResultLine("toolu_1")],
      "s",
    );
    expect(kinds(parsed.events)).toEqual(["tool_call", "tool_result"]);
  });

  it("does not synthesize a file_change when the call carries no path", () => {
    const parsed = parseTranscriptLines(
      [toolUseLine("Edit", { old_string: "a", new_string: "b" }), toolResultLine("toolu_1")],
      "s",
    );
    expect(kinds(parsed.events)).toEqual(["tool_call", "tool_result"]);
  });

  it("falls back to right after the call when no result arrives in this batch (interrupted/pending)", () => {
    const parsed = parseTranscriptLines(
      [toolUseLine("Edit", { file_path: "/repo/a.ts", old_string: "x", new_string: "y" })],
      "s",
    );
    expect(kinds(parsed.events)).toEqual(["tool_call", "file_change"]);
  });

  it("matches each file_change to its own tool_result by toolUseId, across several tool uses in one round-trip", () => {
    const parsed = parseTranscriptLines(
      [
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-07-15T00:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a.ts" } },
              {
                type: "tool_use",
                id: "t2",
                name: "Edit",
                input: { file_path: "/a.ts", old_string: "x", new_string: "y" },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "user",
          timestamp: "2026-07-15T00:00:01.000Z",
          message: {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "t1", content: "file body" },
              { type: "tool_result", tool_use_id: "t2", content: "ok" },
            ],
          },
        }),
      ],
      "s",
    );

    // Read produces no file_change; Edit's lands right after *its own*
    // result, not the first one to arrive.
    expect(kinds(parsed.events)).toEqual([
      "tool_call",
      "tool_call",
      "tool_result",
      "tool_result",
      "file_change",
    ]);
    const change = parsed.events[4];
    expect(change.kind === "file_change" && change.payload.toolUseId).toBe("t2");
  });
});

describe("sessionInfoFromRecord", () => {
  it("pulls the title only from ai-title records", () => {
    expect(sessionInfoFromRecord({ type: "ai-title", aiTitle: "T" }).title).toBe("T");
    expect(sessionInfoFromRecord({ type: "user", aiTitle: "T" }).title).toBeUndefined();
  });
});
