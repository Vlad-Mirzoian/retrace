import { describe, expect, it } from "vitest";
import { describeCli } from "./index.js";

describe("@retrace/cli", () => {
  it("describes itself with the core version", () => {
    expect(describeCli()).toBe("retrace CLI 0.0.1 (core 0.0.1)");
  });
});
