import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const viewerRoot = join(here, "..", "..", "viewer");

function copyBuild(name, srcRelative, destName) {
  const src = join(viewerRoot, srcRelative);
  const dest = join(here, "..", "dist", destName);
  if (!existsSync(src)) {
    console.error(
      `copy-viewer-dist: ${src} not found — build @retrace/viewer first (pnpm --filter @retrace/viewer build)`,
    );
    process.exit(1);
  }
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  console.log(`copy-viewer-dist: embedded ${name} at ${dest}`);
}

// The multi-page app served by `retrace ui` (assets split/cacheable).
copyBuild("viewer app", "dist", "viewer");
// The single-file bundle used by `retrace export --html` (self-contained).
copyBuild("export template", "dist-export", "viewer-export");
