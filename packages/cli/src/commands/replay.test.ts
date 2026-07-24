import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RetraceStore } from "retrace-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startReplay } from "./replay.js";

let home: string;
let store: RetraceStore;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "retrace-replay-"));
  store = new RetraceStore(home);
  store.ensureSession({ id: "sess-full-id" });
});

afterEach(async () => {
  store.close();
  await rm(home, { recursive: true, force: true });
});

describe("startReplay", () => {
  it("opens the browser at /sessions/:id with the resolved session id", async () => {
    const launch = vi.fn();
    const handle = await startReplay(store, "sess-full", { openBrowser: true, launch, log: () => {} });
    try {
      expect(launch).toHaveBeenCalledWith(`${handle.url}/sessions/sess-full-id`);
    } finally {
      await handle.stop();
    }
  });

  it("resolves a unique id prefix", async () => {
    const launch = vi.fn();
    const handle = await startReplay(store, "sess-f", { openBrowser: true, launch, log: () => {} });
    try {
      expect(launch).toHaveBeenCalledWith(expect.stringContaining("/sessions/sess-full-id"));
    } finally {
      await handle.stop();
    }
  });

  it("throws when the id matches no session", () => {
    expect(() =>
      startReplay(store, "does-not-exist", { openBrowser: false, launch: () => {} }),
    ).toThrow(/no session matches/);
  });

  it("does not launch a browser when openBrowser is false", async () => {
    const launch = vi.fn();
    const handle = await startReplay(store, "sess-full", { openBrowser: false, launch, log: () => {} });
    try {
      expect(launch).not.toHaveBeenCalled();
    } finally {
      await handle.stop();
    }
  });

  it("still serves the normal API alongside the replay view", async () => {
    const handle = await startReplay(store, "sess-full", { openBrowser: false, launch: () => {}, log: () => {} });
    try {
      const res = await fetch(`${handle.url}/api/sessions/sess-full-id`);
      expect(res.status).toBe(200);
    } finally {
      await handle.stop();
    }
  });
});
