import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProgram } from "./program.js";

// tsup's `entry` config guarantees this file is emitted as `dist/cli.js`
// (unlike internal modules, which may land in an arbitrarily-named shared
// chunk) — so import.meta.url is the one stable place to locate the viewer
// builds embedded alongside it (see scripts/copy-viewer-dist.mjs):
// dist/viewer/ (the multi-page app served by `retrace ui`) and
// dist/viewer-export/ (the single-file template for `retrace export --html`).
const here = dirname(fileURLToPath(import.meta.url));
const viewerDir = join(here, "viewer");
const viewerExportDir = join(here, "viewer-export");

createProgram({ viewerDir, viewerExportDir })
  .parseAsync(process.argv)
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
