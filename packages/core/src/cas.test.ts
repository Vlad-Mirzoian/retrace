import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContentStore } from "./cas.js";

let root: string;
let cas: ContentStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "retrace-cas-"));
  cas = new ContentStore(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Count stored object files (ignoring in-flight temp files). */
async function countObjects(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await countObjects(full);
    } else if (!entry.name.includes(".tmp-")) {
      total += 1;
    }
  }
  return total;
}

describe("ContentStore", () => {
  it("round-trips content through put/get", async () => {
    const hash = await cas.put("hello world");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await cas.getText(hash)).toBe("hello world");
  });

  it("round-trips binary buffers", async () => {
    const data = Buffer.from([0, 1, 2, 255, 254, 253]);
    const hash = await cas.put(data);
    expect((await cas.get(hash)).equals(data)).toBe(true);
  });

  it("dedupes identical content to a single object", async () => {
    const h1 = await cas.put("same content");
    const statBefore = await stat(join(root, h1.slice(0, 2), h1));
    const h2 = await cas.put("same content");

    expect(h2).toBe(h1);
    expect(await countObjects(root)).toBe(1);
    // The existing object was not rewritten.
    const statAfter = await stat(join(root, h1.slice(0, 2), h1));
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
  });

  it("stores distinct content under distinct hashes", async () => {
    const h1 = await cas.put("content A");
    const h2 = await cas.put("content B");
    expect(h1).not.toBe(h2);
    expect(await countObjects(root)).toBe(2);
  });

  it("reports presence via has()", async () => {
    const hash = await cas.put("present");
    expect(await cas.has(hash)).toBe(true);
    expect(await cas.has("0".repeat(64))).toBe(false);
  });

  it("throws when getting a missing object", async () => {
    await expect(cas.get("0".repeat(64))).rejects.toThrow();
  });
});
