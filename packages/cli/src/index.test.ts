import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { describeCli } from "./index.js";

function packageVersion(pkgDir: string): string {
  const path = fileURLToPath(new URL(pkgDir, import.meta.url));
  return (JSON.parse(readFileSync(path, "utf8")) as { version: string }).version;
}

describe("@retrace/cli", () => {
  it("describes itself with its own version and the core version — both from package.json, not hardcoded", () => {
    const cliVersion = packageVersion("../package.json");
    const coreVersion = packageVersion("../../core/package.json");
    expect(describeCli()).toBe(`retrace CLI ${cliVersion} (core ${coreVersion})`);
  });
});
