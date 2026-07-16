import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const viewerDist = join(here, "..", "..", "viewer", "dist");
const target = join(here, "..", "dist", "viewer");

if (!existsSync(viewerDist)) {
  console.error(
    `copy-viewer-dist: ${viewerDist} not found — build @retrace/viewer first (pnpm --filter @retrace/viewer build)`,
  );
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
cpSync(viewerDist, target, { recursive: true });
console.log(`copy-viewer-dist: embedded viewer build at ${target}`);
