import { mkdir, mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_HOOK_COMMAND,
  MANAGED_HOOKS,
  initHooks,
  mergeHooks,
  resolveSettingsPath,
} from "./init.js";

describe("mergeHooks", () => {
  it("adds every managed hook event to empty settings", () => {
    const { settings, changed } = mergeHooks({});
    expect(changed).toBe(true);
    const hooks = settings.hooks as Record<string, unknown>;
    for (const managed of MANAGED_HOOKS) {
      expect(hooks[managed.event]).toBeDefined();
    }
  });

  it("scopes the PreToolUse hook to file-writing tools", () => {
    const { settings } = mergeHooks({});
    const hooks = settings.hooks as Record<string, { matcher?: string }[]>;
    expect(hooks.PreToolUse[0].matcher).toBe("Write|Edit|NotebookEdit");
    // Session events have no tool matcher.
    expect(hooks.SessionStart[0].matcher).toBeUndefined();
  });

  it("preserves unrelated settings and existing hooks", () => {
    const existing = {
      permissions: { allow: ["Bash(ls)"] },
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "my-own-hook" }] },
        ],
      },
    };
    const { settings } = mergeHooks(existing);

    expect(settings.permissions).toEqual({ allow: ["Bash(ls)"] });
    const pre = (settings.hooks as Record<string, unknown[]>).PreToolUse;
    // The user's Bash hook survives; ours is appended alongside it.
    expect(pre).toHaveLength(2);
    expect(JSON.stringify(pre)).toContain("my-own-hook");
    expect(JSON.stringify(pre)).toContain(DEFAULT_HOOK_COMMAND);
  });

  it("is idempotent — a second merge changes nothing and adds no duplicates", () => {
    const first = mergeHooks({});
    const second = mergeHooks(first.settings);
    expect(second.changed).toBe(false);

    const pre = (second.settings.hooks as Record<string, unknown[]>).PreToolUse;
    expect(pre).toHaveLength(1);
  });

  it("does not mutate the input settings object", () => {
    const input = {};
    mergeHooks(input);
    expect(input).toEqual({});
  });
});

describe("resolveSettingsPath", () => {
  it("targets the project .claude/settings.json by default", () => {
    expect(resolveSettingsPath({ cwd: "/repo" })).toBe(join("/repo", ".claude", "settings.json"));
  });
  it("targets the user home when --global", () => {
    expect(resolveSettingsPath({ global: true, home: "/home/me" })).toBe(
      join("/home/me", ".claude", "settings.json"),
    );
  });
});

describe("initHooks", () => {
  let dir: string;
  let settingsPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "retrace-init-"));
    settingsPath = join(dir, ".claude", "settings.json");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates a new settings file with hooks when none exists", () => {
    const result = initHooks({ settingsPath });
    expect(result.created).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeUndefined();
  });

  it("preserves existing settings and writes a backup", async () => {
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(settingsPath, JSON.stringify({ permissions: { allow: ["Bash(ls)"] } }), "utf8");

    const result = initHooks({ settingsPath });
    expect(result.created).toBe(false);
    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeDefined();

    const written = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(written.permissions).toEqual({ allow: ["Bash(ls)"] });
    expect(written.hooks).toBeDefined();

    // A backup file was created next to settings.json.
    const files = await readdir(join(dir, ".claude"));
    expect(files.some((f) => f.startsWith("settings.json.backup-"))).toBe(true);
  });

  it("is a no-op on a second run", () => {
    initHooks({ settingsPath });
    const second = initHooks({ settingsPath });
    expect(second.changed).toBe(false);
  });

  it("refuses to touch a malformed settings file", async () => {
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(settingsPath, "{ not valid json", "utf8");
    expect(() => initHooks({ settingsPath })).toThrow(/malformed/);
  });
});
