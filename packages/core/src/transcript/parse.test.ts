import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RetraceEventDraft } from "../schema.js";
import { normalizeRecord, parseTranscript, sessionInfoFromRecord } from "./parse.js";

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

describe("sessionInfoFromRecord", () => {
  it("pulls the title only from ai-title records", () => {
    expect(sessionInfoFromRecord({ type: "ai-title", aiTitle: "T" }).title).toBe("T");
    expect(sessionInfoFromRecord({ type: "user", aiTitle: "T" }).title).toBeUndefined();
  });
});
