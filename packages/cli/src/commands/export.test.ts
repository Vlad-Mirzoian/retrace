import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RetraceStore } from "retrace-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportSession } from "./export.js";

let home: string;
let outDir: string;
let store: RetraceStore;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "retrace-export-home-"));
  outDir = await mkdtemp(join(tmpdir(), "retrace-export-out-"));
  store = new RetraceStore(home);
});

afterEach(async () => {
  store.close();
  await rm(home, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
});

function seedSession() {
  store.appendEvent({
    ts: "2026-07-15T14:37:00.000Z",
    sessionId: "sess-1",
    kind: "user_prompt",
    payload: { text: "fix the login bug" },
  });
  store.appendEvent({
    ts: "2026-07-15T14:37:01.000Z",
    sessionId: "sess-1",
    kind: "assistant_text",
    payload: { text: "on it" },
  });
  store.ensureSession({ id: "sess-1", project: "demo", title: "Fix the login bug" });
}

describe("exportSession — json", () => {
  it("throws for an unknown session", () => {
    expect(() => exportSession(store, "nope", { format: "json" })).toThrow(/no session matches/);
  });

  it("resolves a unique session id prefix", async () => {
    seedSession();
    const output = join(outDir, "out.json");

    const result = exportSession(store, "sess-", { format: "json", output });
    expect(result).toEqual({ path: output, format: "json", eventCount: 2 });
  });

  it("writes session metadata and every event to a JSON file", async () => {
    seedSession();
    const output = join(outDir, "out.json");

    const result = exportSession(store, "sess-1", { format: "json", output });
    expect(result).toEqual({ path: output, format: "json", eventCount: 2 });

    const written = JSON.parse(await readFile(output, "utf8"));
    expect(written.session.id).toBe("sess-1");
    expect(written.session.title).toBe("Fix the login bug");
    expect(written.events).toHaveLength(2);
    expect(written.events[0].kind).toBe("user_prompt");
  });

  it("collects every event across pagination boundaries", async () => {
    for (let i = 0; i < 501; i++) {
      store.appendEvent({
        ts: "2026-07-15T14:37:00.000Z",
        sessionId: "big-sess",
        kind: "assistant_text",
        payload: { text: `msg ${i}` },
      });
    }
    const output = join(outDir, "big.json");
    const result = exportSession(store, "big-sess", { format: "json", output });
    expect(result.eventCount).toBe(501);

    const written = JSON.parse(await readFile(output, "utf8"));
    expect(written.events).toHaveLength(501);
    expect(written.events[500].payload.text).toBe("msg 500");
  });

  it("defaults the output path to <sessionId>.json when none is given", () => {
    seedSession();
    const cwd = process.cwd();
    process.chdir(outDir);
    try {
      const result = exportSession(store, "sess-1", { format: "json" });
      expect(result.path).toBe("sess-1.json");
    } finally {
      process.chdir(cwd);
    }
  });
});

describe("exportSession — html", () => {
  let viewerExportDir: string;

  beforeEach(async () => {
    viewerExportDir = await mkdtemp(join(tmpdir(), "retrace-export-template-"));
    await writeFile(
      join(viewerExportDir, "export.html"),
      "<html><head><title>t</title></head><body>SPA</body></html>",
      "utf8",
    );
  });

  afterEach(async () => {
    await rm(viewerExportDir, { recursive: true, force: true });
  });

  it("throws when viewerExportDir isn't provided", () => {
    seedSession();
    expect(() => exportSession(store, "sess-1", { format: "html" })).toThrow(/embedded export template/);
  });

  it("throws when the template file is missing", () => {
    seedSession();
    expect(() =>
      exportSession(store, "sess-1", { format: "html", viewerExportDir: join(outDir, "nope") }),
    ).toThrow(/export template not found/);
  });

  it("embeds the session data into the template as a single self-contained file", async () => {
    seedSession();
    const output = join(outDir, "out.html");

    const result = exportSession(store, "sess-1", { format: "html", viewerExportDir, output });
    expect(result).toEqual({ path: output, format: "html", eventCount: 2 });

    const html = await readFile(output, "utf8");
    expect(html).toContain("SPA");
    expect(html).toContain("window.__RETRACE_EXPORT__");
    expect(html).toContain("fix the login bug");
    // No external references were introduced by the injection step.
    expect(html).not.toMatch(/<script[^>]*\ssrc=/);
  });

  it("escapes a literal '</script>' inside event text so it can't break out of the tag", async () => {
    store.appendEvent({
      ts: "2026-07-15T14:37:00.000Z",
      sessionId: "sess-1",
      kind: "assistant_text",
      payload: { text: "here's the payload: </script><script>alert(1)</script>" },
    });
    store.ensureSession({ id: "sess-1" });
    const output = join(outDir, "xss.html");

    exportSession(store, "sess-1", { format: "html", viewerExportDir, output });
    const html = await readFile(output, "utf8");

    // The data-carrying <script> block must remain a single, well-formed tag:
    // only the "<" character is escaped — that's what an HTML parser's
    // script-end scan actually keys on, so a literal "<" never appears inside
    // the payload even though the ">" that follows it is left untouched.
    const dataScriptMatch = html.match(/<script>window\.__RETRACE_EXPORT__[\s\S]*?<\/script>/);
    expect(dataScriptMatch).not.toBeNull();
    expect(dataScriptMatch![0]).toContain("\\u003c/script>");
    expect(dataScriptMatch![0]).toContain("\\u003cscript>alert(1)");
  });
});

describe("exportSession — bundling file snapshots", () => {
  let viewerExportDir: string;

  beforeEach(async () => {
    viewerExportDir = await mkdtemp(join(tmpdir(), "retrace-export-template-"));
    await writeFile(
      join(viewerExportDir, "export.html"),
      "<html><head><title>t</title></head><body>SPA</body></html>",
      "utf8",
    );
  });

  afterEach(async () => {
    await rm(viewerExportDir, { recursive: true, force: true });
  });

  /** A hook-recorded file_change, whose diff sides live in the CAS. */
  async function seedFileChange() {
    const beforeRef = await store.objects.put("THE ORIGINAL FILE BODY");
    const afterRef = await store.objects.put("THE REPLACEMENT FILE BODY");
    store.appendEvent({
      ts: "2026-07-15T14:37:00.000Z",
      sessionId: "sess-1",
      kind: "file_change",
      payload: { path: "/repo/config.json", operation: "write", beforeRef, afterRef },
      artifactRefs: [beforeRef, afterRef],
    });
    store.ensureSession({ id: "sess-1" });
    return { beforeRef, afterRef };
  }

  it("bundles the snapshots an exported session needs to draw its diffs", async () => {
    const { beforeRef, afterRef } = await seedFileChange();
    const output = join(outDir, "snap.json");

    exportSession(store, "sess-1", { format: "json", output });
    const written = JSON.parse(await readFile(output, "utf8"));

    expect(written.objects[beforeRef]).toBe("THE ORIGINAL FILE BODY");
    expect(written.objects[afterRef]).toBe("THE REPLACEMENT FILE BODY");
  });

  it("puts those snapshot bodies inside the standalone HTML itself", async () => {
    await seedFileChange();
    const output = join(outDir, "snap.html");

    exportSession(store, "sess-1", { format: "html", viewerExportDir, output });
    const html = await readFile(output, "utf8");

    // Without these, an exported file would have to call back to a server that
    // isn't running to render the diff.
    expect(html).toContain("THE ORIGINAL FILE BODY");
    expect(html).toContain("THE REPLACEMENT FILE BODY");
  });

  it("bundles nothing when a session references no snapshots", async () => {
    seedSession();
    const output = join(outDir, "plain.json");

    exportSession(store, "sess-1", { format: "json", output });
    const written = JSON.parse(await readFile(output, "utf8"));
    expect(written.objects).toEqual({});
  });

  it("does not re-bundle an oversized payload the store already inlines on read", async () => {
    // Offloaded bodies come back inline from readEvents, so re-embedding them
    // would ship the same bytes twice.
    const big = "z".repeat(9000);
    store.appendEvent({
      ts: "2026-07-15T14:37:00.000Z",
      sessionId: "sess-1",
      kind: "tool_result",
      payload: { toolUseId: "t1", output: big },
    });
    store.ensureSession({ id: "sess-1" });
    const output = join(outDir, "big.json");

    exportSession(store, "sess-1", { format: "json", output });
    const written = JSON.parse(await readFile(output, "utf8"));

    expect(written.events[0].payload.output).toBe(big); // present, inline
    expect(written.objects).toEqual({}); // and not a second copy
  });

  it("still exports when a referenced snapshot has gone missing from the store", async () => {
    store.appendEvent({
      ts: "2026-07-15T14:37:00.000Z",
      sessionId: "sess-1",
      kind: "file_change",
      payload: { path: "/repo/gone.txt", operation: "write", beforeRef: "0".repeat(64) },
    });
    store.ensureSession({ id: "sess-1" });
    const output = join(outDir, "missing.json");

    expect(() => exportSession(store, "sess-1", { format: "json", output })).not.toThrow();
    const written = JSON.parse(await readFile(output, "utf8"));
    expect(written.objects).toEqual({});
    expect(written.events).toHaveLength(1);
  });
});
