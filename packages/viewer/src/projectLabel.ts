/**
 * Claude Code project directories mangle the real path (slashes and drive
 * colons become dashes), so `session.project` often reads as
 * `D--Projects-Retrace-retrace`. `session.cwd` carries the real path, so
 * prefer its basename whenever it's available.
 */
export function projectLabel(project: string | null, cwd: string | null): string {
  if (cwd) {
    const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
    const base = normalized.slice(normalized.lastIndexOf("/") + 1);
    if (base) return base;
  }
  return project ?? "—";
}
