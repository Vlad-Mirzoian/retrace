import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RetraceStore } from "retrace-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startUi } from "./ui.js";

let home: string;
let store: RetraceStore;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "retrace-ui-"));
  store = new RetraceStore(home);
});

afterEach(async () => {
  store.close();
  await rm(home, { recursive: true, force: true });
});

describe("startUi", () => {
  it("listens on an OS-assigned port and serves the API", async () => {
    store.ensureSession({ id: "sess-1", title: "Hello" });
    const launch = vi.fn();

    const handle = await startUi(store, { openBrowser: false, launch, log: () => {} });
    try {
      expect(handle.port).toBeGreaterThan(0);
      expect(handle.url).toBe(`http://localhost:${handle.port}`);

      const res = await fetch(`${handle.url}/api/sessions`);
      const body = (await res.json()) as { id: string }[];
      expect(body[0].id).toBe("sess-1");
    } finally {
      await handle.stop();
    }
  });

  it("launches the browser only when openBrowser is not false", async () => {
    const launch = vi.fn();
    const handle = await startUi(store, { openBrowser: true, launch, log: () => {} });
    try {
      expect(launch).toHaveBeenCalledWith(handle.url);
    } finally {
      await handle.stop();
    }
  });

  it("does not launch a browser when openBrowser is false", async () => {
    const launch = vi.fn();
    const handle = await startUi(store, { openBrowser: false, launch, log: () => {} });
    try {
      expect(launch).not.toHaveBeenCalled();
    } finally {
      await handle.stop();
    }
  });

  it("respects a requested port", async () => {
    // Discover a free port via OS assignment, release it, then ask for that
    // exact port explicitly — two servers can't share a port simultaneously.
    const probe = await startUi(store, { openBrowser: false, launch: () => {}, log: () => {} });
    const freePort = probe.port;
    await probe.stop();

    const handle = await startUi(store, {
      port: freePort,
      openBrowser: false,
      launch: () => {},
      log: () => {},
    });
    try {
      expect(handle.port).toBe(freePort);
    } finally {
      await handle.stop();
    }
  });

  it("stop() closes the listening socket", async () => {
    const handle = await startUi(store, { openBrowser: false, launch: () => {}, log: () => {} });
    await handle.stop();
    await expect(fetch(handle.url)).rejects.toThrow();
  });
});
