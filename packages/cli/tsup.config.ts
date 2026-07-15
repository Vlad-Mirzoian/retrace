import { defineConfig } from "tsup";

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
});
