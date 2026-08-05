import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RetraceStore } from "retrace-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleHook, type HookPayload } from "./hook.js";

let home: string;
let work: string;
let store: RetraceStore;
const NOW = () => "2026-07-15T14:37:00.000Z";

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "retrace-hook-home-"));
  work = await mkdtemp(join(tmpdir(), "retrace-hook-work-"));
  store = new RetraceStore(home);
});

afterEach(async () => {
  store.close();
  await rm(home, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
});

describe("handleHook — PreToolUse file snapshots", () => {
  it("snapshots an existing file's current content before a Write", async () => {
    const filePath = join(work, "config.json");
    await writeFile(filePath, "OLD CONTENT", "utf8");

    const payload: HookPayload = {
      hook_event_name: "PreToolUse",
      session_id: "sess-1",
      tool_name: "Write",
      tool_input: { file_path: filePath, content: "NEW CONTENT" },
    };

    const [event] = await handleHook(payload, store, NOW);
    expect(event.kind).toBe("file_change");
    if (event.kind === "file_change") {
      expect(event.payload.operation).toBe("write");
      expect(event.payload.path).toBe(filePath);
      expect(event.payload.beforeRef).toBeDefined();
      expect(event.payload.afterRef).toBeDefined();
      // The before-snapshot holds the file's pre-write content.
      expect(await store.objects.getText(event.payload.beforeRef!)).toBe("OLD CONTENT");
      expect(await store.objects.getText(event.payload.afterRef!)).toBe("NEW CONTENT");
    }
  });

  it("records a Write to a new file with no before snapshot", async () => {
    const payload: HookPayload = {
      hook_event_name: "PreToolUse",
      session_id: "sess-1",
      tool_name: "Write",
      tool_input: { file_path: join(work, "brand-new.txt"), content: "hello" },
    };

    const [event] = await handleHook(payload, store, NOW);
    if (event.kind === "file_change") {
      expect(event.payload.beforeRef).toBeUndefined();
      expect(event.payload.afterRef).toBeDefined();
    }
  });

  it("captures the hunk for an Edit and snapshots the file", async () => {
    const filePath = join(work, "app.ts");
    await writeFile(filePath, "before edit", "utf8");

    const payload: HookPayload = {
      hook_event_name: "PreToolUse",
      session_id: "sess-1",
      tool_name: "Edit",
      tool_input: { file_path: filePath, old_string: "foo", new_string: "bar" },
    };

    const [event] = await handleHook(payload, store, NOW);
    if (event.kind === "file_change") {
      expect(event.payload.operation).toBe("edit");
      expect(event.payload.oldString).toBe("foo");
      expect(event.payload.newString).toBe("bar");
      expect(event.payload.beforeRef).toBeDefined();
    }
  });

  it("ignores PreToolUse for non-file tools", async () => {
    const payload: HookPayload = {
      hook_event_name: "PreToolUse",
      session_id: "sess-1",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    };
    expect(await handleHook(payload, store, NOW)).toEqual([]);
  });

  it("appends the file_change into the session's event stream", async () => {
    const filePath = join(work, "x.txt");
    await writeFile(filePath, "x", "utf8");
    await handleHook(
      {
        hook_event_name: "PreToolUse",
        session_id: "sess-1",
        tool_name: "Write",
        tool_input: { file_path: filePath, content: "y" },
      },
      store,
      NOW,
    );

    const events = store.readEvents("sess-1", 0, 10).events;
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("file_change");
  });
});

describe("handleHook — session boundaries", () => {
  it("records SessionStart with cwd and permission mode", async () => {
    const [event] = await handleHook(
      {
        hook_event_name: "SessionStart",
        session_id: "sess-1",
        cwd: "/repo",
        permission_mode: "acceptEdits",
        source: "startup",
      },
      store,
      NOW,
    );
    expect(event.kind).toBe("session_start");
    if (event.kind === "session_start") {
      expect(event.payload.cwd).toBe("/repo");
      expect(event.payload.permissionMode).toBe("acceptEdits");
    }
  });

  it("records SessionEnd and SubagentStop", async () => {
    const [end] = await handleHook(
      { hook_event_name: "SessionEnd", session_id: "sess-1", reason: "clear" },
      store,
      NOW,
    );
    expect(end.kind).toBe("session_end");

    const [sub] = await handleHook(
      { hook_event_name: "SubagentStop", session_id: "sess-1" },
      store,
      NOW,
    );
    expect(sub.kind).toBe("subagent_stop");
  });

  it("does not record end-of-turn Stop events", async () => {
    expect(
      await handleHook({ hook_event_name: "Stop", session_id: "sess-1" }, store, NOW),
    ).toEqual([]);
  });
});

describe("handleHook — robustness", () => {
  it("skips events with no session id", async () => {
    expect(
      await handleHook({ hook_event_name: "SessionStart", cwd: "/x" }, store, NOW),
    ).toEqual([]);
  });

  it("does not throw on a payload with a missing tool_input", async () => {
    await expect(
      handleHook(
        { hook_event_name: "PreToolUse", session_id: "s", tool_name: "Write" },
        store,
        NOW,
      ),
    ).resolves.toEqual([]); // no file_path → no event, no throw
  });
});
