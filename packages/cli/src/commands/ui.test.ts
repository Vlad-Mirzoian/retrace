import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RetraceStore } from "retrace-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { homedir } from "node:os";
import { startUi } from "./ui.js";

// defaultProjectsDir() (in import.js) resolves `homedir()/.claude/projects` —
// mocking node:os's homedir, rather than import.js itself, lets the
// auto-import tests exercise the real importOnce end to end while still
// pointing at a throwaway directory instead of this machine's real
// ~/.claude/projects.
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: vi.fn(actual.homedir) };
});

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

// Every test below is about server behavior, not auto-import — autoImport:
// false keeps them isolated from whatever homedir()/.claude/projects happens
// to resolve to and contain on the machine running the tests.
describe("startUi", () => {
  it("listens on an OS-assigned port and serves the API", async () => {
    store.ensureSession({ id: "sess-1", title: "Hello" });
    const launch = vi.fn();

    const handle = await startUi(store, {
      openBrowser: false,
      launch,
      log: () => {},
      autoImport: false,
    });
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
    const handle = await startUi(store, {
      openBrowser: true,
      launch,
      log: () => {},
      autoImport: false,
    });
    try {
      expect(launch).toHaveBeenCalledWith(handle.url);
    } finally {
      await handle.stop();
    }
  });

  it("does not launch a browser when openBrowser is false", async () => {
    const launch = vi.fn();
    const handle = await startUi(store, {
      openBrowser: false,
      launch,
      log: () => {},
      autoImport: false,
    });
    try {
      expect(launch).not.toHaveBeenCalled();
    } finally {
      await handle.stop();
    }
  });

  it("respects a requested port", async () => {
    // Discover a free port via OS assignment, release it, then ask for that
    // exact port explicitly — two servers can't share a port simultaneously.
    const probe = await startUi(store, {
      openBrowser: false,
      launch: () => {},
      log: () => {},
      autoImport: false,
    });
    const freePort = probe.port;
    await probe.stop();

    const handle = await startUi(store, {
      port: freePort,
      openBrowser: false,
      launch: () => {},
      log: () => {},
      autoImport: false,
    });
    try {
      expect(handle.port).toBe(freePort);
    } finally {
      await handle.stop();
    }
  });

  it("stop() closes the listening socket", async () => {
    const handle = await startUi(store, {
      openBrowser: false,
      launch: () => {},
      log: () => {},
      autoImport: false,
    });
    await handle.stop();
    await expect(fetch(handle.url)).rejects.toThrow();
  });
});

describe("startUi — auto-import", () => {
  let fakeHome: string;

  beforeEach(async () => {
    fakeHome = await mkdtemp(join(tmpdir(), "retrace-ui-fakehome-"));
    vi.mocked(homedir).mockReturnValue(fakeHome);
  });

  afterEach(async () => {
    vi.mocked(homedir).mockRestore();
    await rm(fakeHome, { recursive: true, force: true });
  });

  async function seedProjectsDir(): Promise<void> {
    const projDir = join(fakeHome, ".claude", "projects", "proj");
    await mkdir(projDir, { recursive: true });
    const fixture = fileURLToPath(
      new URL("../../../core/fixtures/basic-session.jsonl", import.meta.url),
    );
    await copyFile(fixture, join(projDir, "basic-session.jsonl"));
  }

  it("imports from the default projects dir when the store is empty and autoImport is not suppressed", async () => {
    await seedProjectsDir();
    const logs: string[] = [];

    const handle = await startUi(store, { openBrowser: false, launch: () => {}, log: (m) => logs.push(m) });
    try {
      expect(store.listSessions().length).toBeGreaterThan(0);
      expect(logs.some((l) => /importing from ~\/\.claude\/projects/i.test(l))).toBe(true);
      expect(logs.some((l) => /imported \d+ event\(s\) from \d+ session\(s\)/i.test(l))).toBe(true);
    } finally {
      await handle.stop();
    }
  });

  it("does not import when autoImport is false, even if the store is empty and the projects dir has content", async () => {
    await seedProjectsDir();

    const handle = await startUi(store, {
      openBrowser: false,
      launch: () => {},
      log: () => {},
      autoImport: false,
    });
    try {
      expect(store.listSessions()).toEqual([]);
    } finally {
      await handle.stop();
    }
  });

  it("does not import when the store already has sessions", async () => {
    await seedProjectsDir();
    store.ensureSession({ id: "existing" });

    const handle = await startUi(store, { openBrowser: false, launch: () => {}, log: () => {} });
    try {
      expect(store.listSessions().map((s) => s.id)).toEqual(["existing"]);
    } finally {
      await handle.stop();
    }
  });

  it("prints an explanation and still starts when the projects directory doesn't exist", async () => {
    // fakeHome exists but nothing has been created under .claude/projects.
    const logs: string[] = [];

    const handle = await startUi(store, { openBrowser: false, launch: () => {}, log: (m) => logs.push(m) });
    try {
      expect(store.listSessions()).toEqual([]);
      expect(logs.some((l) => /not found/i.test(l))).toBe(true);
    } finally {
      await handle.stop();
    }
  });
});
