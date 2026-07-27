/**
 * Node version preflight, run before anything else — including before any
 * import of retrace-core, whose store uses `node:sqlite`. On an older Node,
 * that import fails deep inside a module-resolution error that reads as
 * "this tool is broken" rather than "upgrade Node". This check exists to
 * make that failure legible instead.
 *
 * Decision: keep `node:sqlite` and a >=22.5 floor rather than switching to
 * `better-sqlite3` (a native module — needs a compiler or prebuilds, which
 * would make `npx` installs slow and occasionally fail) or `sql.js`/WASM (no
 * native dependency, but the store's synchronous file-backed access pattern
 * would need a rewrite, and durability semantics would change). Node 22 has
 * been LTS since October 2024 and 22.5 shipped in July 2024 — the population
 * still below that floor is small and shrinking. Reversing this decision is
 * a separate plan, not a patch here.
 *
 * Kept dependency-free (no imports at all) and cheap — a version-string
 * comparison, nothing more — so it costs nothing on the `retrace hook` hot
 * path, spawned by Claude Code once per tool call. See program.ts's `lazy`
 * comment for the same constraint applied to command modules.
 */

export const MIN_NODE = { major: 22, minor: 5 };

export interface NodeVersionCheck {
  ok: boolean;
  /** Present only when `ok` is false: names the running version, the required version, and why. */
  message?: string;
}

/**
 * Checks a `process.version`-shaped string (e.g. `"v22.4.1"`) against
 * {@link MIN_NODE}. A string that doesn't parse is treated as passing — a
 * parse failure in this check must never be what locks a user out; let
 * whatever real failure exists (if any) surface on its own.
 */
export function checkNodeVersion(version: string): NodeVersionCheck {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return { ok: true };

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const meetsFloor = major > MIN_NODE.major || (major === MIN_NODE.major && minor >= MIN_NODE.minor);
  if (meetsFloor) return { ok: true };

  const required = `${MIN_NODE.major}.${MIN_NODE.minor}.0`;
  return {
    ok: false,
    message:
      `Retrace requires Node ${required} or newer (found ${version}) — its local store uses ` +
      `node:sqlite, added in Node ${required}. Upgrade Node (nvm, fnm, or https://nodejs.org) and try again.`,
  };
}
