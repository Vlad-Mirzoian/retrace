import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CORE_VERSION } from "./index.js";

function packageVersion(): string {
  const path = fileURLToPath(new URL("../package.json", import.meta.url));
  return (JSON.parse(readFileSync(path, "utf8")) as { version: string }).version;
}

describe("retrace-core", () => {
  it("exposes the version from package.json — the single source of truth, not a hand-maintained duplicate", () => {
    expect(CORE_VERSION).toBe(packageVersion());
  });
});
