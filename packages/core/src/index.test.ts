import { describe, expect, it } from "vitest";
import { CORE_VERSION } from "./index.js";

describe("@retrace/core", () => {
  it("exposes a version", () => {
    expect(CORE_VERSION).toBe("0.0.1");
  });
});
