import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProgram } from "./program.js";

// tsup's `entry` config guarantees this file is emitted as `dist/cli.js`
// (unlike internal modules, which may land in an arbitrarily-named shared
// chunk) — so import.meta.url is the one stable place to locate the viewer
// build embedded alongside it at packages/cli/dist/viewer/ (see
// scripts/copy-viewer-dist.mjs).
const viewerDir = join(dirname(fileURLToPath(import.meta.url)), "viewer");

createProgram({ viewerDir })
  .parseAsync(process.argv)
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
