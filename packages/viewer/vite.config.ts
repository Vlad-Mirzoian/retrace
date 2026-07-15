import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Dev convention: run the API standalone (e.g. `retrace ui --port 4317
      // --no-open`) alongside `pnpm --filter @retrace/viewer dev`.
      "/api": "http://localhost:4317",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
  },
});
