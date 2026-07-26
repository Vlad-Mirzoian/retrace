import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  entry: { index: "src/index.ts", browser: "src/browser.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  // Single-sources CORE_VERSION from package.json into the built artifact —
  // see src/index.ts's declare + fallback for why tests still see the right
  // value even though this replacement only happens at build time.
  define: { __RETRACE_VERSION__: JSON.stringify(version) },
});
