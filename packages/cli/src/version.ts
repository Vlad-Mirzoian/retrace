import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Injected by tsup's `define` at build time (see tsup.config.ts) from this package's own package.json. */
declare const __RETRACE_VERSION__: string;

function readPackageVersion(): string {
  const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
  return (JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string }).version;
}

/**
 * This package's own version, single-sourced from package.json. The build-time
 * `define` replacement bakes the real value into the shipped artifact with no
 * runtime file read; the `readPackageVersion` fallback only ever runs when
 * this module executes straight from source (tests), where that replacement
 * hasn't happened — so `typeof` stays `"undefined"`.
 */
export const CLI_VERSION: string =
  typeof __RETRACE_VERSION__ !== "undefined" ? __RETRACE_VERSION__ : readPackageVersion();
