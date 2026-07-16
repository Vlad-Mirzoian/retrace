import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * Separate build for the `retrace export --html` bundle: a single entry
 * (export.html only — no shared chunks to split against) with
 * vite-plugin-singlefile inlining every JS/CSS asset directly into the HTML,
 * so `retrace export` produces one genuinely portable file with no external
 * references. Kept apart from vite.config.ts (the main multi-page app used by
 * `retrace ui`), which deliberately keeps assets split/cacheable.
 */
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "dist-export",
    rollupOptions: {
      input: resolve(__dirname, "export.html"),
    },
  },
});
