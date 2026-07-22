import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContentStore } from "./cas.js";
import { verifyChain } from "./chain.js";
import { OFFLOAD_THRESHOLD_BYTES } from "./offload.js";
import type { RetraceEventDraft } from "./schema.js";
import { RetraceStore } from "./store.js";

let home: string;
let store: RetraceStore;

const BIG = "x".repeat(OFFLOAD_THRESHOLD_BYTES + 1);
const SMALL = "just a little text";

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "retrace-offload-"));
  store = new RetraceStore(home);
});

afterEach(async () => {
  store.close();
  await rm(home, { recursive: true, force: true });
});

function toolResult(output: unknown, sessionId = "s1"): RetraceEventDraft {
  return {
    ts: "2026-07-15T14:37:00.000Z",
    sessionId,
    kind: "tool_result",
    payload: { toolUseId: "t1", output },
  };
}

async function eventsLine(sessionId: string): Promise<string> {
  const raw = await readFile(join(home, "sessions", sessionId, "events.jsonl"), "utf8");
  return raw.trim().split("\n")[0];
}

describe("payload offloading", () => {
  it("keeps a small payload inline, with no CAS object and no refs", async () => {
    const event = store.appendEvent(toolResult(SMALL));
    expect(event.artifactRefs).toBeUndefined();

    const line = await eventsLine("s1");
    expect(line).toContain(SMALL);
    expect(line).not.toContain("$retraceRef");
  });

  it("moves an oversized string out of the stored line and into the CAS", async () => {
    store.appendEvent(toolResult(BIG));

    const line = await eventsLine("s1");
    expect(line).not.toContain(BIG);
    expect(line).toContain("$retraceRef");
    // The stored line is now tiny compared to the payload it represents.
    expect(line.length).toBeLessThan(BIG.length / 10);
  });

  it("lists the offloaded object in artifactRefs, on both write and read", () => {
    const written = store.appendEvent(toolResult(BIG));
    expect(written.artifactRefs).toHaveLength(1);
    expect(written.artifactRefs?.[0]).toMatch(/^[0-9a-f]{64}$/);

    const [read] = store.readEvents("s1", 0, 1);
    expect(read.artifactRefs).toEqual(written.artifactRefs);
  });

  it("round-trips the payload transparently on read", () => {
    store.appendEvent(toolResult(BIG));
    const [read] = store.readEvents("s1", 0, 1);
    expect(read.kind).toBe("tool_result");
    if (read.kind === "tool_result") expect(read.payload.output).toBe(BIG);
  });

  it("offloads oversized strings nested inside arrays and objects", () => {
    store.appendEvent(toolResult([{ type: "text", text: BIG }]));
    const [read] = store.readEvents("s1", 0, 1);
    if (read.kind === "tool_result") {
      expect(read.payload.output).toEqual([{ type: "text", text: BIG }]);
    }
  });

  it("offloads oversized reasoning text too, not just tool output", () => {
    store.appendEvent({
      ts: "2026-07-15T14:37:00.000Z",
      sessionId: "s1",
      kind: "thinking",
      payload: { text: BIG },
    });
    const [read] = store.readEvents("s1", 0, 1);
    if (read.kind === "thinking") expect(read.payload.text).toBe(BIG);
  });

  it("dedupes identical bodies across events into one CAS object", async () => {
    store.appendEvent(toolResult(BIG));
    store.appendEvent(toolResult(BIG));

    const [a, b] = store.readEvents("s1", 0, 2);
    expect(a.artifactRefs?.[0]).toBe(b.artifactRefs?.[0]);

    const { readdir } = await import("node:fs/promises");
    const shards = await readdir(join(home, "objects"));
    expect(shards).toHaveLength(1);
    const objects = await readdir(join(home, "objects", shards[0]));
    expect(objects).toHaveLength(1);
  });

  it("keeps the hash chain valid across offloaded events", () => {
    store.appendEvent(toolResult(BIG));
    store.appendEvent(toolResult(SMALL));
    store.appendEvent(toolResult(BIG.replace("x", "y")));

    const events = store.readEvents("s1", 0, 10);
    expect(events).toHaveLength(3);
    expect(verifyChain(events)).toEqual({ ok: true });
  });

  it("still detects tampering when the body lives in the CAS", async () => {
    store.appendEvent(toolResult(BIG));
    const [before] = store.readEvents("s1", 0, 1);
    const hash = before.artifactRefs![0];

    // Rewrite the CAS object's bytes in place, as an attacker editing the
    // store on disk would: the event's hash covers the real body, so the
    // swapped content no longer matches it.
    const cas = new ContentStore(join(home, "objects"));
    const forged = "y".repeat(OFFLOAD_THRESHOLD_BYTES + 1);
    const { writeFile } = await import("node:fs/promises");
    const { gzipSync } = await import("node:zlib");
    await writeFile(join(home, "objects", hash.slice(0, 2), hash), gzipSync(forged));
    expect(cas.getTextSync(hash)).toBe(forged); // the tamper landed

    const [after] = store.readEvents("s1", 0, 1);
    const result = verifyChain([after]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/tampered/);
  });

  it("stamps the schema version on every stored record", async () => {
    store.appendEvent(toolResult(SMALL));
    const stored = JSON.parse(await eventsLine("s1"));
    expect(stored.v).toBe(1);
  });

  it("does not leak the version stamp into the parsed event", () => {
    store.appendEvent(toolResult(SMALL));
    const [read] = store.readEvents("s1", 0, 1);
    expect("v" in read).toBe(false);
  });
});
