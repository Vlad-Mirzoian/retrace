import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  entry: { index: "src/index.ts", cli: "src/cli.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  // Applied to every output; Node strips a leading shebang line from any
  // loaded module (imported or executed directly), so it's harmless on
  // dist/index.js too.
  banner: { js: "#!/usr/bin/env node" },
  // Single-sources CLI_VERSION from package.json — see src/version.ts.
  define: { __RETRACE_VERSION__: JSON.stringify(version) },
});
