import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RetraceStore } from "retrace-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetStore } from "./reset.js";

let home: string;
let store: RetraceStore;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "retrace-reset-"));
  store = new RetraceStore(home);
});

afterEach(async () => {
  store.close();
  await rm(home, { recursive: true, force: true });
});

describe("resetStore", () => {
  it("reports the session count from before the wipe, and deletes the home directory", () => {
    store.appendEvent({
      ts: "2026-07-15T14:37:00.000Z",
      sessionId: "s1",
      kind: "user_prompt",
      payload: { text: "one" },
    });
    store.appendEvent({
      ts: "2026-07-15T14:37:00.000Z",
      sessionId: "s2",
      kind: "user_prompt",
      payload: { text: "two" },
    });

    const result = resetStore(store);

    expect(result.sessionCount).toBe(2);
    expect(result.homeDir).toBe(home);
    expect(existsSync(home)).toBe(false);
  });

  it("reports zero sessions for an empty store", () => {
    const result = resetStore(store);
    expect(result.sessionCount).toBe(0);
  });
});
