import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkNodeVersion } from "./preflight.js";

// Runs before `createProgram` is even imported below: `program.ts` pulls in
// retrace-core (for RetraceStore), whose store uses node:sqlite — on too old
// a Node, that import itself throws a module-resolution error deep enough to
// read as "this tool is broken" rather than "upgrade Node". Checking first
// makes the real failure legible instead.
const nodeCheck = checkNodeVersion(process.version);
if (!nodeCheck.ok) {
  console.error(nodeCheck.message);
  process.exit(1);
}

const { createProgram } = await import("./program.js");

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
