import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RetraceStore } from "retrace-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startCompare } from "./compare.js";

let home: string;
let store: RetraceStore;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "retrace-compare-"));
  store = new RetraceStore(home);
  store.ensureSession({ id: "sess-aaaa-full-id" });
  store.ensureSession({ id: "sess-bbbb-full-id" });
});

afterEach(async () => {
  store.close();
  await rm(home, { recursive: true, force: true });
});

describe("startCompare", () => {
  it("opens the browser at /compare with both resolved session ids", async () => {
    const launch = vi.fn();
    const handle = await startCompare(store, "sess-aaaa", "sess-bbbb", {
      openBrowser: true,
      launch,
      log: () => {},
    });
    try {
      expect(launch).toHaveBeenCalledWith(
        `${handle.url}/compare?a=sess-aaaa-full-id&b=sess-bbbb-full-id`,
      );
    } finally {
      await handle.stop();
    }
  });

  it("resolves unique id prefixes for both sides", async () => {
    const launch = vi.fn();
    const handle = await startCompare(store, "sess-aaaa", "sess-bbbb", {
      openBrowser: true,
      launch,
      log: () => {},
    });
    try {
      expect(launch.mock.calls[0][0]).toContain("a=sess-aaaa-full-id");
      expect(launch.mock.calls[0][0]).toContain("b=sess-bbbb-full-id");
    } finally {
      await handle.stop();
    }
  });

  it("throws when either id matches no session", () => {
    // resolveSessionId runs synchronously before the server ever starts, so
    // this throws directly rather than rejecting the returned promise.
    expect(() =>
      startCompare(store, "does-not-exist", "sess-bbbb", { openBrowser: false, launch: () => {} }),
    ).toThrow(/no session matches/);
  });

  it("does not launch a browser when openBrowser is false", async () => {
    const launch = vi.fn();
    const handle = await startCompare(store, "sess-aaaa", "sess-bbbb", {
      openBrowser: false,
      launch,
      log: () => {},
    });
    try {
      expect(launch).not.toHaveBeenCalled();
    } finally {
      await handle.stop();
    }
  });

  it("still serves the normal API alongside the compare view", async () => {
    const handle = await startCompare(store, "sess-aaaa", "sess-bbbb", {
      openBrowser: false,
      launch: () => {},
      log: () => {},
    });
    try {
      const res = await fetch(`${handle.url}/api/sessions`);
      const body = (await res.json()) as { id: string }[];
      expect(body.map((s) => s.id).sort()).toEqual(["sess-aaaa-full-id", "sess-bbbb-full-id"]);
    } finally {
      await handle.stop();
    }
  });
});
